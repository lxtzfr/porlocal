import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { DAEMON_LOG, DAEMON_URL, HOME, TRAY_LOG, TRAY_PID } from './paths.js'
import { isAlive, killTree } from './procs.js'

export class ApiError extends Error {}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${DAEMON_URL}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json()) as any
  if (!res.ok) throw new ApiError(data?.error ?? `HTTP ${res.status}`)
  return data as T
}

/** Reads a server-sent event stream until the daemon closes it (it stops) or `onEvent` throws. */
export async function streamEvents(path: string, onEvent: (event: string, data: any) => void): Promise<void> {
  const res = await fetch(`${DAEMON_URL}${path}`)
  if (!res.ok || !res.body) throw new ApiError(((await res.json().catch(() => null)) as any)?.error ?? `HTTP ${res.status}`)
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true })
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const event = /^event: (.*)$/m.exec(block)?.[1]
        const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
        if (event) onEvent(event, JSON.parse(data))
      }
    }
  } catch (err) {
    // The daemon went away mid-stream: the follow just ends.
    if ((err as Error).name !== 'TypeError') throw err
  }
}

export async function daemonUp(): Promise<boolean> {
  try {
    await api('/api/health')
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Stops the daemon and returns once its process is gone (so a `start` right after starts a new one); null: none ran. */
export async function stopDaemon(): Promise<number | null> {
  let pid: number | undefined
  try {
    // A daemon older than this CLI answers no PID: then only its health check going down tells.
    pid = (await api<{ pid?: number }>('/api/shutdown', {})).pid
  } catch {
    return null
  }
  for (let i = 0; i < 100; i++) {
    if ((pid === undefined || !isAlive(pid)) && !(await daemonUp())) return pid ?? 0
    await sleep(50)
  }
  throw new ApiError(`the daemon${pid ? ` (PID ${pid})` : ''} did not exit within 5 s: see ${DAEMON_LOG}`)
}

// Detached so it outlives the shell that started it (a Claude Code tool call, a terminal tab); output in its log.
function spawnDetached(entry: string, logFile: string): number | undefined {
  mkdirSync(HOME, { recursive: true })
  const out = openSync(logFile, 'a')
  const main = join(dirname(fileURLToPath(import.meta.url)), entry)
  const child = spawn(process.execPath, [main], { detached: true, stdio: ['ignore', out, out], windowsHide: true })
  child.unref()
  return child.pid
}

export async function ensureDaemon(): Promise<void> {
  if (await daemonUp()) return
  spawnDetached(join('daemon', 'main.js'), DAEMON_LOG)
  for (let i = 0; i < 50; i++) {
    await sleep(100)
    if (await daemonUp()) return
  }
  throw new ApiError(`the daemon did not start: see ${DAEMON_LOG}`)
}

/** The tray's PID when it runs (its own pid file: it has no API). */
export function trayPid(): number | null {
  const pid = existsSync(TRAY_PID) ? Number(readFileSync(TRAY_PID, 'utf-8')) : 0
  return pid && isAlive(pid) ? pid : null
}

export async function ensureTray(): Promise<number> {
  const running = trayPid()
  if (running) return running
  const pid = spawnDetached(join('tray', 'main.js'), TRAY_LOG)
  for (let i = 0; i < 50; i++) {
    await sleep(100)
    if (trayPid()) return trayPid()!
    if (pid && !isAlive(pid)) break
  }
  throw new ApiError(`the tray did not start: see ${TRAY_LOG}`)
}

/** Stops the tray and its PowerShell host (the whole tree); null: none ran. */
export function stopTray(): number | null {
  const pid = trayPid()
  if (!pid) return null
  killTree(pid)
  rmSync(TRAY_PID, { force: true })
  return pid
}
