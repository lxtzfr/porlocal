import http from "node:http";
import type { ServerConfig } from "@porlocal/core";
import { loadConfig, saveConfig } from "../core/config-store.js";
import { generateId } from "../core/ids.js";
import { tailLogs } from "../core/logs.js";
import { resolveProject, resolveServer } from "../core/lookup.js";
import { killProcess, listListeningPorts, occupantOf, waitForPortFree } from "../core/ports.js";
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
  return requireResolvedServer(ref).server.id;
}

function requireResolvedServer(ref: unknown) {
  if (typeof ref !== "string" || ref.length === 0) throw new Error("Missing 'server' field");
  const found = resolveServer(loadConfig(), ref);
  if (!found) throw new Error(`Unknown server: ${ref}`);
  return found;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing '${field}' field`);
  return value;
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

      if (req.method === "POST" && url.pathname === "/servers/add") {
        const body = await readJsonBody(req);
        const config = loadConfig();
        const project = resolveProject(config, requireString(body.project, "project"));
        if (!project) throw new Error(`Unknown project: ${String(body.project)}`);

        const server: ServerConfig = {
          id: generateId("srv"),
          name: requireString(body.name, "name"),
          command: requireString(body.command, "command"),
          port: typeof body.port === "number" ? body.port : null,
          directory: typeof body.directory === "string" ? body.directory : null,
          env: typeof body.env === "object" && body.env !== null ? (body.env as Record<string, string>) : {},
          healthURL: typeof body.healthURL === "string" ? body.healthURL : null,
          autoRestart: body.autoRestart !== false,
        };
        project.servers.push(server);
        saveConfig(config);
        sendJson(res, 200, { ok: true, data: server });
        return;
      }

      if (req.method === "POST" && url.pathname === "/servers/update") {
        const body = await readJsonBody(req);
        const { server } = requireResolvedServer(body.server);
        const patch = (body.patch ?? {}) as Partial<ServerConfig>;
        const config = loadConfig();
        const found = resolveServer(config, server.id);
        if (!found) throw new Error(`Unknown server: ${server.id}`);

        Object.assign(found.server, {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.command !== undefined && { command: patch.command }),
          ...(patch.port !== undefined && { port: patch.port }),
          ...(patch.directory !== undefined && { directory: patch.directory }),
          ...(patch.env !== undefined && { env: patch.env }),
          ...(patch.healthURL !== undefined && { healthURL: patch.healthURL }),
          ...(patch.autoRestart !== undefined && { autoRestart: patch.autoRestart }),
        });
        saveConfig(config);
        sendJson(res, 200, { ok: true, data: found.server });
        return;
      }

      if (req.method === "POST" && url.pathname === "/servers/remove") {
        const body = await readJsonBody(req);
        const { project, server } = requireResolvedServer(body.server);
        supervisor.stop(server.id);
        const config = loadConfig();
        const target = resolveServer(config, server.id);
        if (target) {
          target.project.servers = target.project.servers.filter((s) => s.id !== server.id);
          saveConfig(config);
        }
        sendJson(res, 200, { ok: true, data: { removed: `${project.name}/${server.name}` } });
        return;
      }

      if (req.method === "GET" && url.pathname === "/ports") {
        const config = loadConfig();
        const configuredByPort = new Map<number, { project: string; server: string }>();
        for (const project of config.projects) {
          for (const server of project.servers) {
            if (server.port !== null) configuredByPort.set(server.port, { project: project.name, server: server.name });
          }
        }
        const listeners = await listListeningPorts();
        const seen = new Set<string>();
        const data = [];
        for (const listener of listeners) {
          const key = `${listener.port}:${listener.pid}`;
          if (seen.has(key)) continue; // IPv4 and IPv6 bindings of the same process both list here.
          seen.add(key);
          const configured = configuredByPort.get(listener.port);
          // Only trust "managed" when this exact pid is the one the supervisor
          // actually spawned — a configured port squatted by an unrelated
          // process must still show up as external and killable.
          const managedBy = configured && supervisor.isManagedPid(listener.pid) ? configured : null;
          data.push({ ...listener, managedBy });
        }
        sendJson(res, 200, { ok: true, data });
        return;
      }

      if (req.method === "POST" && url.pathname === "/ports/kill") {
        const body = await readJsonBody(req);
        if (typeof body.port !== "number") throw new Error("Missing 'port' field");
        const occupant = await occupantOf(body.port);
        if (!occupant) throw new Error(`Port ${body.port} is already free`);
        if (supervisor.isManagedPid(occupant.pid)) {
          throw new Error("This port is held by a server porlocal supervises — use stop/restart instead of kill-port");
        }
        await killProcess(occupant.pid, body.force === true);
        sendJson(res, 200, { ok: true, data: occupant });
        return;
      }

      if (req.method === "POST" && url.pathname === "/take-over") {
        const body = await readJsonBody(req);
        const { server } = requireResolvedServer(body.server);
        if (server.port === null) throw new Error("This server has no configured port to take over");

        const occupant = await occupantOf(server.port);
        if (occupant) {
          if (supervisor.isManagedPid(occupant.pid)) {
            throw new Error("This server is already running under porlocal");
          }
          await killProcess(occupant.pid);
          const freed = await waitForPortFree(server.port);
          if (!freed) throw new Error(`Port ${server.port} did not free up after stopping pid ${occupant.pid}`);
        }

        supervisor.start(server.id);
        sendJson(res, 200, { ok: true, data: supervisor.stateOf(server.id) });
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
