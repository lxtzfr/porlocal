import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { HOME } from '../paths.js'
import type { TrayView } from './view.js'
import { WINDOWS_HOST_PS1 } from './windowsHost.js'

/** A native tray icon driven by the Node side: one view per line in, `click <id>` lines out. One host per OS. */
export interface TrayHost {
  show(view: TrayView): void
  onClick(fn: (id: string) => void): void
  onExit(fn: (code: number | null) => void): void
}

export function trayHostSupported(): boolean {
  return process.platform === 'win32'
}

export function startTrayHost(log: (line: string) => void): TrayHost {
  if (!trayHostSupported()) throw new Error(`the tray icon is Windows-only for now (no ${process.platform} host yet)`)
  // Written at each start: the script always matches this build.
  const script = join(HOME, 'tray-host.ps1')
  writeFileSync(script, WINDOWS_HOST_PS1, 'utf-8')
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const clicks: Array<(id: string) => void> = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    const m = /^click (.+)$/.exec(line.trim())
    if (m) for (const fn of clicks) fn(m[1]!)
  })
  createInterface({ input: child.stderr }).on('line', (line) => log(`host: ${line}`))
  let last = ''
  return {
    show: (view) => {
      // Balloons are one-shot: a view equal to the last one (no balloon) is not resent.
      const json = JSON.stringify(view)
      if (json === last && !view.balloons.length) return
      last = json
      child.stdin.write(`${json}\n`)
    },
    onClick: (fn) => void clicks.push(fn),
    onExit: (fn) => void child.on('exit', fn),
  }
}
