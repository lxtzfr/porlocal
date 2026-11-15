// What survives a daemon restart: leases (a port per workspace + service, kept while stopped), device bindings and
// the processes it launched (re-adopted by PID on start, without their output).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { State } from '../api.js'
import { STATE_FILE } from '../paths.js'

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
