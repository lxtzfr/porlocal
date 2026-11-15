// The tray: one per user session, started detached (`porlocal tray`, login autostart). It outlives the daemon on
// purpose: a grey icon says the daemon is down and its menu starts it again.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { StateResponse } from '../api.js'
import { ensureDaemon, stopDaemon, streamEvents } from '../client.js'
import { createLogger } from '../log.js'
import { openUrl } from '../opener.js'
import { DAEMON_URL, TRAY_PID } from '../paths.js'
import { isAlive } from '../procs.js'
import { startTrayHost } from './host.js'
import { trayView } from './view.js'

const log = createLogger('tray')

const other = existsSync(TRAY_PID) ? Number(readFileSync(TRAY_PID, 'utf-8')) : 0
if (other && other !== process.pid && isAlive(other)) {
  log.info(`already running (PID ${other})`)
  process.exit(0)
}
writeFileSync(TRAY_PID, String(process.pid))

const host = startTrayHost((line) => log.warn(line))
let current: StateResponse | null = null
host.show(trayView(null, null))

function quit(code: number): never {
  rmSync(TRAY_PID, { force: true })
  process.exit(code)
}
host.onExit((code) => {
  log.info(`host exited (${code}): tray closed`)
  quit(0)
})

const actions: Record<string, () => Promise<unknown> | void> = {
  dashboard: () => openUrl(DAEMON_URL),
  'daemon:start': () => ensureDaemon(),
  'daemon:stop': () => stopDaemon(),
  'daemon:restart': async () => {
    await stopDaemon()
    await ensureDaemon()
  },
  quit: () => {},
}
host.onClick(async (id) => {
  log.info(`click ${id}`)
  const port = /^open:(\d+)$/.exec(id)?.[1]
  try {
    if (port) openUrl(`http://localhost:${port}`)
    else await actions[id]?.()
  } catch (err) {
    log.error(id, err)
    host.show({ ...trayView(current, current), balloons: [{ title: `porlocal: ${id} failed`, text: (err as Error).message }] })
  }
})

// The daemon pushes its state; a closed or refused stream means it is down: grey, then reconnect.
for (;;) {
  try {
    await streamEvents('/api/events', (event, data) => {
      if (event !== 'state') return
      host.show(trayView(data, current))
      current = data
    })
  } catch {
    // Refused: the daemon is not running.
  }
  if (current) log.info('daemon unreachable')
  current = null
  host.show(trayView(null, null))
  await new Promise((r) => setTimeout(r, 2000))
}
