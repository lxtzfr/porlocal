import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dependsOn, expandCommand, resolveEnv, writeBlock, type PortOf } from '../envLocal.js'
import type { Logger } from '../log.js'
import { DYNAMIC_RANGE, LOGS_DIR } from '../paths.js'
import { isFree, portHolder, waitListening } from '../ports.js'
import { detectOwner, isAlive, killTree, processTable } from '../procs.js'
import { preferredPort, resolveWorkspace, siblingCheckouts, workspaceLabel, type Workspace } from '../workspace.js'
import type { Lease, Managed, State } from '../api.js'
import { loadState, saveState } from './state.js'

export interface RunRequest {
  cwd: string
  service: string
  cmd?: string
  /** The CLI's PID: the owner is detected from its ancestors. */
  callerPid: number
  /** Windows PID -> parent's, from MSYS (`readMsysParents`): mends the chain a Git Bash exec cuts. */
  parentHints?: Array<[number, number]>
  /** Explicit owner PID, or null for none (runs until stopped). */
  ownerPid?: number | null
  env: Record<string, string>
  /** A taken port is an error instead of a move. */
  keepPort?: boolean
  graceSec?: number
}

export class UserError extends Error {}

const DEFAULT_GRACE_MS = 30_000
const READY_TIMEOUT_MS = 90_000
const LOG_ROTATE_BYTES = 10 * 1024 * 1024

export class Supervisor {
  readonly state: State = loadState()
  private readonly children = new Map<string, ChildProcess>()
  private readonly requests = new Map<string, RunRequest>()
  onPortChange: (workspace: string, service: string, port: number) => void = () => {}

  constructor(private readonly log: Logger) {
    for (const p of this.state.processes) {
      if (p.status !== 'starting' && p.status !== 'ready') continue
      if (this.readopt(p)) this.log.info(`${p.id}: re-adopted PID ${p.pid} after a daemon restart`)
      else {
        p.status = 'exited'
        p.exitCode = null
      }
    }
    this.save()
    setInterval(() => this.watch(), 2000).unref()
  }

  // The recorded PID can be a wrapper (`cmd /c`, pnpm) gone while the server lives on: fall back to the port holder.
  private readopt(p: Managed): boolean {
    p.adopted = true
    if (isAlive(p.pid)) return true
    const holder = portHolder(p.port)
    if (!holder) return false
    p.pid = holder.pid
    return true
  }

  save(): void {
    saveState(this.state)
  }

  readonly portOf: PortOf = (workspace, service) => {
    const lease = this.leaseOf(workspace, service)
    if (lease) return lease.port
    return existsSync(workspace) ? preferredPort(resolveWorkspace(workspace), service) : undefined
  }

  leaseOf(workspace: string, service: string): Lease | undefined {
    return this.state.leases.find((l) => l.workspace === workspace && l.service === service)
  }

  find(id: string): Managed | undefined {
    return this.state.processes.find((p) => p.id === id)
  }

  private running(workspace: string, service: string): Managed | undefined {
    return this.state.processes.find((p) => p.workspace === workspace && p.service === service && (p.status === 'starting' || p.status === 'ready'))
  }

  // Names the holder; flags the same checkout started by hand (`pnpm dev` in a terminal): porlocal never points other
  // repos at a process it did not launch, so that one is to stop. Not when the path is a repo nested in it (workspace).
  private describeHolder(port: number, ws: Workspace): string {
    const holder = portHolder(port)
    if (!holder) return 'another process'
    const table = processTable()
    const info = table.get(holder.pid)
    const root = `${ws.path.toLowerCase()}/`
    let current = info
    for (let depth = 0; current && depth < 5; depth++, current = table.get(current.ppid)) {
      const cmd = current.cmd.replace(/\\/g, '/').toLowerCase()
      const at = cmd.indexOf(root)
      if (at < 0) continue
      const next = cmd.slice(at + root.length).split(/[/"\s]/)[0]
      if (next && existsSync(join(ws.path, next, '.git'))) break
      return `PID ${holder.pid} (${info?.name ?? '?'}, this checkout started outside porlocal: stop it)`
    }
    return `PID ${holder.pid}${info ? ` (${info.name})` : ''}`
  }

  private async pickDynamic(): Promise<number> {
    const leased = new Set(this.state.leases.map((l) => l.port))
    for (let port = DYNAMIC_RANGE.from; port <= DYNAMIC_RANGE.to; port++) {
      if (!leased.has(port) && (await isFree(port))) return port
    }
    throw new UserError(`no free port in ${DYNAMIC_RANGE.from}-${DYNAMIC_RANGE.to}`)
  }

  /**
   * The workspace + service's port: its declared one (`wt`'s) whenever free, else the one it holds, else a dynamic
   * one. Never silent: `blocked` says why it is not on its declared port; the caller rewrites what reads it.
   */
  async lease(ws: Workspace, service: string, newPort = false): Promise<{ port: number; moved: boolean; blocked?: string }> {
    const preferred = preferredPort(ws, service)
    const existing = this.leaseOf(ws.path, service)
    const running = this.running(ws.path, service)
    if (running) return { port: running.port, moved: false }
    const leasedToOther = (port: number) => this.state.leases.find((l) => l.port === port && !(l.workspace === ws.path && l.service === service))
    let blocked: string | undefined
    for (const port of new Set([preferred, existing?.port].filter((p): p is number => p !== undefined))) {
      const other = leasedToOther(port)
      if (!other && (await isFree(port))) return this.setLease(ws, service, port, port === preferred ? undefined : blocked)
      blocked ??= `port ${port} is ${other ? `leased to ${other.workspace} (${other.service})` : `taken by ${this.describeHolder(port, ws)}`}`
    }
    if (blocked && !newPort) throw new UserError(`${blocked}: free it (or take another port: run without --keep-port, lease --new-port)`)
    return this.setLease(ws, service, await this.pickDynamic(), blocked)
  }

  private setLease(ws: Workspace, service: string, port: number, blocked?: string): { port: number; moved: boolean; blocked?: string } {
    const existing = this.leaseOf(ws.path, service)
    const previous = existing?.port ?? preferredPort(ws, service)
    if (existing) existing.port = port
    else this.state.leases.push({ workspace: ws.path, service, port, preferred: preferredPort(ws, service) })
    this.save()
    const moved = previous !== undefined && previous !== port
    if (moved || !existing) this.log.info(`lease ${workspaceLabel(ws)}/${service} -> ${port}${blocked ? ` (${blocked})` : ''}`)
    return { port, moved, blocked }
  }

  release(workspace: string, service: string): Lease | undefined {
    if (this.running(workspace, service)) throw new UserError(`${service} is running: stop it first`)
    const lease = this.leaseOf(workspace, service)
    this.state.leases = this.state.leases.filter((l) => l !== lease)
    this.save()
    if (lease) this.log.info(`released ${workspace}/${service} (${lease.port})`)
    return lease
  }

  /** Rewrites `.env.local` of `ws`; returns the values (also injected into the process). */
  private writeEnv(ws: Workspace): Record<string, string> {
    if (Object.keys(ws.env).length === 0) return {}
    const { values, skipped } = resolveEnv(ws, this.portOf)
    if (writeBlock(ws.path, values)) this.log.info(`${workspaceLabel(ws)}: .env.local rewritten (${Object.entries(values).filter(([k]) => !/DATABASE/i.test(k)).map(([k, v]) => `${k}=${v}`).join(', ')})`)
    for (const reason of skipped) this.log.warn(`${workspaceLabel(ws)}: .env.local kept ${reason}`)
    return values
  }

  /** A port moved: rewrite the `.env.local` of every checkout reading it and restart what porlocal runs there. */
  private propagate(ws: Workspace, service: string, port: number): string[] {
    const notes: string[] = []
    for (const path of siblingCheckouts(ws)) {
      if (path === ws.path) continue
      const other = resolveWorkspace(path)
      if (!dependsOn(other, ws.path, service)) continue
      this.writeEnv(other)
      const running = this.state.processes.filter((p) => p.workspace === other.path && (p.status === 'starting' || p.status === 'ready'))
      for (const p of running) {
        this.log.info(`${p.id}: restarting, ${workspaceLabel(ws)}/${service} moved to ${port}`)
        void this.restart(p.id).catch((err) => this.log.error(`${p.id}: restart failed`, err))
      }
      notes.push(`${workspaceLabel(other)}: .env.local now points at ${port}${running.length ? `, restarting ${running.map((p) => p.service).join(', ')}` : ''}`)
    }
    this.save()
    this.onPortChange(ws.path, service, port)
    return notes
  }

  // The process writes straight into its log file (no pipe through the daemon): it keeps running and logging when the
  // daemon stops, where a pipe would break (EPIPE) with it. Rotated at each start.
  private openLog(file: string, header: string): number {
    mkdirSync(LOGS_DIR, { recursive: true })
    if (existsSync(file) && statSync(file).size > LOG_ROTATE_BYTES) renameSync(file, `${file}.1`)
    appendFileSync(file, header)
    return openSync(file, 'a')
  }

  async run(req: RunRequest): Promise<Managed> {
    const ws = resolveWorkspace(req.cwd)
    const label = workspaceLabel(ws)
    const id = `${label}/${req.service}`
    const cmd = req.cmd ?? ws.services[req.service]?.run
    if (!cmd) throw new UserError(`${label} declares no "${req.service}" with a run command (myStack.services): pass it after --`)
    // `up` twice is fine: what runs stays as is.
    const current = this.running(ws.path, req.service)
    if (current) return { ...current, notes: ['already running'] }

    const { port, moved, blocked } = await this.lease(ws, req.service, !req.keepPort)
    const values = this.writeEnv(ws)
    const notes = [
      ...(blocked ? [`${blocked}: on ${port} instead`] : moved ? [`back on its declared port ${port}`] : []),
      ...(moved ? this.propagate(ws, req.service, port) : []),
    ]

    let owner: Managed['owner'] = null
    if (req.ownerPid === undefined) {
      const found = detectOwner(processTable(), req.callerPid, new Map(req.parentHints ?? []))
      owner = found ? { pid: found.pid, name: found.name } : null
    } else if (req.ownerPid !== null) {
      owner = { pid: req.ownerPid, name: processTable().get(req.ownerPid)?.name ?? '?' }
    }

    const expanded = expandCommand(cmd, ws, port, this.portOf)
    const logFile = join(LOGS_DIR, `${id.replace(/[\\/:@]/g, '_')}.log`)
    const env = { ...req.env, ...values, PORT: String(port) }
    const fd = this.openLog(logFile, `\n--- ${new Date().toISOString()} porlocal: ${expanded} (port ${port})\n`)
    let child: ChildProcess
    try {
      child = spawn(expanded, {
        cwd: ws.path,
        env,
        shell: true,
        windowsHide: true,
        // Its own process group off Windows, so the whole tree can be signalled.
        detached: process.platform !== 'win32',
        stdio: ['ignore', fd, fd],
      })
    } finally {
      closeSync(fd)
    }
    if (!child.pid) throw new UserError(`could not start: ${expanded}`)

    const managed: Managed = {
      id,
      workspace: ws.path,
      label,
      service: req.service,
      port,
      cmd: expanded,
      pid: child.pid,
      owner,
      graceMs: (req.graceSec ?? DEFAULT_GRACE_MS / 1000) * 1000,
      status: 'starting',
      startedAt: Date.now(),
      logFile,
    }
    this.state.processes = [...this.state.processes.filter((p) => p.id !== id), managed]
    this.children.set(id, child)
    this.requests.set(id, req)
    this.log.info(`${id}: started PID ${child.pid} on ${port}, owner ${owner ? `${owner.name} (${owner.pid})` : 'none'}: ${expanded}`)
    this.save()

    child.on('exit', (code) => {
      // A restart may already have started the next child under the same id.
      if (this.children.get(id) === child) this.children.delete(id)
      if (managed.status === 'stopped') return
      managed.status = 'exited'
      managed.exitCode = code
      this.log.info(`${id}: exited (code ${code})`)
      this.save()
    })

    const ready = await waitListening(port, READY_TIMEOUT_MS, () => managed.status === 'starting')
    if (ready && managed.status === 'starting') {
      managed.status = 'ready'
      this.log.info(`${id}: listening on ${port}`)
      this.save()
    }
    return { ...managed, notes }
  }

  stop(id: string, reason = 'stopped by request'): Managed {
    const p = this.find(id)
    if (!p) throw new UserError(`unknown process ${id}`)
    if (p.status === 'starting' || p.status === 'ready') {
      p.status = 'stopped'
      p.stopReason = reason
      killTree(p.pid)
      this.log.info(`${id}: stopped PID ${p.pid} (${reason})`)
      this.save()
    }
    return p
  }

  async restart(id: string): Promise<Managed> {
    const p = this.find(id)
    if (!p) throw new UserError(`unknown process ${id}`)
    const req = this.requests.get(id) ?? { cwd: p.workspace, service: p.service, callerPid: process.pid, ownerPid: p.owner?.pid ?? null, env: process.env as Record<string, string> }
    this.stop(id, 'restart')
    const until = Date.now() + 10_000
    while (Date.now() < until && !(await isFree(p.port))) await new Promise((r) => setTimeout(r, 300))
    return this.run({ ...req, ownerPid: p.owner?.pid ?? null })
  }

  forget(id: string): void {
    const p = this.find(id)
    if (p && (p.status === 'starting' || p.status === 'ready')) throw new UserError(`${id} is running: stop it first`)
    this.state.processes = this.state.processes.filter((x) => x.id !== id)
    this.save()
  }

  private watch(): void {
    let changed = false
    for (const p of this.state.processes) {
      if (p.status !== 'starting' && p.status !== 'ready') continue
      if (p.adopted && !isAlive(p.pid) && !this.readopt(p)) {
        p.status = 'exited'
        p.exitCode = null
        changed = true
        continue
      }
      if (!p.owner) continue
      if (isAlive(p.owner.pid)) {
        if (p.ownerLostAt) {
          delete p.ownerLostAt
          changed = true
        }
        continue
      }
      if (!p.ownerLostAt) {
        p.ownerLostAt = Date.now()
        this.log.warn(`${p.id}: owner ${p.owner.name} (${p.owner.pid}) gone, stopping in ${p.graceMs / 1000}s`)
        changed = true
      } else if (Date.now() - p.ownerLostAt >= p.graceMs) {
        this.stop(p.id, `owner ${p.owner.name} (${p.owner.pid}) gone`)
      }
    }
    if (changed) this.save()
  }

  /** Keeps a process running whatever happens to its owner (`porlocal keep`). */
  keep(id: string): Managed {
    const p = this.find(id)
    if (!p) throw new UserError(`unknown process ${id}`)
    p.owner = null
    delete p.ownerLostAt
    this.log.info(`${id}: no owner any more, runs until stopped`)
    this.save()
    return p
  }
}
