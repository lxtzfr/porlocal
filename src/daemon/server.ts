import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Logger } from '../log.js'
import { DAEMON_PORT } from '../paths.js'
import { listeningPorts } from '../ports.js'
import { isAlive, killTree, processTable } from '../procs.js'
import { refTarget, resolveWorkspace } from '../workspace.js'
import type { Adb } from './adb.js'
import { DASHBOARD_HTML } from './dashboard.js'
import { Supervisor, UserError, type RunRequest } from './supervisor.js'
import { findZombies } from './zombies.js'

export const VERSION = '0.1.0'

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (err) {
        reject(new UserError('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function tail(file: string, lines: number): string {
  if (!existsSync(file)) return ''
  const all = readFileSync(file, 'utf-8').split(/\r?\n/)
  return all.slice(-lines).join('\n')
}

export function startServer(sup: Supervisor, adb: Adb, log: Logger, shutdown: () => void) {
  const zombies = () => findZombies(sup.state, processTable(), listeningPorts(), [process.pid])
  const routes: Record<string, (body: any, url: URL) => Promise<unknown> | unknown> = {
    'GET /api/health': () => ({ ok: true, pid: process.pid, version: VERSION }),
    'GET /api/state': () => ({
      processes: sup.state.processes.map((p) => ({ ...p, ownerAlive: p.owner ? isAlive(p.owner.pid) : null })),
      leases: sup.state.leases,
      bindings: sup.state.bindings.map((b) => ({ ...b, hostPort: sup.portOf(b.workspace, b.service) })),
      devices: [...adb.devices],
      adb: adb.available,
    }),
    'POST /api/run': (body: RunRequest) => sup.run(body),
    'POST /api/stop': (body) => sup.stop(body.id),
    'POST /api/restart': (body) => sup.restart(body.id),
    'POST /api/keep': (body) => sup.keep(body.id),
    'POST /api/forget': (body) => sup.forget(body.id),
    'POST /api/lease': async (body) => sup.lease(resolveWorkspace(body.cwd), body.service, body.newPort),
    'POST /api/release': (body) => sup.release(resolveWorkspace(body.cwd).path, body.service) ?? null,
    'POST /api/device/bind': (body) => {
      const target = refTarget(resolveWorkspace(body.cwd), body.ref)
      return adb.bind({ ...target, devicePort: Number(body.devicePort), device: body.device ?? 'all' })
    },
    'POST /api/device/unbind': (body) => adb.unbind(Number(body.devicePort), body.device ?? 'all'),
    'GET /api/logs': (_, url) => {
      const p = sup.find(url.searchParams.get('id') ?? '')
      if (!p) throw new UserError('unknown process')
      return { id: p.id, text: tail(p.logFile, Number(url.searchParams.get('tail') ?? 200)) }
    },
    'GET /api/zombies': () => zombies(),
    // Only a PID listed as a zombie right now: never a way to kill any process by number.
    'POST /api/kill': (body) => {
      const z = zombies().find((x) => x.pid === Number(body.pid))
      if (!z) throw new UserError(`PID ${body.pid} is not a process left outside porlocal (porlocal zombies)`)
      killTree(z.pid)
      log.info(`killed zombie PID ${z.pid} (${z.name}, ${z.checkout}${z.ports.length ? `, ports ${z.ports.join(' ')}` : ''})`)
      return z
    },
    'POST /api/shutdown': () => {
      setTimeout(shutdown, 100)
      return { ok: true }
    },
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Local only: a web page can't drive it through DNS rebinding (Host) or a simple cross-site form (JSON only).
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (host !== '127.0.0.1' && host !== 'localhost') {
      res.writeHead(403).end()
      return
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DASHBOARD_HTML)
      return
    }
    const route = routes[`${req.method} ${url.pathname}`]
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }))
      return
    }
    if (req.method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) {
      res.writeHead(415).end()
      return
    }
    try {
      const body = req.method === 'POST' ? await readBody(req) : {}
      const result = await route(body, url)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result ?? null))
    } catch (err) {
      const user = err instanceof UserError
      if (!user) log.error(`${req.method} ${url.pathname}`, err)
      res.writeHead(user ? 400 : 500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (err as Error).message }))
    }
  })
  server.listen(DAEMON_PORT, '127.0.0.1', () => log.info(`listening on http://127.0.0.1:${DAEMON_PORT} (PID ${process.pid})`))
  return server
}
