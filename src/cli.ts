#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { autostartStatus, disableAutostart, enableAutostart } from './autostart.js'
import { api, ApiError, daemonUp, ensureDaemon } from './client.js'
import { DAEMON_LOG, DAEMON_URL } from './paths.js'
import { readMsysParents } from './procs.js'
import { resolveWorkspace, workspaceLabel } from './workspace.js'
import type { Lease, Managed, StateResponse, Zombie } from './api.js'

const USAGE = `porlocal: leases ports, supervises dev servers, maps device ports (optional: projects run without it)

  porlocal run [<service>] [--keep-port] [--owner <pid>|none] [--grace <s>] [-f] [-- <cmd>]
  porlocal up                          every declared service of this checkout (package.json myStack.services)
  porlocal ls [--json]                 processes, ports, owners
  porlocal stop|restart|keep|forget <service|id>      keep: no owner any more (runs until stopped)
  porlocal logs <service|id> [-f] [-n <lines>]
  porlocal zombies [--json] | kill <pid>  dev processes of these checkouts not run by porlocal (a pnpm dev by hand, left over)
  porlocal lease <service> [--new-port] | release <service>
  porlocal device bind <service|repo/service> --port <device port> [--device <serial>]
  porlocal device unbind --port <device port> [--device <serial>] | device ls
  porlocal dashboard | daemon start|status|stop | daemon autostart [on|off]   autostart: at Windows login

  <cmd> may use {port}, {url}, {port:<repo>/<service>}, {url:<repo>/<service>}. The owner (default: the terminal,
  IDE or Claude Code session that ran porlocal) dying stops the process after --grace (30 s).`

interface Args {
  _: string[]
  flags: Record<string, string | true>
  cmd?: string
}

function parse(argv: string[]): Args {
  const dash = argv.indexOf('--')
  const own = dash >= 0 ? argv.slice(0, dash) : argv
  const args: Args = { _: [], flags: {}, cmd: dash >= 0 ? argv.slice(dash + 1).join(' ') : undefined }
  const valued = new Set(['owner', 'grace', 'n', 'port', 'device'])
  for (let i = 0; i < own.length; i++) {
    const a = own[i]!
    if (a.startsWith('-')) {
      const key = a.replace(/^-+/, '')
      args.flags[key] = valued.has(key) ? (own[++i] ?? '') : true
    } else args._.push(a)
  }
  return args
}

const fail = (message: string): never => {
  console.error(`porlocal: ${message}`)
  process.exit(1)
}

function here() {
  return resolveWorkspace(process.cwd())
}

/** `api` -> `server-2/api` (this checkout); an id with a `/` is taken as is. */
function toId(target: string | undefined): string {
  if (!target) fail('which service? (porlocal ls lists them)')
  return target!.includes('/') ? target! : `${workspaceLabel(here())}/${target}`
}

function defaultService(): string {
  const names = Object.keys(here().services)
  if (names.length === 1) return names[0]!
  return fail(names.length ? `which service: ${names.join(', ')}?` : 'no service declared here (package.json myStack.services): porlocal run <name> -- <cmd>')
}

function describe(p: Managed): string {
  const state = p.status === 'ready' ? 'ready' : p.status === 'starting' ? 'still starting (porlocal logs to follow)' : `${p.status}${p.exitCode != null ? ` (code ${p.exitCode})` : ''}`
  const head = `${p.id} on http://localhost:${p.port}: ${state}, PID ${p.pid}, owner ${p.owner ? `${p.owner.name} (${p.owner.pid})` : 'none'}`
  return [head, ...(p.notes ?? []).map((note) => `  ${note}`)].join('\n')
}

async function follow(id: string, lines: number): Promise<void> {
  let shown = ''
  for (;;) {
    const { text } = await api<{ text: string }>(`/api/logs?id=${encodeURIComponent(id)}&tail=${lines}`)
    if (text !== shown) {
      process.stdout.write(text.startsWith(shown) ? text.slice(shown.length) : `\n${text}`)
      shown = text
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

async function run(args: Args, service?: string): Promise<Managed> {
  const owner = args.flags.owner
  const p = await api<Managed>('/api/run', {
    cwd: process.cwd(),
    service: service ?? args._[1] ?? defaultService(),
    cmd: args.cmd,
    callerPid: process.pid,
    parentHints: readMsysParents(),
    ownerPid: owner === undefined ? undefined : owner === 'none' ? null : Number(owner),
    env: process.env,
    keepPort: !!args.flags['keep-port'],
    graceSec: args.flags.grace ? Number(args.flags.grace) : undefined,
  })
  console.log(describe(p))
  return p
}

function printTable(rows: string[][]): void {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)))
  for (const row of rows) console.log(row.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd())
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2))
  const [command, sub] = args._
  if (!command || args.flags.help || args.flags.h) return console.log(USAGE)

  if (command === 'daemon') {
    if (sub === 'status') return console.log((await daemonUp()) ? `running at ${DAEMON_URL} (log: ${DAEMON_LOG})` : 'not running')
    if (sub === 'stop') return void (await api('/api/shutdown', {}).catch(() => console.log('not running')))
    if (sub === 'autostart') {
      const mode = args._[2]
      if (mode === 'on') enableAutostart()
      else if (mode === 'off') disableAutostart()
      else if (mode) throw new ApiError('daemon autostart [on|off]')
      return console.log(`autostart: ${autostartStatus()}`)
    }
    await ensureDaemon()
    return console.log(`running at ${DAEMON_URL}`)
  }

  await ensureDaemon()
  switch (command) {
    case 'run': {
      const p = await run(args)
      if (args.flags.f || args.flags.follow) await follow(p.id, 50)
      return
    }
    case 'up': {
      const ws = here()
      const names = Object.entries(ws.services).filter(([, s]) => s.run).map(([n]) => n)
      if (!names.length) fail('no service with a run command here (package.json myStack.services)')
      for (const name of names) await run({ ...args, cmd: undefined }, name).catch((err) => console.error(`porlocal: ${name}: ${err.message}`))
      return
    }
    case 'ls':
    case 'ps': {
      const state = await api<StateResponse>('/api/state')
      if (args.flags.json) return console.log(JSON.stringify(state, null, 2))
      if (!state.processes.length) return console.log('nothing launched yet')
      printTable([
        ['id', 'port', 'status', 'pid', 'owner', 'checkout'],
        ...state.processes.map((p) => [
          p.id,
          String(p.port),
          p.status + (p.ownerLostAt ? ' (owner gone)' : ''),
          String(p.pid),
          p.owner ? `${p.owner.name} ${p.owner.pid}` : '-',
          p.workspace,
        ]),
      ])
      return
    }
    case 'stop':
    case 'restart':
    case 'keep':
    case 'forget': {
      const result = await api<Managed | null>(`/api/${command}`, { id: toId(sub) })
      return console.log(result && command !== 'forget' ? describe(result) : `${toId(sub)}: ${command}`)
    }
    case 'zombies': {
      const zombies = await api<Zombie[]>('/api/zombies')
      if (args.flags.json) return console.log(JSON.stringify(zombies, null, 2))
      if (!zombies.length) return console.log('none: every dev process of these checkouts runs under porlocal')
      printTable([['pid', 'name', 'ports', 'orphan', 'checkout', 'command'], ...zombies.map((z) => [String(z.pid), z.name, z.ports.join(' ') || '-', z.orphan ? 'yes' : '', z.checkout, z.cmd.slice(0, 80)])])
      return console.log('\nporlocal kill <pid> stops one (its whole tree)')
    }
    case 'kill': {
      if (!sub) fail('porlocal kill <pid>   (a PID listed by porlocal zombies)')
      const z = await api<Zombie>('/api/kill', { pid: Number(sub) })
      return console.log(`killed PID ${z.pid} (${z.name}, ${z.checkout})`)
    }
    case 'logs': {
      const id = toId(sub)
      const lines = Number(args.flags.n ?? 100)
      if (args.flags.f || args.flags.follow) return follow(id, lines)
      return console.log((await api<{ text: string }>(`/api/logs?id=${encodeURIComponent(id)}&tail=${lines}`)).text)
    }
    case 'lease': {
      const r = await api<{ port: number }>('/api/lease', { cwd: process.cwd(), service: sub ?? defaultService(), newPort: !!args.flags['new-port'] })
      return console.log(r.port)
    }
    case 'release': {
      const r = await api<Lease | null>('/api/release', { cwd: process.cwd(), service: sub ?? defaultService() })
      return console.log(r ? `released ${r.port}` : 'no lease')
    }
    case 'device': {
      const device = typeof args.flags.device === 'string' ? args.flags.device : 'all'
      if (sub === 'ls') {
        const s = await api<{ devices: string[]; bindings: Array<{ device: string; devicePort: number; hostPort?: number; service: string; workspace: string }>; adb: boolean }>('/api/state')
        if (!s.adb) console.log('adb not found (set ADB to its path)')
        console.log(`connected: ${s.devices.join(', ') || 'none'}`)
        for (const b of s.bindings) console.log(`  ${b.device}  localhost:${b.devicePort} -> host ${b.hostPort ?? '?'}  ${b.service}  ${b.workspace}`)
        return
      }
      if (!args.flags.port) fail('--port <device port> is required')
      if (sub === 'bind') {
        const ref = args._[2] ?? defaultService()
        const b = await api('/api/device/bind', { cwd: process.cwd(), ref, devicePort: Number(args.flags.port), device })
        return console.log(`bound ${device}: localhost:${b.devicePort} -> ${b.service} (${b.workspace}), re-applied on every reconnection`)
      }
      if (sub === 'unbind') {
        const removed = await api<unknown[]>('/api/device/unbind', { devicePort: Number(args.flags.port), device })
        return console.log(`${removed.length} binding(s) removed`)
      }
      return fail('device bind|unbind|ls')
    }
    case 'dashboard': {
      console.log(DAEMON_URL)
      const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', DAEMON_URL]] : process.platform === 'darwin' ? ['open', [DAEMON_URL]] : ['xdg-open', [DAEMON_URL]]
      spawn(opener[0] as string, opener[1] as string[], { stdio: 'ignore', detached: true, windowsHide: true }).unref()
      return
    }
    default:
      fail(`unknown command "${command}"\n\n${USAGE}`)
  }
}

main().catch((err) => fail(err instanceof ApiError ? err.message : (err as Error).stack ?? String(err)))
