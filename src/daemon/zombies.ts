import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ancestry, isInteractiveShell, type ProcInfo } from '../procs.js'
import type { State, Zombie } from '../api.js'

// Apps that run from a checkout without being a dev server left behind (Unity's -projectPath, an IDE's folder).
const APPS = /^(code|code - insiders|cursor|claude|unity|unity hub|idea64|webstorm64|rider64|devenv|explorer|windowsterminal)(\.exe)?$/i

// Any porlocal daemon or tray (another PORLOCAL_HOME, a slot's build): it and what it launched are porlocal's.
const OWN = /porlocal[^"\s]*[\\/]dist[\\/](daemon|tray)[\\/]main\.js/i
export const isPorlocalProcess = (cmd: string) => OWN.test(cmd)

/**
 * What of the checkout's zombies would race a launch of `runCmd` there: one listening (whatever it is, the port is
 * ours to take) or a left-over watcher not listening right now, whose command line carries the run command's arguments
 * (`pnpm start:dev` rebuilds and rebinds on the next file change). Another service of the checkout is left alone.
 */
export function leftOverOf(zombies: Zombie[], checkout: string, runCmd: string): Zombie[] {
  const args = runCmd.trim().split(/\s+/).slice(1)
  return zombies.filter((z) => z.checkout === checkout && (z.ports.length > 0 || args.every((a) => z.cmd.includes(a))))
}

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
  const related = (pid: number) => ancestry(table, pid).some((p) => managed.has(p.pid) || self.includes(p.pid) || isPorlocalProcess(p.cmd))
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

  // Up through what the dev command spawned (`cmd /c`, pnpm, a watcher), never into a terminal, an app or the system:
  // killing only the server leaves a watcher that starts it again.
  const rootOf = (proc: ProcInfo): ProcInfo => {
    let top = proc
    for (let parent = table.get(top.ppid); parent && parent.pid > 4 && parent !== top; parent = table.get(top.ppid)) {
      if (APPS.test(parent.name) || isInteractiveShell(parent)) break
      top = parent
    }
    return top
  }

  const zombies: Zombie[] = []
  for (const p of table.values()) {
    if (APPS.test(p.name) || related(p.pid)) continue
    const ports = (listening.get(p.pid) ?? []).sort((a, b) => a - b)
    const root = rootOf(p)
    const orphan = !table.has(root.ppid)
    // One row per tree: what listens, else the orphaned top itself.
    if (!ports.length && !(orphan && root === p)) continue
    const checkout = checkoutOf(p)
    if (checkout) zombies.push({ pid: p.pid, name: p.name, cmd: p.cmd, ports, checkout, root: root.pid, orphan })
  }
  return zombies.sort((a, b) => a.checkout.localeCompare(b.checkout) || a.pid - b.pid)
}
