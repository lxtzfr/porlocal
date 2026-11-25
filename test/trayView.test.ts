import { describe, expect, it } from 'vitest'
import type { StateResponse } from '../src/api.js'
import { trayView } from '../src/tray/view.js'

type Proc = StateResponse['processes'][number]
const proc = (id: string, port: number, extra: Partial<Proc> = {}): Proc =>
  ({ id, port, status: 'ready', owner: { pid: 7, name: 'claude.exe' }, graceMs: 30_000, ownerAlive: true, ...extra }) as Proc
const state = (processes: Proc[]): StateResponse => ({ processes, leases: [], bindings: [], devices: [], adb: true })
const ids = (v: ReturnType<typeof trayView>) => v.items.map((i) => i.id || '-')

describe('trayView', () => {
  it('grey with a start entry when the daemon is down', () => {
    const v = trayView(null, null)
    expect(v.icon).toBe('down')
    expect(ids(v)).toEqual(['daemon:start', '-', 'quit'])
  })

  it('green, lists the running services (sorted) as links', () => {
    const v = trayView(state([proc('web/web', 3000), proc('server/api', 3001, { status: 'starting' }), proc('old/x', 3002, { status: 'stopped' })]), null)
    expect(v.icon).toBe('ok')
    expect(v.tooltip).toBe('porlocal: 2 running')
    expect(ids(v)).toEqual(['dashboard', '-', 'open:3001', 'open:3000', '-', 'daemon:restart', 'daemon:stop', '-', 'quit'])
    expect(v.items[2]!.label).toContain('(starting)')
    expect(v.balloons).toEqual([])
  })

  it('stays green when an adopted process ends with an unknown exit code', () => {
    expect(trayView(state([proc('server/api', 3001, { status: 'exited', exitCode: null })]), null).icon).toBe('ok')
  })

  it('orange with a balloon when a service exits with an error or loses its owner', () => {
    const before = state([proc('web/web', 3000), proc('server/api', 3001)])
    const after = state([proc('web/web', 3000, { status: 'exited', exitCode: 1 }), proc('server/api', 3001, { ownerLostAt: 1 })])
    const v = trayView(after, before)
    expect(v.icon).toBe('warn')
    expect(v.tooltip).toBe('porlocal: 1 running, 1 exited, 1 owner gone')
    expect(v.balloons.map((b) => b.title)).toEqual(['web/web exited', 'server/api: owner gone'])
    // Same state again: nothing new to say.
    expect(trayView(after, after).balloons).toEqual([])
  })

  it('keeps the tooltip within what Windows accepts', () => {
    const many = Array.from({ length: 3 }, (_, i) => proc(`s${i}`, 3000 + i, { status: 'exited', exitCode: 1 }))
    expect(trayView(state([...many, proc('a', 1, { ownerLostAt: 1 })]), null).tooltip.length).toBeLessThanOrEqual(63)
  })
})
