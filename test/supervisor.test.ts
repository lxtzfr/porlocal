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
process.env.WT_HOME = home // wt's project map: never the real ~/.wt
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

// Like `docker compose up -d` / `stop`: the listener belongs to no process of the command that started it.
const INFRA_PORT = base + 2
const pidFile = join(root, 'infra.pid')
const starter = join(root, 'start.js')
writeFileSync(starter, `const c = require('node:child_process').spawn(process.execPath, [${JSON.stringify(listener)}], { detached: true, stdio: 'ignore' }); c.unref(); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid))\n`)
const stopper = join(root, 'stop.js')
writeFileSync(stopper, `process.kill(Number(require('node:fs').readFileSync(${JSON.stringify(pidFile)})))\n`)
const infra = repo(join(root, 'ws'), 'infra', { services: { db: { port: INFRA_PORT, run: `node "${starter}"`, stop: `node "${stopper}"` } } })

const NEEDS_PORT = base + 3
const app = repo(join(root, 'ws'), 'app', { services: { api: { port: NEEDS_PORT, run: serve, needs: ['infra/db'] }, loop: { run: serve, needs: ['loop'] } } })

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
  it('a taken port moves (said, dependents rewritten and restarted), back on the declared one once free', async () => {
    const w = await run(web, 'web')
    expect(w.status).toBe('ready')
    const apiUrl = () => readFileSync(join(web, '.env.local'), 'utf-8').match(/API_URL=(.*)/)?.[1]
    expect(apiUrl()).toBe(`http://localhost:${SERVER_PORT}`)

    const blocker = await hold(SERVER_PORT)
    await expect(run(server, 'api', { keepPort: true })).rejects.toThrow(UserError)

    const s = await run(server, 'api')
    expect(s.port).not.toBe(SERVER_PORT)
    expect(s.status).toBe('ready')
    expect(s.notes?.[0]).toMatch(new RegExp(`port ${SERVER_PORT} is taken by .*: on ${s.port} instead`))
    expect(s.notes?.[1]).toMatch(/web: \.env\.local now points at \d+, restarting web/)
    expect(apiUrl()).toBe(`http://localhost:${s.port}`)
    await until(() => sup.find(w.id)?.pid !== w.pid && sup.find(w.id)?.status === 'ready')
    expect((await run(server, 'api')).notes).toEqual(['already running'])

    blocker.close()
    sup.stop(s.id)
    await until(() => isFree(s.port))
    const back = await run(server, 'api')
    expect(back.port).toBe(SERVER_PORT)
    expect(back.notes?.[0]).toBe(`back on its declared port ${SERVER_PORT}`)
    expect(apiUrl()).toBe(`http://localhost:${SERVER_PORT}`)
    sup.stop(back.id)
    await until(() => isFree(back.port))
  })

  it('a detached service: ready once its command returned and its port answers, ended by its stop command', async () => {
    const p = await sup.run({ cwd: infra, service: 'db', callerPid: process.pid, ownerPid: null, env: process.env as Record<string, string> })
    expect(p.status).toBe('ready')
    expect(new Supervisor(silent).find(p.id)?.status).toBe('ready')

    const restarted = await sup.restart(p.id)
    expect(restarted.status).toBe('ready')
    expect(restarted.port).toBe(INFRA_PORT)

    sup.stop(p.id)
    await until(() => isFree(INFRA_PORT))

    const again = await sup.run({ cwd: infra, service: 'db', callerPid: process.pid, ownerPid: null, env: process.env as Record<string, string> })
    process.kill(Number(readFileSync(pidFile, 'utf-8')))
    await until(() => sup.find(again.id)?.status === 'exited')
  })

  it('starts what a service needs first, and again when it went down; a cycle is an error', async () => {
    const request = { cwd: app, service: 'api', callerPid: process.pid, ownerPid: null, env: process.env as Record<string, string> }
    const p = await sup.run(request)
    expect(p.status).toBe('ready')
    const db = () => sup.state.processes.find((x) => x.service === 'db')!
    expect(db().status).toBe('ready')

    sup.stop(db().id)
    await until(() => isFree(INFRA_PORT))
    expect((await sup.run(request)).notes).toContain('already running')
    expect(db().status).toBe('ready')

    await expect(sup.run({ ...request, service: 'loop' })).rejects.toThrow('needs cycle')
    sup.stop(p.id)
    sup.stop(db().id)
    await until(() => isFree(INFRA_PORT))
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
    expect(sup.find(p.id)?.ownerLostAt).toBeUndefined()

    // A start from the dashboard after that: the dead owner is dropped, else it would stop again at once.
    const started = await sup.restart(p.id)
    expect(started.owner).toBeNull()
    expect(started.status).toBe('ready')
    sup.stop(started.id)
    await until(() => isFree(started.port))
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
