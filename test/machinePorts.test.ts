import { describe, expect, it } from 'vitest'
import type { State, Zombie } from '../src/api.js'
import { machinePorts } from '../src/daemon/machinePorts.js'
import type { ProcInfo } from '../src/procs.js'

const table = new Map<number, ProcInfo>(
  ([
    [4, 0, 'System', ''],
    [900, 1, 'svchost.exe', 'svchost.exe -k RPCSS'],
    // porlocal's `cmd /c` wrapper and the server under it.
    [50, 1, 'cmd.exe', 'cmd.exe /d /s /c "pnpm dev"'],
    [51, 50, 'node.exe', 'node vite.js dev'],
    [70, 1, 'node.exe', 'node C:/Git/ws/web/server.js'],
    [80, 1, 'Docker.exe', 'Docker.exe'],
    [90, 1, 'node.exe', 'node C:/Git/porlocal/dist/daemon/main.js'],
  ] as const).map(([pid, ppid, name, cmd]) => [pid, { pid, ppid, name, cmd }]),
)
const listening = new Map([[4, [445]], [900, [135, 49664]], [51, [3000]], [70, [3001]], [80, [8080]], [90, [4780]]])
const state = {
  leases: [
    { workspace: 'C:/Git/ws/web', service: 'web', port: 3000 },
    // Its declared 3001 was taken by a hand-started server: moved to 4100.
    { workspace: 'C:/Git/ws/server', service: 'api', port: 4100, preferred: 3001 },
  ],
  bindings: [],
  processes: [{ id: 'web/web', workspace: 'C:/Git/ws/web', service: 'web', port: 3000, pid: 50, status: 'ready' }],
} as unknown as State
const zombies = [{ pid: 70 }] as Zombie[]

describe('machinePorts', () => {
  const ports = machinePorts(state, table, listening, zombies)
  const at = (port: number) => ports.find((p) => p.port === port)!

  it('names who holds each port: porlocal (through its wrapper), outside porlocal, other', () => {
    expect(ports.map((p) => p.port)).toEqual([135, 445, 3000, 3001, 4780, 8080, 49664])
    expect(at(3000).holder).toEqual({ kind: 'porlocal', id: 'web/web' })
    expect(at(4780).holder).toEqual({ kind: 'porlocal', id: 'daemon' })
    expect(at(3001).holder).toEqual({ kind: 'zombie' })
    expect(at(8080).holder).toEqual({ kind: 'other' })
  })

  it('flags a declared port held by something else, not a service on its own port', () => {
    expect(at(3001).wantedBy).toEqual([{ workspace: 'C:/Git/ws/server', service: 'api' }])
    expect(at(3000).wantedBy).toEqual([])
  })

  it('marks system ports: below 1024, ephemeral, OS processes; never a dev one', () => {
    expect(ports.filter((p) => p.system).map((p) => p.port)).toEqual([135, 445, 49664])
  })
})
