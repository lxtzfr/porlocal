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
}
