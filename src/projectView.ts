// Pure (no node import): the dashboard bundles it as well as the CLI.
import type { Checkout, Lease, MachineResponse, ProjectGroup, ProjectPort, StateResponse, Zombie } from './api.js'

export type Proc = StateResponse['processes'][number]

/** A service of a checkout: what porlocal runs or leases for it, and what is on its ports. */
export interface ServiceRow {
  service: string
  port: number
  process?: Proc
  lease?: Lease
  /** Its current port as the machine sees it (ok, free, conflict…). */
  portState?: ProjectPort
  /** Its declared port, taken by something else: it got `port` instead. */
  moved?: ProjectPort
}

export interface CheckoutView {
  checkout: Checkout
  services: ServiceRow[]
  /** Dev processes of this checkout started by hand. */
  hand: Zombie[]
}

const basename = (path: string) => path.split('/').pop() ?? path

// The state feed (1 s) can show a checkout before the machine feed (5 s) knows it.
const bare = (path: string): Checkout => ({ path, repo: basename(path), slot: null, label: basename(path), branch: null, issueUrl: null, uses: [], usedBy: [] })

/** Everything porlocal knows, checkout by checkout. */
export function checkoutViews(state: StateResponse, machine: MachineResponse | undefined): CheckoutView[] {
  const list = [...(machine?.checkouts ?? [])]
  const known = new Set(list.map((c) => c.path))
  for (const x of [...state.processes, ...state.leases]) {
    if (!known.has(x.workspace)) {
      list.push(bare(x.workspace))
      known.add(x.workspace)
    }
  }
  const ports = machine?.ports ?? []
  const portRow = (workspace: string, service: string, status: (s: ProjectPort['status']) => boolean) =>
    ports.find((p) => p.expected?.workspace === workspace && p.expected.service === service && status(p.status))

  return list.map((checkout) => {
    const rows = new Map<string, ServiceRow>()
    for (const lease of state.leases.filter((l) => l.workspace === checkout.path)) rows.set(lease.service, { service: lease.service, port: lease.port, lease })
    for (const p of state.processes.filter((x) => x.workspace === checkout.path)) {
      rows.set(p.service, { ...rows.get(p.service), service: p.service, port: p.port, process: p })
    }
    for (const row of rows.values()) {
      row.portState = portRow(checkout.path, row.service, (s) => s !== 'moved')
      row.moved = portRow(checkout.path, row.service, (s) => s === 'moved')
    }
    return {
      checkout,
      services: [...rows.values()].sort((a, b) => a.service.localeCompare(b.service)),
      hand: (machine?.zombies ?? []).filter((z) => z.checkout === checkout.path),
    }
  })
}

export interface GroupView {
  group: ProjectGroup
  checkouts: CheckoutView[]
}

/** The dashboard's and `porlocal status`'s one view: checkouts within their group (linked checkouts). */
export function projectView(state: StateResponse, machine: MachineResponse | undefined): GroupView[] {
  const views = checkoutViews(state, machine)
  const byPath = new Map(views.map((v) => [v.checkout.path, v]))
  const placed = new Set<string>()
  const groups: GroupView[] = (machine?.groups ?? []).map((group) => ({
    group,
    checkouts: group.paths.flatMap((p) => {
      const v = byPath.get(p)
      if (v) placed.add(p)
      return v ? [v] : []
    }),
  }))
  // A checkout the machine feed doesn't know yet: alone until its next snapshot.
  for (const v of views.filter((x) => !placed.has(x.checkout.path))) {
    const c = v.checkout
    groups.push({ group: { id: c.path, name: c.repo, label: c.label, branch: c.branch, issueUrl: c.issueUrl, paths: [c.path] }, checkouts: [v] })
  }
  return groups.filter((g) => g.checkouts.length)
}

/** `server-2/api`: a link's target named as the checkouts list names it. */
export const targetLabel = (views: CheckoutView[], workspace: string, service: string) =>
  `${views.find((v) => v.checkout.path === workspace)?.checkout.label ?? basename(workspace)}/${service}`

/** The group a checkout is in: a link leaving it (a slot using a main checkout) is worth flagging. */
export const groupOf = (groups: GroupView[], path: string) => groups.find((g) => g.group.paths.includes(path))?.group
