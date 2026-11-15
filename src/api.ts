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

/** Who listens on a port: a process porlocal runs (its id), one of Outside porlocal (started by hand), any other app. */
export type PortHolder =
  | { kind: 'porlocal'; id: string; pid: number }
  | { kind: 'zombie'; pid: number; name: string; cmd: string; checkout: string }
  | { kind: 'other'; pid: number; name: string; cmd: string }

/**
 * ok: its service on it under porlocal; free: nothing on it; moved: the declared port was taken, the service got
 * `movedTo`; hand: a dev process of a checkout, outside porlocal; conflict: another service or app holds it.
 */
export type PortStatus = 'ok' | 'free' | 'moved' | 'hand' | 'conflict'

/** A port of the projects porlocal knows: leased or declared, run by it, or held by one of their dev processes. */
export interface ProjectPort {
  port: number
  status: PortStatus
  /** The service that has this port (leased, or declared before it moved). */
  expected?: { workspace: string; service: string }
  movedTo?: number
  holder: PortHolder | null
}

/**
 * ok: the target listens and `.env.local` holds its port; down: nothing listens on it; stale: `.env.local` holds
 * another value (or none); unresolved: no port known for the target (not declared, never leased).
 */
export type LinkStatus = 'ok' | 'down' | 'stale' | 'unresolved'

/** An env key of a checkout pointing at a service of another (or the same) checkout: `{url:server/api}`. */
export interface CheckoutLink {
  key: string
  workspace: string
  service: string
  port: number | null
  status: LinkStatus
  /** The value in `.env.local` and the one it should hold, when they differ. */
  written?: string | null
  expected?: string
}

/** A checkout porlocal knows (it runs, leases or sees something there, it uses or is used by one of those). */
export interface Checkout {
  path: string
  repo: string
  /** 1 = the main checkout, n = slot n, null = a checkout outside the slot layout. */
  slot: number | null
  label: string
  branch: string | null
  issueUrl: string | null
  uses: CheckoutLink[]
  usedBy: { workspace: string; label: string; key: string; service: string; status: LinkStatus }[]
}

/** Checkouts linked together: a project's main checkouts, the slots of one ticket. */
export interface ProjectGroup {
  id: string
  /**
   * workspace: an umbrella project, its repos are sub-folders of a workspace repo (my-stack's `wt new --repos`);
   * solo: one repo on its own; linked: repos linked together without a workspace repo.
   */
  kind: 'workspace' | 'solo' | 'linked'
  /** The workspace repo, for an umbrella project. */
  workspace: string | null
  /** `TRA-SIM` (a workspace: its `*.code-workspace`, package name or folder), `website` (solo), `porlocal + my-stack`. */
  name: string
  /** `TRA-SIM`, `TRA-SIM · slot 2`, `TRA-SIM · main + slot 2` (a slot using a main checkout). */
  label: string
  /** When all its checkouts are on the same one. */
  branch: string | null
  issueUrl: string | null
  paths: string[]
}

/** What the daemon reads of the machine (one process table + port scan): `/api/events` `machine`. */
export interface MachineResponse {
  zombies: Zombie[]
  ports: ProjectPort[]
  checkouts: Checkout[]
  groups: ProjectGroup[]
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
