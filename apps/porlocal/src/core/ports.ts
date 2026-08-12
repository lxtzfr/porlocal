import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PortOccupant {
  pid: number;
  command: string;
}

/**
 * Tries to bind the port on both IPv4 and IPv6 loopback. This is the only
 * check that works identically on every platform; anything more detailed
 * (which process owns it) needs an OS-specific command below.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    // exclusive: true matters on Windows, which otherwise lets a second
    // process bind the same port instead of returning EADDRINUSE.
    server.listen({ port, host: "0.0.0.0", exclusive: true });
  });
}

export async function findAvailablePort(startingAt: number): Promise<number> {
  for (let port = startingAt; port < 65536; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error("No available port found");
}

/** Polls until nothing answers on the port anymore, e.g. after asking an occupant to stop. */
export async function waitForPortFree(port: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await occupantOf(port)) === null) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return (await occupantOf(port)) === null;
}

/**
 * Best-effort lookup of who is listening on a port. Uses the platform's
 * native tooling since Node has no portable API for this:
 * - Windows: `netstat -ano` + `tasklist` to resolve the PID's command name.
 * - macOS/Linux: `lsof -nP -iTCP:<port> -sTCP:LISTEN -FpcLn`.
 */
export async function occupantOf(port: number): Promise<PortOccupant | null> {
  if (process.platform === "win32") {
    return occupantOfWindows(port);
  }
  return occupantOfUnix(port);
}

async function occupantOfUnix(port: number): Promise<PortOccupant | null> {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-FpcLn",
    ]);
    let pid: number | null = null;
    let command = "";
    for (const line of stdout.split("\n")) {
      const tag = line[0];
      const value = line.slice(1);
      if (tag === "p") pid = Number(value);
      if (tag === "c") command = value;
    }
    if (pid === null) return null;
    return { pid, command: command || "unknown" };
  } catch {
    return null;
  }
}

export interface PortListener {
  port: number;
  pid: number;
  command: string;
  /** Full invocation (args included) when available — the best identifying info on Windows, where cwd isn't. */
  commandLine: string | null;
}

/** Every process currently listening on a TCP port, for the "system ports" view. */
export async function listListeningPorts(): Promise<PortListener[]> {
  if (process.platform === "win32") return listListeningPortsWindows();
  return listListeningPortsUnix();
}

async function listListeningPortsUnix(): Promise<PortListener[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcLn"]);
    const entries: { port: number; pid: number; command: string }[] = [];
    const pids = new Set<number>();
    let pid: number | null = null;
    let command = "";
    for (const line of stdout.split("\n")) {
      const tag = line[0];
      const value = line.slice(1);
      if (tag === "p") {
        pid = Number(value);
        command = "";
      } else if (tag === "c") {
        command = value;
      } else if (tag === "n" && pid !== null) {
        const port = portFromEndpoint(value);
        if (port !== null) {
          entries.push({ port, pid, command: command || "unknown" });
          pids.add(pid);
        }
      }
    }
    const commandLines = await resolveUnixCommandLines(pids);
    return entries.map((entry) => ({ ...entry, commandLine: commandLines.get(entry.pid) ?? null }));
  } catch {
    return [];
  }
}

async function resolveUnixCommandLines(pids: Set<number>): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (pids.size === 0) return map;
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="]);
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx === -1) continue;
      const pid = Number(trimmed.slice(0, spaceIdx));
      if (pids.has(pid)) map.set(pid, trimmed.slice(spaceIdx + 1));
    }
  } catch {
    // Leave unresolved pids without a command line rather than failing the whole listing.
  }
  return map;
}

function portFromEndpoint(endpoint: string): number | null {
  const local = endpoint.split("->")[0] ?? endpoint;
  const idx = local.lastIndexOf(":");
  if (idx === -1) return null;
  const port = Number(local.slice(idx + 1));
  return Number.isFinite(port) ? port : null;
}

async function listListeningPortsWindows(): Promise<PortListener[]> {
  try {
    const { stdout } = await execFileAsync("netstat", ["-ano"]);
    const entries: { port: number; pid: number }[] = [];
    const pids = new Set<number>();

    for (const line of stdout.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] !== "TCP" || parts[3] !== "LISTENING") continue;
      const localAddress = parts[1] ?? "";
      const pid = Number(parts[4]);
      const idx = localAddress.lastIndexOf(":");
      if (idx === -1 || !Number.isFinite(pid)) continue;
      const port = Number(localAddress.slice(idx + 1));
      if (!Number.isFinite(port)) continue;
      entries.push({ port, pid });
      pids.add(pid);
    }

    const info = await resolveWindowsProcessInfo(pids);
    return entries.map(({ port, pid }) => {
      const found = info.get(pid);
      return { port, pid, command: found?.command ?? "unknown", commandLine: found?.commandLine ?? null };
    });
  } catch {
    return [];
  }
}

interface WindowsProcessInfo {
  command: string;
  commandLine: string | null;
}

/**
 * `tasklist` only gives the image name (e.g. "node.exe"), useless to tell
 * apart ten unrelated Node processes. WMI's CommandLine includes the full
 * invocation (script path, args) — the closest thing Windows has to "where
 * is this actually running from" without a real cwd API. One PowerShell
 * call for every process, not per-pid: spawning powershell.exe repeatedly
 * is slow enough to matter when the ports list has more than a couple of
 * external entries.
 */
async function resolveWindowsProcessInfo(pids: Set<number>): Promise<Map<number, WindowsProcessInfo>> {
  const map = new Map<number, WindowsProcessInfo>();
  if (pids.size === 0) return map;
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress",
    ]);
    const parsed = JSON.parse(stdout) as
      | { ProcessId: number; Name: string; CommandLine: string | null }
      | Array<{ ProcessId: number; Name: string; CommandLine: string | null }>;
    for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
      if (pids.has(row.ProcessId)) {
        map.set(row.ProcessId, { command: row.Name, commandLine: row.CommandLine ?? null });
      }
    }
  } catch {
    // Leave unresolved pids as "unknown" rather than failing the whole listing.
  }
  return map;
}

/**
 * Best-effort working directory of an external process, for the "launched
 * from" column in the system ports view. Only macOS/Linux expose this
 * through standard tooling (`lsof -d cwd`); Windows has no equivalent
 * without native process-memory introspection, so this always returns null
 * there rather than guessing.
 */
export async function cwdOf(pid: number): Promise<string | null> {
  if (process.platform === "win32") return null;
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-d", "cwd", "-p", String(pid), "-Fn"]);
    for (const line of stdout.split("\n")) {
      if (line[0] === "n") return line.slice(1);
    }
    return null;
  } catch {
    return null;
  }
}

/** Stops a process this app does not itself supervise (an external port occupant). */
export async function killProcess(pid: number, force = false): Promise<void> {
  if (process.platform === "win32") {
    // Windows has no real SIGTERM equivalent: taskkill without /F just sends
    // WM_CLOSE, which most console/child processes ignore or outright refuse
    // ("this process can only be stopped by force"). Always force on Windows,
    // matching what Node's own child.kill() does under the hood there anyway.
    await execFileAsync("taskkill", ["/pid", String(pid), "/t", "/f"]);
    return;
  }
  process.kill(pid, force ? "SIGKILL" : "SIGTERM");
}

async function occupantOfWindows(port: number): Promise<PortOccupant | null> {
  try {
    // `netstat -p TCP` silently drops IPv6-only listeners (e.g. Vite binding
    // [::1]) on some Windows builds, so filter for the TCP protocol column
    // ourselves on the unfiltered `-ano` output instead.
    const { stdout } = await execFileAsync("netstat", ["-ano"]);
    const match = stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => {
        const parts = line.split(/\s+/);
        const protocol = parts[0] ?? "";
        const localAddress = parts[1] ?? "";
        const state = parts[3] ?? "";
        return protocol === "TCP" && localAddress.endsWith(`:${port}`) && state === "LISTENING";
      });
    if (!match) return null;
    const pid = Number(match.split(/\s+/).pop());
    if (!Number.isFinite(pid)) return null;

    const { stdout: taskOut } = await execFileAsync("tasklist", [
      "/FI",
      `PID eq ${pid}`,
      "/FO",
      "CSV",
      "/NH",
    ]);
    const command = taskOut.split(",")[0]?.replace(/"/g, "") || "unknown";
    return { pid, command };
  } catch {
    return null;
  }
}
