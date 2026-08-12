#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { loadConfig, saveConfig } from "../core/config-store.js";
import { detectSuggestions } from "../core/command-detector.js";
import { generateId } from "../core/ids.js";
import { resolveServer } from "../core/lookup.js";
import { occupantOf, isPortFree } from "../core/ports.js";
import type { ProjectConfig, ServerConfig, ServerState } from "../core/types.js";
import { daemonRequest, peekDaemon } from "./daemon-client.js";

const program = new Command();

program.name("porlocal").description("Dashboard for your local dev servers").version("0.1.0");

program
  .command("status")
  .description("Show configured projects and servers")
  .option("--json", "output machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const config = loadConfig();
    const live = await peekDaemon<{ states: ServerState[] }>("/status");
    const statesById = new Map((live?.states ?? []).map((state) => [state.serverId, state]));

    if (options.json) {
      console.log(JSON.stringify({ projects: config.projects, states: live?.states ?? [] }, null, 2));
      return;
    }

    if (config.projects.length === 0) {
      console.log("No projects configured yet. Use `porlocal detect <path>` to get started.");
      return;
    }
    if (!live) console.log("(daemon not running — showing configured state only, all servers appear stopped)");
    for (const project of config.projects) {
      console.log(`${project.name} (${project.root})`);
      for (const server of project.servers) {
        const status = statesById.get(server.id)?.status ?? "stopped";
        console.log(`  - ${server.name} [${status}]: ${server.command} (port ${server.port ?? "n/a"})`);
      }
    }
  });

program
  .command("detect <path>")
  .description("Suggest dev servers found in a project folder")
  .action((targetPath: string) => {
    const suggestions = detectSuggestions(targetPath);
    if (suggestions.length === 0) {
      console.log("No dev servers detected.");
      return;
    }
    for (const suggestion of suggestions) {
      console.log(
        `${suggestion.name}: ${suggestion.command} (port ${suggestion.port ?? "n/a"}) [${suggestion.source}]`,
      );
    }
  });

program
  .command("port <number>")
  .description("Show what is listening on a port")
  .action(async (portArg: string) => {
    const port = Number(portArg);
    // occupantOf (netstat/lsof) is authoritative; the bind-test in isPortFree
    // is only a fallback since some network stacks (VPN/EDR software) let a
    // new socket bind a port that is already listened on.
    const occupant = await occupantOf(port);
    if (occupant) {
      console.log(`Port ${port} is used by ${occupant.command} (pid ${occupant.pid}).`);
      return;
    }
    if (await isPortFree(port)) {
      console.log(`Port ${port} is free.`);
    } else {
      console.log(`Port ${port} is in use, but the occupant could not be identified.`);
    }
  });

program
  .command("add-project")
  .description("Register a project")
  .requiredOption("--name <name>", "project name")
  .requiredOption("--path <path>", "absolute path to the project root")
  .action((options: { name: string; path: string }) => {
    const config = loadConfig();
    const project: ProjectConfig = {
      id: generateId("prj"),
      name: options.name,
      root: path.resolve(options.path),
      servers: [],
    };
    config.projects.push(project);
    saveConfig(config);
    console.log(`Added project ${project.name} (${project.id})`);
  });

program
  .command("add-server")
  .description("Register a server under a project")
  .requiredOption("--project <project>", "project name or id")
  .requiredOption("--name <name>", "server name")
  .requiredOption("--command <command>", "shell command to run")
  .option("--port <port>", "port the server listens on")
  .option("--directory <directory>", "directory relative to the project root")
  .option("--health-url <url>", "health check URL or path")
  .option("--no-auto-restart", "do not restart automatically on crash")
  .option("--start", "start the server immediately after adding it")
  .action(
    async (options: {
      project: string;
      name: string;
      command: string;
      port?: string;
      directory?: string;
      healthUrl?: string;
      autoRestart: boolean;
      start?: boolean;
    }) => {
      const config = loadConfig();
      const project = config.projects.find((p) => p.id === options.project || p.name === options.project);
      if (!project) {
        console.error(`Unknown project: ${options.project}`);
        process.exitCode = 1;
        return;
      }
      const server: ServerConfig = {
        id: generateId("srv"),
        name: options.name,
        command: options.command,
        port: options.port ? Number(options.port) : null,
        directory: options.directory ?? null,
        env: {},
        healthURL: options.healthUrl ?? null,
        autoRestart: options.autoRestart,
      };
      project.servers.push(server);
      saveConfig(config);
      console.log(`Added server ${project.name}/${server.name} (${server.id})`);
      if (options.start) {
        await daemonRequest("POST", "/start", { server: server.id });
        console.log("Started.");
      }
    },
  );

program
  .command("remove <server>")
  .description("Remove a server (by id, name, or project/name)")
  .action((ref: string) => {
    const config = loadConfig();
    const found = resolveServer(config, ref);
    if (!found) {
      console.error(`Unknown server: ${ref}`);
      process.exitCode = 1;
      return;
    }
    found.project.servers = found.project.servers.filter((server) => server.id !== found.server.id);
    saveConfig(config);
    console.log(`Removed ${found.project.name}/${found.server.name}`);
  });

program
  .command("start <server>")
  .description("Start a server")
  .action(async (ref: string) => {
    const state = await daemonRequest<ServerState>("POST", "/start", { server: ref });
    console.log(`${ref}: ${state.status} (pid ${state.pid ?? "n/a"})`);
  });

program
  .command("stop <server>")
  .description("Stop a server")
  .action(async (ref: string) => {
    const state = await daemonRequest<ServerState>("POST", "/stop", { server: ref });
    console.log(`${ref}: ${state.status}`);
  });

program
  .command("restart <server>")
  .description("Restart a server")
  .action(async (ref: string) => {
    const state = await daemonRequest<ServerState>("POST", "/restart", { server: ref });
    console.log(`${ref}: ${state.status} (pid ${state.pid ?? "n/a"})`);
  });

program
  .command("logs <server>")
  .description("Show captured output for a server")
  .option("--tail <n>", "number of lines to show", "100")
  .action(async (ref: string, options: { tail: string }) => {
    const data = await daemonRequest<{ lines: string[] }>(
      "GET",
      `/logs?server=${encodeURIComponent(ref)}&tail=${encodeURIComponent(options.tail)}`,
    );
    for (const line of data.lines) console.log(line);
  });

program.parseAsync(process.argv);
