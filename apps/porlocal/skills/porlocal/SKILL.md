---
name: porlocal
description: Manage local development servers with the Porlocal CLI and daemon. Use when an agent needs to start, stop, restart, inspect logs or health, register projects/servers, resolve port conflicts, or check what's running locally.
---

# Porlocal

Use the `porlocal` CLI as the primary interface. Every command that talks to the daemon launches it automatically if it isn't already running — there's nothing to start manually first.

## Inspect first

Run `porlocal status` for a compact view of configured projects and servers. Add `--json` only when you need machine-readable fields for scripting. Use an exact server id or `project/server` when a name is ambiguous.

## Register once, reuse

Check `porlocal status` before adding anything — never create a duplicate project/server that already exists.

- New project: `porlocal add-project --name <name> --path <absolute-path>`
- New server: `porlocal add-server --project <project> --name <name> --command '<command>' --port <port> --start`
- `porlocal detect <path>` suggests likely dev commands and ports from a project folder (package.json scripts, framework defaults, Procfile, Cargo.toml, go.mod, manage.py, ...) — use it before guessing a command by hand.

## Command reference

| Command | Purpose |
| --- | --- |
| `status` | Compact view of projects/servers; `--json` for machine-readable fields |
| `detect <path>` | Suggest dev servers found in a folder |
| `add-project`, `add-server`, `update-server`, `remove` | Manage configuration |
| `start`, `stop`, `restart` | Control a server |
| `logs <server> --tail <n>` | Read captured output |
| `port <number>` | Inspect what's listening on a port |
| `kill-port <number>` | Stop an unrelated external process (asks for confirmation; pass `--yes` non-interactively) |
| `take-over <server>` | Stop whatever squats a configured port, then start the server under porlocal |
| `dashboard` | Build (first run only) and open the web UI |

Run `porlocal <command> --help` for exact flags.

## Operate

- Never launch a persistent dev server directly in a shell, in the background, or through another supervisor — always through `porlocal add-server` followed by `start`/`restart`.
- Check for conflicts with `porlocal port <n>` before starting. If the port is already used by something unrelated, use `porlocal take-over <project/server>` rather than picking a different port or killing things by hand.
- `porlocal kill-port` and `take-over` require confirmation and are never automatic. Pass `--yes` only when running non-interactively, and only after actually confirming with `porlocal port <n>` that the target is in scope — never guess.
- Keep proof distinct: `porlocal status` proves porlocal's own view, `porlocal logs <server>` proves what the process actually printed, a direct request (`curl`) proves the route responds.

## Dashboard

`porlocal dashboard` builds (once) and serves a local web UI with live status, logs, and the same port-conflict resolution as the CLI. It's optional — the CLI works standalone and nothing here depends on it being open.

## Keeping this rule current

`porlocal init` writes the durable project rule below into the repository's root `AGENTS.md` (or `~/.agents/AGENTS.md` with `--global`) and installs this skill file. It's idempotent — safe to run again, and it won't touch anything outside its own marked block.
