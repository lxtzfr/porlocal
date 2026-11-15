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
