import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DAEMON_LOG, DAEMON_URL, HOME } from './paths.js'

export class ApiError extends Error {}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${DAEMON_URL}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json()) as any
  if (!res.ok) throw new ApiError(data?.error ?? `HTTP ${res.status}`)
  return data as T
}

export async function daemonUp(): Promise<boolean> {
  try {
    await api('/api/health')
    return true
  } catch {
    return false
  }
}

// Detached so it outlives the shell that started it (a Claude Code tool call, a terminal tab).
export async function ensureDaemon(): Promise<void> {
  if (await daemonUp()) return
  mkdirSync(HOME, { recursive: true })
  const out = openSync(DAEMON_LOG, 'a')
  const main = join(dirname(fileURLToPath(import.meta.url)), 'daemon', 'main.js')
  spawn(process.execPath, [main], { detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref()
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100))
    if (await daemonUp()) return
  }
  throw new ApiError(`the daemon did not start: see ${DAEMON_LOG}`)
}
