import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { repo } from './fixtures.js'

// Real processes and ports: the daemon's state goes to a temp PORLOCAL_HOME, set before paths.ts is first imported.
const home = mkdtempSync(join(tmpdir(), 'porlocal-home-'))
process.env.PORLOCAL_HOME = home
const { Supervisor, UserError } = await import('../src/daemon/supervisor.js')
const { isAlive, killTree } = await import('../src/procs.js')
const { isFree } = await import('../src/ports.js')
const { normalize, resolveWorkspace } = await import('../src/workspace.js')

const silent = { info: () => {}, warn: () => {}, error: () => {} }
const base = 20000 + Math.floor(Math.random() * 5000) * 2
const SERVER_PORT = base
const WEB_PORT = base + 1

const root = mkdtempSync(join(tmpdir(), 'porlocal-sup-'))
const server = repo(join(root, 'ws'), 'server', { services: { api: { port: SERVER_PORT } }, env: { PORT: '{port:api}' } })
const web = repo(join(root, 'ws'), 'web', { services: { web: { port: WEB_PORT } }, env: { PORT: '{port:web}', API_URL: '{url:server/api}' } })
const listener = join(root, 'listen.js')
writeFileSync(listener, "require('node:http').createServer((_, res) => res.end('ok')).listen(Number(process.env.PORT))\n")
const serve = `node "${listener}"`

const sup = new Supervisor(silent)
const held: Server[] = []

function hold(port: number): Promise<Server> {
  return new Promise((done) => {
    const s = createServer().listen(port, () => done(s))
    held.push(s)
  })
}

async function until(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 200))
  }
}

const run = (cwd: string, service: string, extra: object = {}) =>
  sup.run({ cwd, service, cmd: serve, callerPid: process.pid, ownerPid: null, env: process.env as Record<string, string>, ...extra })

afterAll(() => {
  for (const p of sup.state.processes) if (p.status === 'starting' || p.status === 'ready') killTree(p.pid)
  for (const s of held) s.close()
})

describe('supervisor', { timeout: 60_000 }, () => {
  it('a taken preferred port is an error, --new-port moves it and rewrites the dependents', async () => {
    const w = await run(web, 'web')
    expect(w.status).toBe('ready')
    expect(readFileSync(join(web, '.env.local'), 'utf-8')).toContain(`API_URL=http://localhost:${SERVER_PORT}`)

    const blocker = await hold(SERVER_PORT)
    await expect(run(server, 'api')).rejects.toThrow(UserError)
    await expect(run(server, 'api')).rejects.toThrow(/--new-port/)

    const s = await run(server, 'api', { newPort: true })
    expect(s.port).not.toBe(SERVER_PORT)
    expect(s.status).toBe('ready')
    expect(readFileSync(join(web, '.env.local'), 'utf-8')).toContain(`API_URL=http://localhost:${s.port}`)
    expect(sup.find(w.id)?.needsRestart).toBe(true)
    blocker.close()

    // The lease sticks: the next run of server keeps the moved port, even with its preferred one free again.
    sup.stop(s.id)
    await until(() => isFree(s.port))
    expect((await sup.lease(resolveWorkspace(server), 'api')).port).toBe(s.port)
  })

  it('stops the whole tree after the grace delay once the owner dies', async () => {
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    const p = await run(server, 'api', { ownerPid: owner.pid, graceSec: 0 })
    expect(p.owner?.pid).toBe(owner.pid)
    expect(p.status).toBe('ready')
    owner.kill()
    await until(() => sup.find(p.id)?.status === 'stopped')
    expect(sup.find(p.id)?.stopReason).toMatch(/owner .* gone/)
    await until(() => isFree(p.port)) // the shell wrapper and the node server under it
    expect(isAlive(p.pid)).toBe(false)
  })

  it('re-adopts after a daemon restart, by PID or else by the port holder', async () => {
    const p = await run(server, 'api')
    expect(p.status).toBe('ready')

    const restarted = new Supervisor(silent)
    const again = restarted.find(p.id)!
    expect(again).toMatchObject({ status: 'ready', adopted: true, pid: p.pid })

    // A wrapper PID gone (cmd /c, pnpm) while the server lives on: the port holder takes over.
    const dead = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' })
    await new Promise((r) => dead.on('exit', r))
    const saved = JSON.parse(readFileSync(join(home, 'state.json'), 'utf-8'))
    saved.processes.find((x: { id: string }) => x.id === p.id).pid = dead.pid
    writeFileSync(join(home, 'state.json'), JSON.stringify(saved))
    const third = new Supervisor(silent)
    const byPort = third.find(p.id)!
    expect(byPort.status).toBe('ready')
    expect(byPort.pid).not.toBe(dead.pid)
    expect(isAlive(byPort.pid)).toBe(true)
    expect(normalize(byPort.workspace)).toBe(normalize(server))

    killTree(p.pid)
    killTree(byPort.pid)
    await until(() => isFree(p.port))
  })
})
