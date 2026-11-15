// `.env.local` block as wt writes it, filled with the ports porlocal leased instead of the declared ones. What it
// can't resolve (`{database:...}` without the main `.env`, a target with no port) keeps the block's current value.

import { envRefs as wtEnvRefs, readBlock, resolveEnv as wtResolveEnv, writeBlock } from '@lxtzfr/wt'
import { refTarget, type Workspace } from './workspace.js'

export { LOCAL_ENV, readBlock, writeBlock } from '@lxtzfr/wt'

export type PortOf = (workspace: string, service: string) => number | undefined

/** `myStack.env` of `ws` with every placeholder resolved, its `{port:...}` / `{url:...}` through `portOf`. */
export function resolveEnv(ws: Workspace, portOf: PortOf): { values: Record<string, string>; skipped: string[] } {
  const current = readBlock(ws.path)
  const resolved = wtResolveEnv(ws, { env: ws.env, portOf: (t) => portOf(t.path, t.service) })
  const values = { ...resolved.values }
  for (const { key } of resolved.skipped) if (current[key] !== undefined) values[key] = current[key]
  // Back in the declared order: a kept value goes where its key is.
  const ordered = Object.fromEntries(Object.keys(ws.env).filter((k) => k in values).map((k) => [k, values[k]!]))
  return { values: ordered, skipped: resolved.skipped.map(({ key, reason }) => `${key}: ${reason}`) }
}

/** `{port}` / `{url}` (this service), `{port:<ref>}` / `{url:<ref>}` in a command line. */
export function expandCommand(cmd: string, ws: Workspace, port: number, portOf: PortOf): string {
  return cmd
    .replace(/\{port\}/g, String(port))
    .replace(/\{url\}/g, `http://localhost:${port}`)
    .replace(/\{(port|url):([^}]+)\}/g, (match, kind: string, ref: string) => {
      const target = refTarget(ws, ref)
      const p = portOf(target.workspace, target.service)
      if (p === undefined) return match
      return kind === 'url' ? `http://localhost:${p}` : String(p)
    })
}

/** Every `{port:<ref>}` / `{url:<ref>}` of `ws`'s env: which key points at which service of which checkout. */
export const envRefs = (ws: Workspace) => wtEnvRefs(ws, ws.env).map(({ key, target }) => ({ key, workspace: target.path, service: target.service }))

/** Does `ws`'s env reference `<repo>/<service>` in the checkout `target`? (a dependent to rewrite on a port change) */
export const dependsOn = (ws: Workspace, target: string, service: string) => envRefs(ws).some((r) => r.workspace === target && r.service === service)
