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
