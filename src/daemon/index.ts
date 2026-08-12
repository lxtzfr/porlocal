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

// The dashboard is a separate app that can end up on any port (its default
// can be taken by something else), so we allow any loopback origin rather
// than a fixed port. A remote site's browser can never present an Origin of
// localhost/127.0.0.1, so this stays as safe as a fixed allowlist while not
// breaking every time Vite picks a different port.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (!origin || !LOOPBACK_ORIGIN.test(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

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
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/ping") {
        sendJson(res, 200, { ok: true, data: { version: "0.1.0" } });
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const config = loadConfig();
        res.write(
          `event: snapshot\ndata: ${JSON.stringify({ projects: config.projects, states: supervisor.status() })}\n\n`,
        );

        const onState = (state: unknown) => res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
        const onLog = (entry: unknown) => res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
        supervisor.on("state", onState);
        supervisor.on("log", onLog);
        const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

        req.on("close", () => {
          clearInterval(heartbeat);
          supervisor.off("state", onState);
          supervisor.off("log", onLog);
        });
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
