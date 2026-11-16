import { existsSync } from 'node:fs'
import type { Checkout, CheckoutLink, LinkStatus, State, Zombie } from '../api.js'
import { envRefs, readBlock, resolveEnv } from '../envLocal.js'
import { currentBranch, detachedHead, issueUrl, remoteOf, remoteWebUrl } from '../gitInfo.js'
import { preferredPort, siblingCheckouts, workspaceLabel, type Workspace } from '../workspace.js'
import { hasSlotActions } from './wtActions.js'

export interface CheckoutsInput {
  state: State
  zombies: Zombie[]
  listening: Set<number>
  /** A (cached) `resolveWorkspace`: each call spawns git. */
  workspace: (path: string) => Workspace
  /** Every worktree of the projects in wt's user map: shown whether anything runs there or not. */
  worktrees?: () => string[]
}

/**
 * The checkouts porlocal knows (what it leases, runs, binds, or sees started by hand), the ones their env points at,
 * and the siblings whose env points at them; each with its branch and links. One level deep: never the whole disk.
 */
export function checkouts({ state, zombies, listening, workspace, worktrees = () => [] }: CheckoutsInput): Checkout[] {
  const portOf = (path: string, service: string) =>
    state.leases.find((l) => l.workspace === path && l.service === service)?.port ?? (existsSync(path) ? preferredPort(workspace(path), service) : undefined)

  const known = new Set([...state.leases, ...state.processes, ...state.bindings].map((x) => x.workspace))
  for (const z of zombies) known.add(z.checkout)
  for (const path of worktrees()) known.add(path)
  // A free slot still points at the main checkouts: listed as a slot of the project, never as a link target.
  const isFree = (path: string) => {
    const ws = workspace(path)
    return ws.n !== null && ws.n >= 2 && detachedHead(path)
  }
  const paths = new Set(known)
  for (const path of known) {
    if (!existsSync(path)) continue
    const ws = workspace(path)
    for (const r of envRefs(ws)) if (existsSync(r.workspace) && !isFree(r.workspace)) paths.add(r.workspace)
    for (const sibling of siblingCheckouts(ws)) {
      if (paths.has(sibling)) continue
      if (isFree(sibling) || envRefs(workspace(sibling)).some((r) => known.has(r.workspace))) paths.add(sibling)
    }
  }

  const linksOf = (ws: Workspace): CheckoutLink[] => {
    const written = readBlock(ws.path)
    const { values } = resolveEnv(ws, portOf)
    const links = envRefs(ws).map((r): CheckoutLink => {
      const port = portOf(r.workspace, r.service) ?? null
      const has = r.key in written
      const status: LinkStatus =
        port === null ? 'unresolved' : !has || written[r.key] !== values[r.key] ? 'stale' : listening.has(port) ? 'ok' : 'down'
      return { ...r, port, status, ...(status === 'stale' ? { written: has ? written[r.key] : null, expected: values[r.key] } : {}) }
    })
    // `PORT={port:api}` is how a service gets its own port: noise, unless `.env.local` got it wrong.
    return links.filter((l) => l.workspace !== ws.path || l.status === 'stale' || l.status === 'unresolved')
  }

  const list = [...paths].filter(existsSync).map((path) => {
    const ws = workspace(path)
    const free = isFree(path)
    const branch = free ? null : currentBranch(path)
    const web = remoteWebUrl(ws.main)
    return { path, repo: ws.repo, slot: ws.n, free, slotActions: hasSlotActions(ws), label: workspaceLabel(ws), remote: remoteOf(web), branch, issueUrl: issueUrl(branch, web), uses: linksOf(ws), usedBy: [] } as Checkout
  })
  const byPath = new Map(list.map((c) => [c.path, c]))
  // Only a user with something up (not a free slot, not an idle checkout), in the group or out of it.
  const isUp = (path: string) => state.processes.some((p) => p.workspace === path && (p.status === 'starting' || p.status === 'ready'))
  for (const c of list.filter((x) => isUp(x.path))) {
    for (const l of c.uses) if (l.workspace !== c.path) byPath.get(l.workspace)?.usedBy.push({ workspace: c.path, label: c.label, key: l.key, service: l.service, status: l.status })
  }
  // Main checkout first, then its slots, repo by repo.
  return list.sort((a, b) => a.repo.localeCompare(b.repo) || (a.slot ?? 99) - (b.slot ?? 99) || a.path.localeCompare(b.path))
}

/** `resolveWorkspace` memoised for `ttlMs`: env, services and `wt link` change rarely, the machine is read every 5 s. */
export function cachedWorkspaces(resolve: (path: string) => Workspace, ttlMs = 30_000) {
  const cache = new Map<string, { ws: Workspace; at: number }>()
  return (path: string): Workspace => {
    const hit = cache.get(path)
    if (hit && Date.now() - hit.at < ttlMs) return hit.ws
    const ws = resolve(path)
    cache.set(path, { ws, at: Date.now() })
    return ws
  }
}
