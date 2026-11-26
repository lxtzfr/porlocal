// A workspace = one checkout as wt (`@lxtzfr/wt`) sees it: a repo's main checkout (n = 1) or one of its slots, with
// its declared services and env templates (package.json `localDev`). A repo without them still works with
// `porlocal run <name> -- <cmd>`.

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { declaredPort, projectConfig, normalize, refTarget as wtRefTarget, resolveCheckout, slotPort, slotsDir, type Checkout, type ServiceDecl } from '@lxtzfr/wt'

export { normalize, slotsDir, slotPort }

/** wt's service, plus porlocal's `stop`: its `run` then only starts it (a container) and `stop` ends it. */
export type Service = ServiceDecl & { stop?: string }

export interface Workspace extends Checkout {
  services: Record<string, Service>
  env: Record<string, string>
}

export function resolveWorkspace(cwd: string): Workspace {
  const checkout = resolveCheckout(cwd)
  const config = projectConfig(checkout.path)
  return { ...checkout, services: config.services ?? {}, env: config.env ?? {} }
}

export const workspaceLabel = (ws: Pick<Workspace, 'name'>) => ws.name

/** The checkout a `<repo>/<service>` (or same-repo `<service>`) reference points at from `ws`. */
export function refTarget(ws: Workspace, ref: string): { workspace: string; service: string } {
  const target = wtRefTarget(ws, ref)
  return { workspace: target.path, service: target.service }
}

/** The port wt gives this service in this checkout (declared main port + 10 per slot), if declared. */
export function preferredPort(ws: Workspace, service: string): number | undefined {
  const port = ws.n === null ? undefined : declaredPort(ws.path, ws.main, service)
  return port && ws.n ? slotPort(port, ws.n) : undefined
}

/** Every checkout next to `ws`'s repo (sibling main checkouts and their slots): where dependents can live. */
export function siblingCheckouts(ws: Workspace): string[] {
  const dirs = [dirname(ws.main), slotsDir(ws.main)]
  return dirs.flatMap((dir) => {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'package.json')))
      .map((d) => normalize(join(dir, d.name)))
  })
}
