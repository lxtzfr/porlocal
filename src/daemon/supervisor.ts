import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { loadConfig } from "../core/config-store.js";
import { checkServerHealth } from "../core/health.js";
import { appendLog } from "../core/logs.js";
import { resolveServer } from "../core/lookup.js";
import type { ProjectConfig, ServerConfig, ServerState } from "../core/types.js";

const HEALTH_INTERVAL_MS = 2000;
const RESTART_DELAY_MS = 1000;

interface ManagedProcess {
  child: ChildProcess;
  manualStop: boolean;
  healthTimer: ReturnType<typeof setInterval> | null;
}

/** Runs and watches server processes. Never kills anything the CLI/API didn't ask it to. */
export class Supervisor {
  private processes = new Map<string, ManagedProcess>();
  private states = new Map<string, ServerState>();

  status(): ServerState[] {
    return [...this.states.values()];
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
    const managed: ManagedProcess = { child, manualStop: false, healthTimer: null };
    this.processes.set(server.id, managed);
    this.setState(server.id, { status: "starting", pid: child.pid ?? null, startedAt: new Date().toISOString() });

    child.stdout?.on("data", (chunk: Buffer) => appendLog(server.id, chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => appendLog(server.id, chunk.toString()));
    child.on("exit", (code) => this.handleExit(server, managed, code));

    this.startHealthLoop(server, managed);
  }

  private startHealthLoop(server: ServerConfig, managed: ManagedProcess): void {
    if (server.port === null && !server.healthURL) {
      this.setState(server.id, { status: "running" });
      return;
    }
    managed.healthTimer = setInterval(() => {
      checkServerHealth(server).then((healthy) => {
        if (!this.processes.has(server.id)) return;
        this.setState(server.id, { status: healthy ? "running" : "starting" });
      });
    }, HEALTH_INTERVAL_MS);
  }

  private handleExit(server: ServerConfig, managed: ManagedProcess, code: number | null): void {
    if (managed.healthTimer) clearInterval(managed.healthTimer);
    this.processes.delete(server.id);
    appendLog(server.id, `[porlocal] process exited with code ${code}`);

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

  private setState(serverId: string, patch: Partial<Omit<ServerState, "serverId">>): void {
    const current = this.stateOf(serverId);
    this.states.set(serverId, { ...current, ...patch, serverId });
  }
}
