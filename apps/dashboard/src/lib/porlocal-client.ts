import type { ProjectConfig, ServerState } from "@porlocal/core";

export const PORLOCAL_API_BASE = import.meta.env.VITE_PORLOCAL_API ?? "http://127.0.0.1:7737";

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
