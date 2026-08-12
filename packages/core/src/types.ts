export interface ServerConfig {
  id: string;
  name: string;
  command: string;
  port: number | null;
  directory: string | null;
  env: Record<string, string>;
  healthURL: string | null;
  autoRestart: boolean;
}

export interface ProjectConfig {
  id: string;
  name: string;
  root: string;
  servers: ServerConfig[];
}

export interface PorlocalConfig {
  version: 1;
  apiPort: number;
  healthIntervalSeconds: number;
  maxRestartAttempts: number;
  projects: ProjectConfig[];
}

export type ServerStatus = "stopped" | "starting" | "running" | "crashed";

export interface ServerState {
  serverId: string;
  status: ServerStatus;
  pid: number | null;
  startedAt: string | null;
  restartCount: number;
}

export interface PortListener {
  port: number;
  pid: number;
  command: string;
  managedBy: { project: string; server: string } | null;
  /**
   * Working directory the process was launched from. Always accurate for
   * `managedBy` entries (resolved from config, no OS call needed). For
   * external processes it's best-effort via `lsof` and always `null` on
   * Windows, which has no standard way to read another process's cwd.
   */
  directory: string | null;
  /**
   * Full invocation (script path, args) for external processes — the best
   * identifying info Windows can give without a real cwd API. `null` for
   * managed entries (the `directory` field already tells the full story)
   * and when the OS lookup fails.
   */
  commandLine: string | null;
}
