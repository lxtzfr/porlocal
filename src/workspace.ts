// A workspace = one checkout: a repo's main checkout (n = 1) or one of its my-stack `wt` slots
// (`<parent>.wt/<repo>-<n>`). Its services and env templates come from package.json `myStack` (the contract shared
// with my-stack's `wt`, see envLocal.ts); a repo without them still works with `porlocal run <name> -- <cmd>`.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export interface ServiceDecl {
  port?: number
  run?: string
}

export interface Workspace {
  path: string
  main: string
  repo: string
  /** Slot number, 1 = main checkout; null for a checkout outside the slot layout (its ports are leased dynamically). */
  n: number | null
  services: Record<string, ServiceDecl>
  env: Record<string, string>
  /** `wt link`: repo -> slot n of the sibling repo this checkout talks to (absent = its main checkout). */
  links: Record<string, number>
}

function git(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const readJson = (path: string): any => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

// One spelling per folder: git prints long paths, a cwd can be a Windows 8.3 short one (C:/Users/ALEXAN~1).
export function normalize(path: string): string {
  let full = resolve(path)
  try {
    full = realpathSync.native(full)
  } catch {}
  return full.replace(/\\/g, '/').replace(/\/$/, '')
}

export const slotsDir = (main: string) => `${dirname(main)}.wt`
export const slotPath = (main: string, n: number) => (n === 1 ? main : normalize(join(slotsDir(main), `${basename(main)}-${n}`)))
export const slotPort = (port: number, n: number) => port + 10 * (n - 1)

export function resolveWorkspace(cwd: string): Workspace {
  const top = git(cwd, 'rev-parse', '--show-toplevel')
  const path = normalize(top ?? cwd)
  const common = git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  const main = common ? normalize(dirname(common)) : path
  const repo = basename(main)
  let n: number | null = path === main ? 1 : null
  if (n === null && normalize(dirname(path)) === normalize(slotsDir(main))) {
    const match = basename(path).match(new RegExp(`^${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`))
    if (match) n = Number(match[1])
  }
  const myStack = readJson(join(path, 'package.json'))?.myStack ?? {}
  const gitDir = git(path, 'rev-parse', '--path-format=absolute', '--git-dir')
  const links = (gitDir && readJson(join(gitDir, 'my-stack-wt.json'))?.links) ?? {}
  return { path, main, repo, n, services: myStack.services ?? {}, env: myStack.env ?? {}, links }
}

export const workspaceLabel = (ws: Pick<Workspace, 'repo' | 'n' | 'path'>) =>
  ws.n === 1 ? ws.repo : ws.n ? `${ws.repo}-${ws.n}` : `${ws.repo}@${basename(ws.path)}`

/** The checkout a `<repo>/<service>` (or same-repo `<service>`) reference points at from `ws`. */
export function refTarget(ws: Workspace, ref: string): { workspace: string; service: string } {
  if (!ref.includes('/')) return { workspace: ws.path, service: ref }
  const [repo, service] = ref.split('/') as [string, string]
  if (repo === ws.repo) return { workspace: ws.path, service }
  const main = normalize(join(dirname(ws.main), repo))
  return { workspace: slotPath(main, ws.links[repo] ?? 1), service }
}

/** The port `wt` gives this service in this checkout (declared main port + 10 per slot), if declared. */
export function preferredPort(ws: Workspace, service: string): number | undefined {
  const port = ws.services[service]?.port ?? readJson(join(ws.main, 'package.json'))?.myStack?.services?.[service]?.port
  if (!port || ws.n === null) return undefined
  return slotPort(Number(port), ws.n)
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
