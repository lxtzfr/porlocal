import type { Lease, PortHolder, ProjectPort, State, Zombie } from '../api.js'
import { ancestry, type ProcInfo } from '../procs.js'
import { isPorlocalProcess } from './zombies.js'

/**
 * The ports of the projects porlocal knows, each with who holds it: their leases (and the declared port of one that
 * moved), what porlocal runs, the dev processes of their checkouts started by hand. Not the rest of the machine.
 */
export function projectPorts(state: State, table: Map<number, ProcInfo>, listening: Map<number, number[]>, zombies: Zombie[]): ProjectPort[] {
  const running = state.processes.filter((p) => p.status === 'starting' || p.status === 'ready')
  const byPid = new Map(running.map((p) => [p.pid, p]))
  const zombieByPid = new Map(zombies.map((z) => [z.pid, z]))
  const holders = new Map<number, number>()
  for (const [pid, ports] of listening) for (const port of ports) if (!holders.has(port)) holders.set(port, pid)

  // A managed PID can be a wrapper (`cmd /c`) with the listener under it.
  const holderOf = (port: number): PortHolder | null => {
    const pid = holders.get(port)
    if (pid === undefined) return null
    for (const p of ancestry(table, pid)) {
      const managed = byPid.get(p.pid)
      if (managed) return { kind: 'porlocal', id: managed.id, pid }
      if (isPorlocalProcess(p.cmd)) return { kind: 'porlocal', id: /[\\/]tray[\\/]/.test(p.cmd) ? 'tray' : 'daemon', pid }
    }
    const z = zombieByPid.get(pid)
    if (z) return { kind: 'zombie', pid, name: z.name, cmd: z.cmd, checkout: z.checkout }
    const proc = table.get(pid)
    return { kind: 'other', pid, name: proc?.name ?? '?', cmd: proc?.cmd ?? '' }
  }
  const isOwn = (h: PortHolder | null, l: Lease) => h?.kind === 'porlocal' && running.some((p) => p.id === h.id && p.workspace === l.workspace && p.service === l.service)
  const statusOf = (h: PortHolder | null, l: Lease): ProjectPort['status'] =>
    !h ? 'free' : isOwn(h, l) ? 'ok' : h.kind === 'zombie' ? 'hand' : 'conflict'

  const rows: ProjectPort[] = []
  const seen = new Set<number>()
  for (const l of state.leases) {
    const expected = { workspace: l.workspace, service: l.service }
    const holder = holderOf(l.port)
    rows.push({ port: l.port, status: statusOf(holder, l), expected, holder })
    seen.add(l.port)
    if (l.preferred != null && l.preferred !== l.port) {
      rows.push({ port: l.preferred, status: 'moved', expected, movedTo: l.port, holder: holderOf(l.preferred) })
      seen.add(l.preferred)
    }
  }
  // What runs without a lease: porlocal's own ports, a `run -- <cmd>`, a dev server started by hand.
  for (const p of running) {
    if (!seen.has(p.port)) rows.push({ port: p.port, status: 'ok', holder: holderOf(p.port) })
    seen.add(p.port)
  }
  for (const z of zombies) {
    for (const port of z.ports) {
      if (!seen.has(port)) rows.push({ port, status: 'hand', holder: holderOf(port) })
      seen.add(port)
    }
  }
  return rows.sort((a, b) => a.port - b.port)
}
