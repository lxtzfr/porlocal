// Mirrors src/core/types.ts and the daemon's HTTP envelope in the root
// `porlocal` package. Duplicated here since the dashboard is a standalone
// app, not (yet) part of a shared workspace.

export const PORLOCAL_API_BASE = import.meta.env.VITE_PORLOCAL_API ?? "http://127.0.0.1:7737";

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

export type ServerStatus = "stopped" | "starting" | "running" | "crashed";

export interface ServerState {
  serverId: string;
  status: ServerStatus;
  pid: number | null;
  startedAt: string | null;
  restartCount: number;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${PORLOCAL_API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as Envelope<T>;
  if (!json.ok) throw new Error(json.error ?? `Request failed: ${method} ${path}`);
  return json.data as T;
}

export function fetchStatus(): Promise<{ projects: ProjectConfig[]; states: ServerState[] }> {
  return request("GET", "/status");
}

export function startServer(serverId: string): Promise<ServerState> {
  return request("POST", "/start", { server: serverId });
}

export function stopServer(serverId: string): Promise<ServerState> {
  return request("POST", "/stop", { server: serverId });
}

export function restartServer(serverId: string): Promise<ServerState> {
  return request("POST", "/restart", { server: serverId });
}

export function fetchLogs(serverId: string, tail = 200): Promise<{ lines: string[] }> {
  return request("GET", `/logs?server=${encodeURIComponent(serverId)}&tail=${tail}`);
}
