import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import type { ProjectConfig, ServerConfig, ServerState } from "@porlocal/core";
import { loadConfig } from "../core/config-store.js";
import { checkServerHealth } from "../core/health.js";
import { appendLog } from "../core/logs.js";
import { resolveServer } from "../core/lookup.js";
import { occupantOf } from "../core/ports.js";

const HEALTH_INTERVAL_MS = 2000;
const RESTART_DELAY_MS = 1000;

interface ManagedProcess {
  child: ChildProcess;
  manualStop: boolean;
  healthTimer: ReturnType<typeof setInterval> | null;
  /**
   * `spawn(cmd, { shell: true })` makes `child.pid` the shell's pid (cmd.exe
   * / sh), not the real process listening on the port — that's a grandchild.
   * We resolve it via the OS port lookup so kill-port/take-over can
   * recognize a managed server's real pid and refuse to touch it.
   */
  listenPid: number | null;
}

export interface LogEvent {
  serverId: string;
  line: string;
}

interface SupervisorEvents {
  state: [ServerState];
  log: [LogEvent];
}

/** Runs and watches server processes. Never kills anything the CLI/API didn't ask it to. */
export class Supervisor extends EventEmitter<SupervisorEvents> {
  private processes = new Map<string, ManagedProcess>();
  private states = new Map<string, ServerState>();

  status(): ServerState[] {
    return [...this.states.values()];
  }

  /** True if this pid belongs to a process we spawned — kill-port must never touch these, use stop/restart instead. */
  isManagedPid(pid: number): boolean {
    for (const managed of this.processes.values()) {
      if (managed.child.pid === pid || managed.listenPid === pid) return true;
    }
    return false;
  }

  stateOf(serverId: string): ServerState {
    return (
      this.states.get(serverId) ?? {
        serverId,
        status: "stopped",
        pid: null,
        startedAt: null,
        restartCount: 0,
      }
    );
  }

  start(serverId: string): void {
    if (this.processes.has(serverId)) return;
    const found = this.findServer(serverId);
    if (!found) throw new Error(`Unknown server: ${serverId}`);
    this.setState(serverId, { restartCount: 0 });
    this.spawnProcess(found.project, found.server);
  }

  stop(serverId: string): void {
    const managed = this.processes.get(serverId);
    if (!managed) {
      this.setState(serverId, { status: "stopped", pid: null, startedAt: null });
      return;
    }
    managed.manualStop = true;
    this.killChild(managed.child);
  }

  async restart(serverId: string): Promise<void> {
    if (this.processes.has(serverId)) {
      this.stop(serverId);
      await this.waitUntilStopped(serverId);
    }
    this.start(serverId);
  }

  private waitUntilStopped(serverId: string, timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        if (!this.processes.has(serverId) || Date.now() - start > timeoutMs) {
          resolve();
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  private killChild(child: ChildProcess): void {
    if (!child.pid) return;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
    } else {
      child.kill("SIGTERM");
    }
  }

  private findServer(serverId: string): { project: ProjectConfig; server: ServerConfig } | null {
    return resolveServer(loadConfig(), serverId);
  }

  private spawnProcess(project: ProjectConfig, server: ServerConfig): void {
    const cwd = server.directory ? path.resolve(project.root, server.directory) : project.root;
    const env: NodeJS.ProcessEnv = { ...process.env, ...server.env, PORLOCAL: "1", PORLOCAL_SERVER: server.name };
    if (server.port !== null) env.PORT = String(server.port);

    const child = spawn(server.command, { shell: true, cwd, env });
    const managed: ManagedProcess = { child, manualStop: false, healthTimer: null, listenPid: null };
    this.processes.set(server.id, managed);
    this.setState(server.id, { status: "starting", pid: child.pid ?? null, startedAt: new Date().toISOString() });

    child.stdout?.on("data", (chunk: Buffer) => this.captureOutput(server.id, chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.captureOutput(server.id, chunk));
    child.on("exit", (code) => this.handleExit(server, managed, code));

    this.startHealthLoop(server, managed);
  }

  private startHealthLoop(server: ServerConfig, managed: ManagedProcess): void {
    if (server.port === null && !server.healthURL) {
      this.setState(server.id, { status: "running" });
      return;
    }
    managed.healthTimer = setInterval(() => {
      if (server.port !== null) {
        occupantOf(server.port).then((occupant) => {
          managed.listenPid = occupant?.pid ?? null;
        });
      }
      checkServerHealth(server).then((healthy) => {
        if (!this.processes.has(server.id)) return;
        this.setState(server.id, { status: healthy ? "running" : "starting" });
      });
    }, HEALTH_INTERVAL_MS);
  }

  private handleExit(server: ServerConfig, managed: ManagedProcess, code: number | null): void {
    if (managed.healthTimer) clearInterval(managed.healthTimer);
    this.processes.delete(server.id);
    const exitLine = `[porlocal] process exited with code ${code}`;
    appendLog(server.id, exitLine);
    this.emit("log", { serverId: server.id, line: exitLine });

    if (managed.manualStop) {
      this.setState(server.id, { status: "stopped", pid: null, startedAt: null });
      return;
    }

    const config = loadConfig();
    const restartCount = this.stateOf(server.id).restartCount + 1;
    this.setState(server.id, { status: "crashed", pid: null, startedAt: null, restartCount });

    if (server.autoRestart && restartCount <= config.maxRestartAttempts) {
      setTimeout(() => {
        const stillConfigured = this.findServer(server.id);
        if (stillConfigured) this.spawnProcess(stillConfigured.project, stillConfigured.server);
      }, RESTART_DELAY_MS);
    }
  }

  private captureOutput(serverId: string, chunk: Buffer): void {
    const text = chunk.toString();
    appendLog(serverId, text);
    for (const line of text.split(/\r?\n/).filter((l) => l.length > 0)) {
      this.emit("log", { serverId, line });
    }
  }

  private setState(serverId: string, patch: Partial<Omit<ServerState, "serverId">>): void {
    const current = this.stateOf(serverId);
    const next: ServerState = { ...current, ...patch, serverId };
    this.states.set(serverId, next);
    this.emit("state", next);
  }
}
