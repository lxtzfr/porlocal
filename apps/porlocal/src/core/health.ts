import net from "node:net";

/** Raw TCP connect check on localhost — works for any server that binds a port. */
export function tcpReachable(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, "localhost");
  });
}

export async function httpHealthy(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

export function resolveHealthUrl(healthURL: string | null, port: number | null): string | null {
  if (!healthURL) return null;
  if (healthURL.startsWith("http://") || healthURL.startsWith("https://")) return healthURL;
  if (port === null) return null;
  const suffix = healthURL.startsWith("/") ? healthURL : `/${healthURL}`;
  return `http://localhost:${port}${suffix}`;
}

/** Port reachable first (if configured), then the health URL if any. No port and no URL: trust the process. */
export async function checkServerHealth(server: { port: number | null; healthURL: string | null }): Promise<boolean> {
  if (server.port !== null) {
    const reachable = await tcpReachable(server.port);
    if (!reachable) return false;
  }
  const url = resolveHealthUrl(server.healthURL, server.port);
  if (url) return httpHealthy(url);
  return true;
}
