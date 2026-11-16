import { listProjects, listWorktrees, registerProject } from '@lxtzfr/wt'
import type { State } from '../api.js'
import { resolveWorkspace } from '../workspace.js'

/**
 * Every git worktree (main checkout, slots free or on a ticket, ones outside the slot layout) of every project in the
 * user's wt map. Memoised: it spawns git per project and the machine view is read every 5 s.
 */
export function cachedWorktrees(ttlMs = 30_000): () => string[] {
  let cache: { paths: string[]; at: number } | null = null
  return () => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.paths
    const paths = listProjects().flatMap((p) => {
      try {
        return listWorktrees(p.path).map((w) => w.path)
      } catch {
        return []
      }
    })
    cache = { paths, at: Date.now() }
    return paths
  }
}

/** The projects porlocal already knows (leases, processes) join the map once: no need to wait for their next run. */
export function seedProjects(state: State): void {
  for (const path of new Set([...state.leases, ...state.processes].map((x) => x.workspace))) {
    try {
      registerProject(resolveWorkspace(path).main)
    } catch {}
  }
}
