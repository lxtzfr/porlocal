import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Logger } from '../log.js'
import { DAEMON_PORT } from '../paths.js'
import { listeningPorts } from '../ports.js'
import { isAlive, killTree, processTable } from '../procs.js'
import { normalize, refTarget, resolveWorkspace } from '../workspace.js'
import type { MachineResponse, StateResponse } from '../api.js'
import type { Adb } from './adb.js'
import { eventStream, Feed } from './events.js'
import { followLog, tailText } from './logTail.js'
import { dashboardFile } from './static.js'
import { Supervisor, UserError, type RunRequest } from './supervisor.js'
import { findZombies } from './zombies.js'
import { projectPorts } from './projectPorts.js'
import { cachedWorkspaces, checkouts } from './checkouts.js'
import { projectGroups } from './projectGroups.js'
import { runWt } from './wtActions.js'

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

export function startServer(sup: Supervisor, adb: Adb, log: Logger, shutdown: () => void) {
  // One process table + port scan for both views: the table alone takes a PowerShell call on Windows.
  const machine = (): MachineResponse => {
    const table = processTable()
    const listening = listeningPorts()
    const zombies = findZombies(sup.state, table, listening, [process.pid])
    const ports = projectPorts(sup.state, table, listening, zombies)
    const listeningSet = new Set([...listening.values()].flat())
    const list = checkouts({ state: sup.state, zombies, listening: listeningSet, workspace })
    return { zombies, ports, checkouts: list, groups: projectGroups(list, (path) => workspace(path).main) }
  }
  const workspace = cachedWorkspaces(resolveWorkspace)
  const zombies = () => machine().zombies
  const state = (): StateResponse => ({
    processes: sup.state.processes.map((p) => ({ ...p, ownerAlive: p.owner ? isAlive(p.owner.pid) : null })),
    leases: sup.state.leases,
    bindings: sup.state.bindings.map((b) => ({ ...b, hostPort: sup.portOf(b.workspace, b.service) })),
    devices: [...adb.devices],
    adb: adb.available,
  })
  // The machine is slower: the whole process table is read.
  const feeds = { state: new Feed('state', state, 1000, log), machine: new Feed('machine', machine, 5000, log) }
  const knownCheckout = (path: unknown) => {
    const target = typeof path === 'string' ? normalize(path) : ''
    if (!machine().checkouts.some((c) => c.path === target)) throw new UserError(`${String(path)} is no checkout porlocal shows`)
    return resolveWorkspace(target)
  }
  const findProcess = (url: URL) => {
    const p = sup.find(url.searchParams.get('id') ?? '')
    if (!p) throw new UserError('unknown process')
    return p
  }
  const streams: Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => void> = {
    '/api/events': (_, res) => {
      const s = eventStream(res)
      feeds.state.add(s)
      feeds.machine.add(s)
    },
    '/api/logs/stream': (_, res, url) => {
      const p = findProcess(url)
      const s = eventStream(res)
      s.onClose(followLog(p.logFile, Number(url.searchParams.get('tail') ?? 200), (chunk) => s.send(chunk.kind, JSON.stringify(chunk.text))))
    },
  }
  const routes: Record<string, (body: any, url: URL) => Promise<unknown> | unknown> = {
    'GET /api/health': () => ({ ok: true, pid: process.pid, version: VERSION }),
    'GET /api/state': state,
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
      const p = findProcess(url)
      return { id: p.id, text: tailText(p.logFile, Number(url.searchParams.get('tail') ?? 200)) }
    },
    'GET /api/machine': machine,
    'GET /api/zombies': () => zombies(),
    'GET /api/ports': () => machine().ports,
    // Only a PID listed as a zombie right now: never a way to kill any process by number.
    'POST /api/kill': (body) => {
      const z = zombies().find((x) => x.pid === Number(body.pid))
      if (!z) throw new UserError(`PID ${body.pid} is not a process left outside porlocal (porlocal zombies)`)
      killTree(z.pid)
      log.info(`killed zombie PID ${z.pid} (${z.name}, ${z.checkout}${z.ports.length ? `, ports ${z.ports.join(' ')}` : ''})`)
      return z
    },
    // A checkout the dashboard shows, never any folder: these write files and move branches.
    'POST /api/checkout/env': (body) => {
      const ws = knownCheckout(body.path)
      const values = sup.writeEnv(ws)
      log.info(`${ws.name}: .env.local rewritten on request`)
      return { keys: Object.keys(values) }
    },
    'POST /api/checkout/wt': (body) => runWt(knownCheckout(body.path), body.command, log),
    // Exits just after answering: the caller waits for this PID to be gone (stopDaemon).
    'POST /api/shutdown': () => {
      setTimeout(shutdown, 100)
      return { ok: true, pid: process.pid }
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
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const file = dashboardFile(url.pathname)
      res.writeHead(file.status, file.headers).end(file.body)
      return
    }
    const stream = req.method === 'GET' ? streams[url.pathname] : undefined
    if (stream) {
      try {
        stream(req, res, url)
      } catch (err) {
        res.writeHead(err instanceof UserError ? 400 : 500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (err as Error).message }))
      }
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
      // An action changed something: listeners get it now, not at the next tick.
      if (req.method === 'POST') for (const f of Object.values(feeds)) f.poke()
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
