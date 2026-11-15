import { homedir } from 'node:os'
import { join } from 'node:path'

export const HOME = process.env.PORLOCAL_HOME ?? join(homedir(), '.porlocal')
export const STATE_FILE = join(HOME, 'state.json')
export const LOGS_DIR = join(HOME, 'logs')
export const DAEMON_LOG = join(HOME, 'daemon.log')
export const DAEMON_PORT = Number(process.env.PORLOCAL_PORT ?? 4780)
export const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`
// Undeclared services (`porlocal run x -- <cmd>`) and fallbacks when a declared port is taken: away from the
// 3000-3999 ranges projects declare.
export const DYNAMIC_RANGE = { from: 4100, to: 4999 }
