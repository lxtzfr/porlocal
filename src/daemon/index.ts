import http from "node:http";
import { loadConfig } from "../core/config-store.js";
import { tailLogs } from "../core/logs.js";
import { resolveServer } from "../core/lookup.js";
import { Supervisor } from "./supervisor.js";

/**
 * Local-only control API, mirroring Portly's loopback-bound HTTP server.
 * Never bind this to 0.0.0.0: it can start processes on the host.
 */
const supervisor = new Supervisor();

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function requireServerId(ref: unknown): string {
  if (typeof ref !== "string" || ref.length === 0) throw new Error("Missing 'server' field");
  const found = resolveServer(loadConfig(), ref);
  if (!found) throw new Error(`Unknown server: ${ref}`);
  return found.server.id;
}

function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/ping") {
        sendJson(res, 200, { ok: true, data: { version: "0.1.0" } });
        return;
      }

      if (req.method === "GET" && url.pathname === "/status") {
        const config = loadConfig();
        sendJson(res, 200, { ok: true, data: { projects: config.projects, states: supervisor.status() } });
        return;
      }

      if (req.method === "GET" && url.pathname === "/logs") {
        const serverId = requireServerId(url.searchParams.get("server"));
        const tail = Number(url.searchParams.get("tail") ?? "100");
        sendJson(res, 200, { ok: true, data: { lines: tailLogs(serverId, tail) } });
        return;
      }

      if (req.method === "POST" && url.pathname === "/start") {
        const body = await readJsonBody(req);
        const serverId = requireServerId(body.server);
        supervisor.start(serverId);
        sendJson(res, 200, { ok: true, data: supervisor.stateOf(serverId) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/stop") {
        const body = await readJsonBody(req);
        const serverId = requireServerId(body.server);
        supervisor.stop(serverId);
        sendJson(res, 200, { ok: true, data: supervisor.stateOf(serverId) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/restart") {
        const body = await readJsonBody(req);
        const serverId = requireServerId(body.server);
        await supervisor.restart(serverId);
        sendJson(res, 200, { ok: true, data: supervisor.stateOf(serverId) });
        return;
      }

      sendJson(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "unknown_error" });
    }
  });
}

export function startDaemon(): void {
  const config = loadConfig();
  const server = createServer();
  server.listen(config.apiPort, "127.0.0.1", () => {
    console.log(`porlocal daemon listening on 127.0.0.1:${config.apiPort}`);
  });
}

startDaemon();
