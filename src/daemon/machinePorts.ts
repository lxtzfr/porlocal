import type { MachinePort, PortHolderKind, State, Zombie } from '../api.js'
import { ancestry, type ProcInfo } from '../procs.js'
import { isPorlocalProcess } from './zombies.js'

// OS services: listening on every Windows / macOS / Linux machine, never a dev server.
const SYSTEM_NAMES = /^(system|idle|svchost|lsass|wininit|services|spoolsv|smss|csrss|winlogon|launchd|systemd.*|sshd|cupsd|rpcbind|avahi-daemon|mdnsresponder|rapportd|controlcenter)(\.exe)?$/i
// IANA's ephemeral range (Windows' default too): ports the OS hands out, not ones anybody declares.
const EPHEMERAL_FROM = 49152

/** Every listening port with its process and who it belongs to, sorted by port. */
export function machinePorts(state: State, table: Map<number, ProcInfo>, listening: Map<number, number[]>, zombies: Zombie[]): MachinePort[] {
  const running = state.processes.filter((p) => p.status === 'starting' || p.status === 'ready')
  const byPid = new Map(running.map((p) => [p.pid, p.id]))
  const zombiePids = new Set(zombies.map((z) => z.pid))
  // A managed PID can be a wrapper (`cmd /c`) with the listener under it.
  const holderOf = (pid: number): PortHolderKind => {
    for (const p of ancestry(table, pid)) {
      const id = byPid.get(p.pid)
      if (id) return { kind: 'porlocal', id }
      // The daemon itself (and the tray): porlocal's, under their own name.
      if (isPorlocalProcess(p.cmd)) return { kind: 'porlocal', id: /[\\/]tray[\\/]/.test(p.cmd) ? 'tray' : 'daemon' }
    }
    return zombiePids.has(pid) ? { kind: 'zombie' } : { kind: 'other' }
  }

  const ports: MachinePort[] = []
  for (const [pid, held] of listening) {
    const proc = table.get(pid)
    const name = proc?.name ?? (pid === 4 ? 'System' : '?')
    const holder = holderOf(pid)
    const own = holder.kind === 'porlocal' ? running.find((p) => p.id === holder.id) : undefined
    for (const port of held) {
      // A lease's own process on its own port is the normal case, not a conflict.
      const wantedBy = state.leases
        .filter((l) => (l.preferred ?? l.port) === port && !(own && own.workspace === l.workspace && own.service === l.service))
        .map((l) => ({ workspace: l.workspace, service: l.service }))
      const system = holder.kind === 'other' && (port < 1024 || port >= EPHEMERAL_FROM || pid === 0 || pid === 4 || SYSTEM_NAMES.test(name))
      ports.push({ port, pid, name, cmd: proc?.cmd ?? '', holder, system, wantedBy })
    }
  }
  return ports.sort((a, b) => a.port - b.port || a.pid - b.pid)
}
