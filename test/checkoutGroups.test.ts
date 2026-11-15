import { describe, expect, it } from 'vitest'
import type { MachineResponse, StateResponse } from '../src/api.js'
import { checkoutGroups, targetLabel } from '../src/checkoutGroups.js'

const web = 'C:/Git/ws/web'
const server = 'C:/Git/ws.wt/server-2'
const state = {
  leases: [
    { workspace: web, service: 'web', port: 3000 },
    { workspace: web, service: 'docs', port: 3003 },
  ],
  processes: [
    { id: 'web/web', workspace: web, service: 'web', port: 3000, status: 'ready' },
    // The machine feed doesn't know this checkout yet.
    { id: 'server-2/api', workspace: server, service: 'api', port: 4110, status: 'starting' },
  ],
  bindings: [],
  devices: [],
  adb: false,
} as unknown as StateResponse
const machine = {
  checkouts: [{ path: web, repo: 'web', slot: 1, label: 'web', branch: 'master', issueUrl: null, uses: [], usedBy: [] }],
  zombies: [{ pid: 70, name: 'node.exe', cmd: 'node server.js', ports: [3005], checkout: web, orphan: false }],
  ports: [
    { port: 3000, status: 'ok', expected: { workspace: web, service: 'web' }, holder: { kind: 'porlocal', id: 'web/web', pid: 51 } },
    { port: 2999, status: 'moved', movedTo: 3000, expected: { workspace: web, service: 'web' }, holder: { kind: 'other', pid: 80, name: 'Docker.exe', cmd: '' } },
    { port: 3003, status: 'free', expected: { workspace: web, service: 'docs' }, holder: null },
  ],
} as MachineResponse

describe('checkoutGroups', () => {
  const groups = checkoutGroups(state, machine)

  it('groups services, ports and processes started by hand by checkout', () => {
    expect(groups.map((g) => g.checkout.label)).toEqual(['web', 'server-2'])
    const [w] = groups
    expect(w!.services.map((r) => [r.service, r.port, r.process?.id, r.portState?.status, r.moved?.port])).toEqual([
      ['docs', 3003, undefined, 'free', undefined],
      ['web', 3000, 'web/web', 'ok', 2999],
    ])
    expect(w!.hand.map((z) => z.pid)).toEqual([70])
  })

  it('names a link target by its checkout label', () => {
    expect(targetLabel(groups, server, 'api')).toBe('server-2/api')
    expect(targetLabel(groups, 'C:/Git/ws/other', 'api')).toBe('other/api')
  })
})
