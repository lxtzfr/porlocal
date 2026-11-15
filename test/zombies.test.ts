import { describe, expect, it } from 'vitest'
import type { State } from '../src/api.js'
import { findZombies } from '../src/daemon/zombies.js'
import type { ProcInfo } from '../src/procs.js'

const table = (procs: Array<[number, number, string, string]>) =>
  new Map<number, ProcInfo>(procs.map(([pid, ppid, name, cmd]) => [pid, { pid, ppid, name, cmd }]))

const state = {
  leases: [{ workspace: 'C:/Git/ws/web', service: 'web', port: 3000 }],
  bindings: [],
  processes: [{ id: 'server/api', workspace: 'C:/Git/ws/server', service: 'api', port: 3001, pid: 50, status: 'ready' }],
} as unknown as State

const repos = new Set(['C:/Git/ws/web', 'C:/Git/ws/server', 'C:/Git/ws.wt/web-2'])
const repo = (path: string) => repos.has(path.replace(/\\/g, '/'))

describe('findZombies', () => {
  const t = table([
    [1, 0, 'Code.exe', 'Code.exe'],
    [5, 1, 'Unity.exe', String.raw`Unity.exe -projectPath C:\Git\ws\unity`],
    // A `pnpm dev` started by hand in a terminal: listening, parent alive.
    [10, 1, 'pwsh.exe', 'pwsh.exe'],
    [11, 10, 'node.exe', String.raw`node "C:\Git\ws\web\node_modules\.bin\..\vite\bin\vite.js" dev`],
    // A slot's server whose terminal closed: orphan, listening.
    [20, 999, 'node.exe', String.raw`node C:\Git\ws.wt\web-2\node_modules\vite\bin\vite.js dev`],
    // IDE helper: runs from the checkout, neither listens nor is orphan.
    [30, 1, 'node.exe', String.raw`node C:\Git\ws\web\node_modules\typescript\lib\tsserver.js`],
    // porlocal's own: the `cmd /c` wrapper and the server under it.
    [50, 90, 'cmd.exe', 'cmd.exe /d /s /c "pnpm start:dev"'],
    [51, 50, 'node.exe', String.raw`node C:\Git\ws\server\dist\main`],
    [90, 1, 'node.exe', 'node porlocal/dist/daemon/main.js'],
    // Another porlocal daemon (a test one, a slot's build) and what it launched, run from a known checkout.
    [70, 1, 'node.exe', String.raw`"C:\Program Files\nodejs\node.exe" C:\Git\ws\porlocal\dist\daemon\main.js`],
    [71, 70, 'node.exe', String.raw`node C:\Git\ws\web\node_modules\vite\bin\vite.js dev --port 4100`],
    // The tray, its CLI parent gone (orphan), and its PowerShell host.
    [80, 999, 'node.exe', String.raw`node C:\Git\ws\porlocal\dist\tray\main.js`],
    [81, 80, 'powershell.exe', String.raw`powershell.exe -File C:\Git\ws\web\tray-host.ps1`],
    // Elsewhere on the machine: not porlocal's business.
    [60, 999, 'node.exe', String.raw`node C:\other\app.js`],
  ])
  const listening = new Map([[5, [55000]], [11, [3000]], [20, [3010]], [51, [3001]], [60, [8080]], [90, [4780]], [70, [4790]], [71, [4100]]])

  it('lists what runs from known checkouts outside porlocal, not any porlocal daemon, IDEs, helpers or other folders', () => {
    const z = findZombies(state, t, listening, [90], repo)
    expect(z.map((p) => [p.pid, p.checkout, p.ports, p.orphan])).toEqual([
      [20, 'C:/Git/ws.wt/web-2', [3010], true],
      [11, 'C:/Git/ws/web', [3000], false],
    ])
  })
})
