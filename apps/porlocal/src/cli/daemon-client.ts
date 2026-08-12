import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../core/config-store.js";

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function daemonEntryPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "daemon", "index.js");
}

async function ping(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Checks whether the daemon is already running, without starting it. */
export async function peekDaemon<T>(urlPath: string): Promise<T | null> {
  const config = loadConfig();
  if (!(await ping(config.apiPort))) return null;
  return daemonRequest<T>("GET", urlPath, undefined, config.apiPort);
}

/** Every CLI command that needs the daemon launches it automatically, like Portly does. */
export async function ensureDaemon(): Promise<number> {
  const config = loadConfig();
  if (await ping(config.apiPort)) return config.apiPort;

  const child = spawn(process.execPath, [daemonEntryPath()], { detached: true, stdio: "ignore" });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await ping(config.apiPort)) return config.apiPort;
  }
  throw new Error("Could not start the porlocal daemon");
}

export async function daemonRequest<T>(
  method: string,
  urlPath: string,
  body?: unknown,
  knownPort?: number,
): Promise<T> {
  const port = knownPort ?? (await ensureDaemon());
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as Envelope<T>;
  if (!json.ok) throw new Error(json.error ?? "daemon request failed");
  return json.data as T;
}
