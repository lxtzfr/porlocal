import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProcInfo } from '../procs.js'
import type { State, Zombie } from '../api.js'

// Apps that run from a checkout without being a dev server left behind (Unity's -projectPath, an IDE's folder).
const APPS = /^(code|code - insiders|cursor|claude|unity|unity hub|idea64|webstorm64|rider64|devenv|explorer|windowsterminal)(\.exe)?$/i

// Any porlocal daemon (another PORLOCAL_HOME, a slot's build): it and what it launched are porlocal's, not zombies.
const DAEMON = /porlocal[^"\s]*[\\/]dist[\\/]daemon[\\/]main\.js/i

const isRepo = (path: string) => existsSync(join(path, '.git'))

/**
 * Processes of the checkouts porlocal knows (their folder: siblings and `.wt` slots) that porlocal did not launch and
 * that listen on a port or lost their parent: a `pnpm dev` started by hand, a server left by a closed terminal. IDE
 * helpers (tsserver, eslint) also run from a checkout, but neither listen nor lose their parent.
 */
export function findZombies(state: State, table: Map<number, ProcInfo>, listening: Map<number, number[]>, self: number[], repo = isRepo): Zombie[] {
  const roots = new Set<string>()
  for (const workspace of [...state.leases.map((l) => l.workspace), ...state.processes.map((p) => p.workspace)]) {
    const parent = dirname(workspace).toLowerCase()
    roots.add(parent)
    roots.add(`${parent}.wt`)
  }
  const managed = new Set(state.processes.filter((p) => p.status === 'starting' || p.status === 'ready').map((p) => p.pid))
  // A managed PID can be a wrapper (`cmd /c`) or, re-adopted, the port holder under it: both its tree and its chain.
  // A process under any porlocal daemon is skipped too.
  const related = (pid: number) => {
    for (let p = table.get(pid), depth = 0; p && depth < 30; p = table.get(p.ppid), depth++) if (managed.has(p.pid) || self.includes(p.pid) || DAEMON.test(p.cmd)) return true
    return false
  }
  const checkoutOf = (proc: ProcInfo): string | null => {
    for (let p: ProcInfo | undefined = proc, depth = 0; p && depth < 5; p = table.get(p.ppid), depth++) {
      const cmd = p.cmd.replace(/\\/g, '/')
      for (const root of roots) {
        const at = cmd.toLowerCase().indexOf(`${root}/`)
        if (at < 0) continue
        const base = cmd.slice(at, at + root.length)
        const segment = cmd.slice(at + root.length + 1).split(/[/"\s]/)[0]
        return segment && repo(join(base, segment)) ? `${base}/${segment}` : base
      }
    }
    return null
  }

  const zombies: Zombie[] = []
  for (const p of table.values()) {
    if (APPS.test(p.name) || related(p.pid)) continue
    const ports = (listening.get(p.pid) ?? []).sort((a, b) => a - b)
    const orphan = !table.has(p.ppid)
    if (!ports.length && !orphan) continue
    const checkout = checkoutOf(p)
    if (checkout) zombies.push({ pid: p.pid, name: p.name, cmd: p.cmd, ports, checkout, orphan })
  }
  return zombies.sort((a, b) => a.checkout.localeCompare(b.checkout) || a.pid - b.pid)
}
