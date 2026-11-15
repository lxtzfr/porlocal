import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from './log.js'

const log = createLogger('autostart')

// A Startup-folder script rather than a scheduled task: `schtasks /sc onlogon` needs an elevated shell.
function startupScript(): string {
  if (process.platform !== 'win32') throw new Error('autostart is Windows-only for now (launchd / systemd: not written yet)')
  const appData = process.env.APPDATA
  if (!appData) throw new Error('APPDATA is not set')
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'porlocal-daemon.vbs')
}

export function autostartStatus(): string {
  const file = startupScript()
  return existsSync(file) ? `on (${file})` : 'off'
}

// VBScript: window style 0 = no console flashing at login. `daemon start` goes through ensureDaemon (log file, detach).
export function enableAutostart(): string {
  const file = startupScript()
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'cli.js')
  const quote = (s: string) => `""${s}""`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `CreateObject("WScript.Shell").Run "${quote(process.execPath)} ${quote(cli)} daemon start", 0, False\r\n`)
  log.info(`daemon starts at login: ${file}`)
  return file
}

export function disableAutostart(): void {
  const file = startupScript()
  rmSync(file, { force: true })
  log.info(`daemon no longer starts at login (${file} removed)`)
}
