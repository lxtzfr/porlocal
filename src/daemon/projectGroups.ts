import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Checkout, ProjectGroup } from '../api.js'

/** A project's name, from the folder holding its main checkouts: its `*.code-workspace`, its package name, the folder. */
export function projectName(dir: string): string {
  try {
    const file = readdirSync(dir).find((f) => f.endsWith('.code-workspace'))
    if (file) return file.replace(/\.code-workspace$/, '')
  } catch {}
  try {
    const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name as string | undefined
    // `@tra-sim/workspace` -> `tra-sim`: the scope names the project, `workspace` the folder.
    if (name) return name.startsWith('@') ? name.slice(1).split('/')[0]! : name
  } catch {}
  return basename(dir)
}

const slotPart = (c: Checkout) => (c.free ? 'free slots' : c.slot === 1 ? 'main' : c.slot ? `slot ${c.slot}` : c.label)

/**
 * The checkouts linked together (by their env, either way) form a group: the main checkouts of a project, the slots of
 * a ticket over several repos, a solo repo. From the links, not the slot numbers: `wt link` can tie `web-2` to `server-3`.
 * A free slot joins no ticket through its links back to the main checkouts: a project's free slots form one group.
 */
export function projectGroups(checkouts: Checkout[], mainOf: (path: string) => string): ProjectGroup[] {
  const parent = new Map(checkouts.map((c) => [c.path, c.path]))
  const find = (p: string): string => {
    const up = parent.get(p)!
    if (up === p) return p
    const root = find(up)
    parent.set(p, root)
    return root
  }
  const free = new Set(checkouts.filter((c) => c.free).map((c) => c.path))
  const freeOf = new Map<string, string>()
  for (const path of free) {
    const project = dirname(mainOf(path))
    if (freeOf.has(project)) parent.set(find(path), find(freeOf.get(project)!))
    else freeOf.set(project, path)
  }
  for (const c of checkouts) {
    if (free.has(c.path)) continue
    for (const l of c.uses) if (parent.has(l.workspace) && !free.has(l.workspace)) parent.set(find(l.workspace), find(c.path))
  }

  const members = new Map<string, Checkout[]>()
  for (const c of checkouts) members.set(find(c.path), [...(members.get(find(c.path)) ?? []), c])

  const groups = [...members.values()].map((list): ProjectGroup & { order: number } => {
    // A folder only holding repos side by side (`C:/Git/lxtzfr`) names no project: only a workspace repo does.
    const dir = dirname(mainOf(list[0]!.path))
    const workspace = existsSync(join(dir, '.git')) ? dir : null
    // A repo goes by its remote (`lxtzfr/website`): the folder name alone says little.
    const repos = [...new Set(list.map((c) => c.remote?.slug ?? c.repo))].sort()
    const kind = workspace ? 'workspace' : repos.length === 1 ? 'solo' : 'linked'
    const name = workspace ? projectName(workspace) : repos.join(' + ')
    const parts = [...new Set(list.map(slotPart))]
    const branches = new Set(list.map((c) => c.branch))
    const branch = branches.size === 1 ? list[0]!.branch : null
    return {
      id: list.map((c) => c.path).sort()[0]!,
      kind,
      workspace,
      name,
      label: parts.length === 1 && parts[0] === 'main' ? name : `${name} · ${parts.join(' + ')}`,
      branch,
      issueUrl: branch ? list[0]!.issueUrl : null,
      paths: list.map((c) => c.path),
      // The free slots after the tickets.
      order: list.every((c) => c.free) ? 2000 : Math.min(...list.map((c) => c.slot ?? 1000)),
    }
  })
  return groups.sort((a, b) => a.name.localeCompare(b.name) || a.order - b.order).map(({ order, ...g }) => g)
}
