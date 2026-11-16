// The daemon: one per machine, started by the CLI on demand (detached), state in ~/.porlocal.

import { createLogger } from '../log.js'
import { Adb } from './adb.js'
import { seedProjects } from './projects.js'
import { startServer } from './server.js'
import { Supervisor } from './supervisor.js'

const log = createLogger('daemon')
const sup = new Supervisor(createLogger('supervisor'))
const adb = new Adb(sup.state, (b) => sup.portOf(b.workspace, b.service), () => sup.save(), createLogger('adb'))
sup.onPortChange = (workspace, service) => adb.refresh(workspace, service)
seedProjects(sup.state)

// Launched processes outlive the daemon on purpose (re-adopted on its next start): stopping it is not stopping them.
function shutdown(): void {
  log.info('shutting down (launched processes keep running)')
  adb.stop()
  server.close()
  process.exit(0)
}

const server = startServer(sup, adb, log, shutdown)
server.on('error', (err: NodeJS.ErrnoException) => {
  log.error(err.code === 'EADDRINUSE' ? 'another daemon already listens on this port' : 'server error', err)
  process.exit(1)
})
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', (err) => log.error('uncaught', err))
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err))
