// What survives a daemon restart: leases (a port per workspace + service, kept while stopped), device bindings and
// the processes it launched (re-adopted by PID on start, without their output).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { STATE_FILE } from '../paths.js'

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
  /** A port it reads (`{url:...}`) changed since it started. */
  needsRestart?: boolean
  adopted?: boolean
}

export interface State {
  leases: Lease[]
  bindings: Binding[]
  processes: Managed[]
}

export function loadState(): State {
  if (!existsSync(STATE_FILE)) return { leases: [], bindings: [], processes: [] }
  const raw = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as Partial<State>
  return { leases: raw.leases ?? [], bindings: raw.bindings ?? [], processes: raw.processes ?? [] }
}

export function saveState(state: State): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  const tmp = `${STATE_FILE}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  renameSync(tmp, STATE_FILE)
}
