import type { StateResponse } from '../api.js'

export type TrayIcon = 'ok' | 'warn' | 'down'

/** A menu entry; `-` is a separator. `id` comes back when it is clicked. */
export interface TrayItem {
  id: string
  label: string
  enabled?: boolean
}

export interface TrayView {
  icon: TrayIcon
  tooltip: string
  items: TrayItem[]
  balloons: { title: string; text: string }[]
}

const SEP: TrayItem = { id: '', label: '-' }
// NotifyIcon.Text throws above 63 characters (.NET Framework).
const TOOLTIP_MAX = 63
const running = (status: string) => status === 'ready' || status === 'starting'

/** What the tray shows for the daemon's state (null: unreachable), and what changed since `prev` worth a balloon. */
export function trayView(state: StateResponse | null, prev: StateResponse | null): TrayView {
  if (!state) {
    return {
      icon: 'down',
      tooltip: 'porlocal: daemon not running',
      items: [{ id: 'daemon:start', label: 'Start daemon' }, SEP, { id: 'quit', label: 'Quit tray' }],
      balloons: [],
    }
  }
  const live = state.processes.filter((p) => running(p.status)).sort((a, b) => a.id.localeCompare(b.id))
  const failed = state.processes.filter((p) => p.status === 'exited' && p.exitCode !== 0)
  const orphaned = live.filter((p) => p.ownerLostAt)
  const parts = [`${live.length} running`, failed.length && `${failed.length} exited`, orphaned.length && `${orphaned.length} owner gone`].filter(Boolean)

  const balloons: TrayView['balloons'] = []
  const before = new Map((prev?.processes ?? []).map((p) => [p.id, p]))
  for (const p of state.processes) {
    const was = before.get(p.id)
    if (!was) continue
    if (running(was.status) && p.status === 'exited') balloons.push({ title: `${p.id} exited`, text: `code ${p.exitCode ?? '?'}, port ${p.port}` })
    if (p.ownerLostAt && !was.ownerLostAt && p.owner) {
      balloons.push({ title: `${p.id}: owner gone`, text: `${p.owner.name} (${p.owner.pid}) closed: stops in ${Math.round(p.graceMs / 1000)} s unless kept` })
    }
  }

  const services: TrayItem[] = live.map((p) => ({ id: `open:${p.port}`, label: `${p.id}  :${p.port}${p.status === 'starting' ? ' (starting)' : ''}` }))
  return {
    icon: failed.length || orphaned.length ? 'warn' : 'ok',
    tooltip: `porlocal: ${parts.join(', ')}`.slice(0, TOOLTIP_MAX),
    items: [
      { id: 'dashboard', label: 'Open dashboard' },
      ...(services.length ? [SEP, ...services] : []),
      SEP,
      { id: 'daemon:restart', label: 'Restart daemon' },
      { id: 'daemon:stop', label: 'Stop daemon' },
      SEP,
      { id: 'quit', label: 'Quit tray' },
    ],
    balloons,
  }
}
