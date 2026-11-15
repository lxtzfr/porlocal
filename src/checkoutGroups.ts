// Pure (no node import): the dashboard bundles it as well as the CLI.
import type { Checkout, Lease, MachineResponse, ProjectPort, StateResponse, Zombie } from './api.js'

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

export interface CheckoutGroup {
  checkout: Checkout
  services: ServiceRow[]
  /** Dev processes of this checkout started by hand. */
  hand: Zombie[]
}

const basename = (path: string) => path.split('/').pop() ?? path

// The state feed (1 s) can show a checkout before the machine feed (5 s) knows it.
const bare = (path: string): Checkout => ({ path, repo: basename(path), slot: null, label: basename(path), branch: null, issueUrl: null, uses: [], usedBy: [] })

/** The dashboard's one view: everything porlocal knows, checkout by checkout. */
export function checkoutGroups(state: StateResponse, machine: MachineResponse | undefined): CheckoutGroup[] {
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

/** `server-2/api`: a link's target named as the checkouts list names it. */
export const targetLabel = (groups: CheckoutGroup[], workspace: string, service: string) =>
  `${groups.find((g) => g.checkout.path === workspace)?.checkout.label ?? basename(workspace)}/${service}`
