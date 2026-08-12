#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { ProjectConfig, ServerConfig, ServerState } from "@porlocal/core";
import { loadConfig, saveConfig } from "../core/config-store.js";
import { detectSuggestions } from "../core/command-detector.js";
import { generateId } from "../core/ids.js";
import { upsertAgentRule } from "../core/agent-rule.js";
import { occupantOf, isPortFree } from "../core/ports.js";
import { daemonRequest, peekDaemon } from "./daemon-client.js";
import { ensureDashboard, openBrowser } from "./dashboard-client.js";

const program = new Command();

/** Never kills anything without an explicit yes — from a human prompt or --yes for scripts/agents. */
async function confirm(question: string, assumeYes: boolean | undefined): Promise<boolean> {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    console.error(`${question} Re-run with --yes to confirm in a non-interactive shell.`);
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

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
      const server = await daemonRequest<ServerConfig>("POST", "/servers/add", {
        project: options.project,
        name: options.name,
        command: options.command,
        port: options.port ? Number(options.port) : null,
        directory: options.directory ?? null,
        healthURL: options.healthUrl ?? null,
        autoRestart: options.autoRestart,
      });
      console.log(`Added server ${options.project}/${server.name} (${server.id})`);
      if (options.start) {
        await daemonRequest("POST", "/start", { server: server.id });
        console.log("Started.");
      }
    },
  );

program
  .command("update-server <server>")
  .description("Update fields of an existing server (by id, name, or project/name)")
  .option("--name <name>", "new name")
  .option("--command <command>", "new shell command")
  .option("--port <port>", "new port (use 'none' to clear)")
  .option("--directory <directory>", "new directory relative to the project root")
  .option("--health-url <url>", "new health check URL or path")
  .option("--auto-restart", "enable auto-restart on crash")
  .option("--no-auto-restart", "disable auto-restart on crash")
  .action(
    async (
      ref: string,
      options: {
        name?: string;
        command?: string;
        port?: string;
        directory?: string;
        healthUrl?: string;
        autoRestart?: boolean;
      },
    ) => {
      const patch: Partial<ServerConfig> = {};
      if (options.name !== undefined) patch.name = options.name;
      if (options.command !== undefined) patch.command = options.command;
      if (options.port !== undefined) patch.port = options.port === "none" ? null : Number(options.port);
      if (options.directory !== undefined) patch.directory = options.directory;
      if (options.healthUrl !== undefined) patch.healthURL = options.healthUrl;
      if (options.autoRestart !== undefined) patch.autoRestart = options.autoRestart;

      if (Object.keys(patch).length === 0) {
        console.error("Nothing to update — pass at least one option.");
        process.exitCode = 1;
        return;
      }
      const server = await daemonRequest<ServerConfig>("POST", "/servers/update", { server: ref, patch });
      console.log(`Updated ${server.name}: ${server.command} (port ${server.port ?? "n/a"})`);
      console.log("Restart the server for the change to take effect if it is currently running.");
    },
  );

program
  .command("remove <server>")
  .description("Remove a server (by id, name, or project/name)")
  .action(async (ref: string) => {
    const data = await daemonRequest<{ removed: string }>("POST", "/servers/remove", { server: ref });
    console.log(`Removed ${data.removed}`);
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

program
  .command("kill-port <port>")
  .description("Stop whatever is listening on a port (never a server porlocal supervises — use stop for those)")
  .option("--force", "send SIGKILL instead of SIGTERM")
  .option("--yes", "skip the confirmation prompt")
  .action(async (portArg: string, options: { force?: boolean; yes?: boolean }) => {
    const port = Number(portArg);
    const occupant = await occupantOf(port);
    if (!occupant) {
      console.log(`Port ${port} is already free.`);
      return;
    }
    const proceed = await confirm(`Stop ${occupant.command} (pid ${occupant.pid}) on port ${port}?`, options.yes);
    if (!proceed) {
      console.log("Aborted.");
      return;
    }
    const data = await daemonRequest<{ pid: number; command: string }>("POST", "/ports/kill", {
      port,
      force: options.force === true,
    });
    console.log(`Stopped ${data.command} (pid ${data.pid}).`);
  });

program
  .command("take-over <server>")
  .description("Stop the external process on a server's configured port, then start it under porlocal")
  .option("--yes", "skip the confirmation prompt")
  .action(async (ref: string, options: { yes?: boolean }) => {
    const config = loadConfig();
    const port = config.projects
      .flatMap((project) => project.servers)
      .find((server) => server.id === ref || server.name === ref)?.port;
    const occupant = port ? await occupantOf(port) : null;

    if (occupant) {
      const proceed = await confirm(
        `Stop ${occupant.command} (pid ${occupant.pid}) currently on port ${port} and start ${ref} under porlocal?`,
        options.yes,
      );
      if (!proceed) {
        console.log("Aborted.");
        return;
      }
    }

    const state = await daemonRequest<ServerState>("POST", "/take-over", { server: ref });
    console.log(`${ref}: ${state.status} (pid ${state.pid ?? "n/a"})`);
  });

program
  .command("init")
  .description("Set up AGENTS.md rules and install the agent skill so AI coding agents use porlocal")
  .option("--global", "update ~/.agents/AGENTS.md instead of the project's ./AGENTS.md")
  .action((options: { global?: boolean }) => {
    const targetPath = options.global
      ? path.join(os.homedir(), ".agents", "AGENTS.md")
      : path.join(process.cwd(), "AGENTS.md");
    const { created, updated } = upsertAgentRule(targetPath);
    console.log(created ? `Created ${targetPath}` : updated ? `Updated ${targetPath}` : `${targetPath} already up to date`);

    const here = path.dirname(fileURLToPath(import.meta.url));
    const bundledSkill = path.join(here, "..", "..", "skills", "porlocal", "SKILL.md");
    const skillDir = path.join(os.homedir(), ".agents", "skills", "porlocal");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(bundledSkill, path.join(skillDir, "SKILL.md"));
    console.log(`Installed skill at ${path.join(skillDir, "SKILL.md")}`);
  });

program
  .command("dashboard")
  .description("Build (first run only) and open the web dashboard")
  .option("--port <port>", "port to serve the dashboard on", "3000")
  .option("--no-open", "do not open a browser automatically")
  .action(async (options: { port: string; open: boolean }) => {
    const port = Number(options.port);
    const { url, alreadyRunning } = await ensureDashboard(port);
    console.log(alreadyRunning ? `Dashboard already running at ${url}` : `Dashboard running at ${url}`);
    if (options.open) openBrowser(url);
  });

program.parseAsync(process.argv);
