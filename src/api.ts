// What the daemon's JSON API answers, shared by the daemon, the CLI and the dashboard: types only (the dashboard
// bundle must not pull node code in).

export interface Lease {
  workspace: string
  service: string
  port: number
  /** The port `wt` would give it; differs when that one was taken. */
  preferred?: number
}

export interface Binding {
  workspace: string
  service: string
  devicePort: number
  /** A device serial, or `all`. */
  device: string
}

export interface Owner {
  pid: number
  name: string
}

export type Status = 'starting' | 'ready' | 'exited' | 'stopped'

export interface Managed {
  id: string
  workspace: string
  label: string
  service: string
  port: number
  cmd: string
  pid: number
  owner: Owner | null
  ownerLostAt?: number
  graceMs: number
  status: Status
  exitCode?: number | null
  stopReason?: string
  startedAt: number
  logFile: string
  adopted?: boolean
  /** What the run did beyond starting it (a port move, dependents restarted): in the API answer, never persisted. */
  notes?: string[]
}

export interface State {
  leases: Lease[]
  bindings: Binding[]
  processes: Managed[]
}

export interface Zombie {
  pid: number
  name: string
  cmd: string
  ports: number[]
  /** The checkout its command line (or an ancestor's) runs from. */
  checkout: string
  /** Its parent is gone: a terminal or a launcher closed under it. */
  orphan: boolean
}

/** Who holds a listening port: a process porlocal runs (its id), one of Outside porlocal, or anything else. */
export type PortHolderKind = { kind: 'porlocal'; id: string } | { kind: 'zombie' } | { kind: 'other' }

export interface MachinePort {
  port: number
  pid: number
  name: string
  cmd: string
  holder: PortHolderKind
  /** Hidden unless asked: below 1024, the ephemeral range, OS processes. */
  system: boolean
  /** Leases whose declared port this is, held by something else. */
  wantedBy: { workspace: string; service: string }[]
}

/** What the daemon reads of the machine (one process table + port scan): `/api/events` `machine`. */
export interface MachineResponse {
  zombies: Zombie[]
  ports: MachinePort[]
}

export interface StateResponse {
  processes: (Managed & { ownerAlive: boolean | null })[]
  leases: Lease[]
  bindings: (Binding & { hostPort: number | undefined })[]
  devices: string[]
  adb: boolean
}

export interface LogsResponse {
  id: string
  text: string
}
