// Slot actions run the checkout's own `pnpm wt` (the version its repo pins), from its main checkout: porlocal never
// moves a branch or merges by itself, and a repo without wt gets none (a slot-like folder alone is not enough).

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../log.js'
import type { Workspace } from '../workspace.js'
import { UserError } from './supervisor.js'

export const WT_COMMANDS = ['free', 'done'] as const
export type WtCommand = (typeof WT_COMMANDS)[number]

const TIMEOUT_MS = 180_000

/** Does `ws`'s repo run wt (a `wt` script in its main checkout's package.json)? */
export function usesWt(ws: Pick<Workspace, 'main'>): boolean {
  try {
    return typeof JSON.parse(readFileSync(join(ws.main, 'package.json'), 'utf-8')).scripts?.wt === 'string'
  } catch {
    return false
  }
}

/** Can the slot actions run on `ws`? */
export const hasSlotActions = (ws: Workspace) => ws.n !== null && ws.n >= 2 && usesWt(ws)

export function runWt(ws: Workspace, command: WtCommand, log: Logger): Promise<{ output: string }> {
  if (!WT_COMMANDS.includes(command)) throw new UserError(`unknown wt command "${command}"`)
  if (!ws.n || ws.n < 2) throw new UserError(`${ws.name} is no slot: nothing to ${command}`)
  if (!usesWt(ws)) throw new UserError(`${ws.repo} has no wt script: nothing runs ${command}`)
  // The shell (pnpm is a .cmd on Windows) gets the name unquoted: a slot name is `<repo>-<n>`, keep it that way.
  if (!/^[\w.-]+$/.test(ws.name)) throw new UserError(`unexpected slot name "${ws.name}"`)
  const { INIT_CWD, ...env } = process.env
  log.info(`${ws.name}: pnpm wt ${command} ${ws.name} (in ${ws.main})`)
  return new Promise((resolve, reject) => {
    execFile('pnpm', ['wt', command, ws.name], { cwd: ws.main, env, shell: process.platform === 'win32', windowsHide: true, timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim()
      if (err) {
        log.warn(`${ws.name}: wt ${command} failed: ${output || err.message}`)
        reject(new UserError(output || err.message))
      } else {
        log.info(`${ws.name}: wt ${command} ok`)
        resolve({ output })
      }
    })
  })
}
