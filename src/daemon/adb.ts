// Device port bindings: `adb reverse tcp:<device port> tcp:<host port>` so a device build keeps a fixed URL
// (`localhost:3001`) whatever port the host service got. adb drops reverse rules on every disconnect and adb server
// restart: `adb track-devices` re-applies them on each (re)connection, and after a host port change.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { findAdb } from '../adbPath.js'
import type { Logger } from '../log.js'
import type { Binding, State } from './state.js'

export class Adb {
  readonly devices = new Set<string>()
  private tracker: ChildProcess | null = null
  available = true
  private adb = findAdb()

  constructor(
    private readonly state: State,
    private readonly hostPortOf: (b: Binding) => number | undefined,
    private readonly save: () => void,
    private readonly log: Logger,
  ) {
    this.log.info(`adb: ${this.adb}`)
    this.track()
  }

  private run(args: string[]): { ok: boolean; out: string } {
    const r = spawnSync(this.adb, args, { encoding: 'utf-8', windowsHide: true })
    return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
  }

  private track(): void {
    // Re-resolved on each retry: adb (or a Unity editor) may be installed while the daemon runs.
    if (!this.available) {
      const adb = findAdb()
      if (adb !== this.adb) this.log.info(`adb: ${adb}`)
      this.adb = adb
    }
    const child = spawn(this.adb, ['track-devices'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    this.tracker = child
    let buffer = ''
    child.on('error', () => {
      if (this.available) this.log.warn(`adb not found (${this.adb}): device bindings wait for it (set ADB to its path)`)
      this.available = false
      // A failed spawn emits no 'exit': retry from here.
      if (!child.pid) setTimeout(() => this.track(), 30_000).unref()
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      // Each message: 4 hex digits of length, then `serial\tstate\n` lines.
      while (buffer.length >= 4) {
        const len = parseInt(buffer.slice(0, 4), 16)
        if (Number.isNaN(len) || buffer.length < 4 + len) break
        this.onDevices(buffer.slice(4, 4 + len))
        buffer = buffer.slice(4 + len)
      }
    })
    child.on('exit', () => {
      this.tracker = null
      this.devices.clear()
      setTimeout(() => this.track(), this.available ? 2000 : 30_000).unref()
    })
  }

  private onDevices(payload: string): void {
    this.available = true
    const online = new Set(
      payload
        .split('\n')
        .map((line) => line.trim().split('\t'))
        .filter(([serial, state]) => serial && state === 'device')
        .map(([serial]) => serial as string),
    )
    for (const serial of online) {
      if (this.devices.has(serial)) continue
      this.devices.add(serial)
      this.log.info(`device ${serial} connected`)
      this.applyDevice(serial)
    }
    for (const serial of [...this.devices]) {
      if (online.has(serial)) continue
      this.devices.delete(serial)
      this.log.info(`device ${serial} disconnected`)
    }
  }

  private applyOne(b: Binding, serial: string): void {
    const host = this.hostPortOf(b)
    if (host === undefined) return this.log.warn(`device ${serial}: no host port for ${b.workspace}/${b.service}`)
    const r = this.run(['-s', serial, 'reverse', `tcp:${b.devicePort}`, `tcp:${host}`])
    if (r.ok) this.log.info(`device ${serial}: localhost:${b.devicePort} -> host ${host} (${b.service})`)
    else this.log.warn(`device ${serial}: adb reverse tcp:${b.devicePort} failed: ${r.out}`)
  }

  private targets(b: Binding): string[] {
    return b.device === 'all' ? [...this.devices] : this.devices.has(b.device) ? [b.device] : []
  }

  private applyDevice(serial: string): void {
    for (const b of this.state.bindings) if (b.device === 'all' || b.device === serial) this.applyOne(b, serial)
  }

  /** A host port moved: re-point every binding on it. */
  refresh(workspace: string, service: string): void {
    for (const b of this.state.bindings.filter((b) => b.workspace === workspace && b.service === service)) {
      for (const serial of this.targets(b)) this.applyOne(b, serial)
    }
  }

  bind(binding: Binding): Binding {
    // One binding per device port and device: binding again re-points it.
    this.state.bindings = this.state.bindings.filter((b) => !(b.devicePort === binding.devicePort && b.device === binding.device))
    this.state.bindings.push(binding)
    this.save()
    for (const serial of this.targets(binding)) this.applyOne(binding, serial)
    return binding
  }

  unbind(devicePort: number, device: string): Binding[] {
    const removed = this.state.bindings.filter((b) => b.devicePort === devicePort && (device === 'all' || b.device === device))
    this.state.bindings = this.state.bindings.filter((b) => !removed.includes(b))
    this.save()
    for (const b of removed) {
      for (const serial of this.targets(b)) {
        this.run(['-s', serial, 'reverse', '--remove', `tcp:${b.devicePort}`])
        this.log.info(`device ${serial}: localhost:${b.devicePort} unbound`)
      }
    }
    return removed
  }

  stop(): void {
    this.tracker?.kill()
  }
}
