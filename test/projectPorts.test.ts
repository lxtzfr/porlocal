import { describe, expect, it } from 'vitest'
import type { State, Zombie } from '../src/api.js'
import { projectPorts } from '../src/daemon/projectPorts.js'
import type { ProcInfo } from '../src/procs.js'

const table = new Map<number, ProcInfo>(
  ([
    // porlocal's `cmd /c` wrapper and the server under it.
    [50, 1, 'cmd.exe', 'cmd.exe /d /s /c "pnpm dev"'],
    [51, 50, 'node.exe', 'node vite.js dev'],
    [60, 1, 'node.exe', 'node C:/Git/ws/server/dist/main.js'],
    [70, 1, 'node.exe', 'node C:/Git/ws/web/server.js'],
    [80, 1, 'Docker.exe', 'Docker.exe'],
    [90, 1, 'node.exe', 'node C:/Git/porlocal/dist/daemon/main.js'],
  ] as const).map(([pid, ppid, name, cmd]) => [pid, { pid, ppid, name, cmd }]),
)
// 5432 (Docker) and 4780 (porlocal) are nobody's project port: left out.
const listening = new Map([[51, [3000]], [60, [4100]], [70, [3001, 3005]], [80, [3002, 5432]], [90, [4780]]])
const state = {
  leases: [
    { workspace: 'C:/Git/ws/web', service: 'web', port: 3000 },
    // Its declared 3001 was taken by a server started by hand: moved to 4100.
    { workspace: 'C:/Git/ws/server', service: 'api', port: 4100, preferred: 3001 },
    { workspace: 'C:/Git/ws/admin', service: 'admin', port: 3002 },
    { workspace: 'C:/Git/ws/docs', service: 'docs', port: 3003 },
  ],
  bindings: [],
  processes: [
    { id: 'web/web', workspace: 'C:/Git/ws/web', service: 'web', port: 3000, pid: 50, status: 'ready' },
    { id: 'server/api', workspace: 'C:/Git/ws/server', service: 'api', port: 4100, pid: 60, status: 'ready' },
  ],
} as unknown as State
const zombies = [{ pid: 70, name: 'node.exe', cmd: 'node C:/Git/ws/web/server.js', ports: [3001, 3005], checkout: 'C:/Git/ws/web', orphan: false }] as Zombie[]

describe('projectPorts', () => {
  const rows = projectPorts(state, table, listening, zombies)
  const at = (port: number) => rows.find((r) => r.port === port)!

  it('lists the project ports only, with their status', () => {
    expect(rows.map((r) => [r.port, r.status])).toEqual([
      [3000, 'ok'],
      [3001, 'moved'],
      [3002, 'conflict'],
      [3003, 'free'],
      [3005, 'hand'],
      [4100, 'ok'],
    ])
  })

  it('names the holder and the service expecting the port', () => {
    expect(at(3000).holder).toEqual({ kind: 'porlocal', id: 'web/web', pid: 51 })
    expect(at(3001)).toMatchObject({ movedTo: 4100, expected: { service: 'api' }, holder: { kind: 'zombie', pid: 70 } })
    expect(at(3002).holder).toMatchObject({ kind: 'other', name: 'Docker.exe' })
    expect(at(3003).holder).toBeNull()
    expect(at(3005).expected).toBeUndefined()
  })
})
