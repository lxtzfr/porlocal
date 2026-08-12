import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function dashboardDir(): string {
  // apps/porlocal/dist/cli/dashboard-client.js -> apps/dashboard
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..", "..", "dashboard");
}

function serverEntry(): string {
  return path.join(dashboardDir(), ".output", "server", "index.mjs");
}

async function ping(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Builds the dashboard once if it has never been built (first run only). */
export function ensureDashboardBuilt(): void {
  if (fs.existsSync(serverEntry())) return;
  console.log("Building the dashboard (first run only)...");
  // shell: true matters on Windows: npm ships as npm.cmd, and CreateProcess
  // can't exec a .cmd batch file directly without going through a shell.
  const result = spawnSync("npm", ["run", "build"], { cwd: dashboardDir(), stdio: "inherit", shell: true });
  if (result.status !== 0) {
    throw new Error("Dashboard build failed. Run `npm run build --workspace=apps/dashboard` to see the full output.");
  }
}

/** Starts the dashboard's production server, loopback-only, unless one is already answering on that port. */
export async function ensureDashboard(port: number): Promise<{ url: string; alreadyRunning: boolean }> {
  const url = `http://127.0.0.1:${port}/`;
  if (await ping(port)) return { url, alreadyRunning: true };

  ensureDashboardBuilt();

  const child: ChildProcess = spawn(process.execPath, [serverEntry()], {
    cwd: dashboardDir(),
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  });
  child.unref();

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (await ping(port)) return { url, alreadyRunning: false };
  }
  throw new Error("Dashboard did not come up in time.");
}

export function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}
