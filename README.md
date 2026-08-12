# Porlocal

A cross-platform dashboard for your local dev servers — see what's running on which port, at a glance, and control it from a CLI or a web UI.

Inspired by [Portly](https://github.com/Melvynx/portly), but built to run anywhere Node.js runs (macOS, Linux, Windows) via a local CLI/daemon + web dashboard, instead of a native menu bar app.

## Status

Functional for day-to-day use, developed and tested primarily on Windows. macOS/Linux code paths exist (`lsof`, `ps`) but haven't been exercised for real yet — expect rough edges there. No automated test suite yet; everything has been validated by hand so far.

## What it does

- Register your projects and their dev servers once, then start/stop/restart them from a CLI or a web dashboard instead of juggling terminal tabs.
- Auto-restarts a crashed server, with a health check (TCP + optional HTTP) before it's reported as actually up.
- Shows every port in use on the machine, whether porlocal manages it or not, and lets you stop external processes or take over a port that's blocking one of your configured servers.
- Live status and log streaming in the dashboard via SSE — no manual refresh.

## Install

Requires Node.js 18+.

```bash
git clone <this repo>
cd porlocal
npm install
npm run build
npm link --workspace=apps/porlocal   # makes the `porlocal` command available globally
```

## Usage

```bash
# Register a project and let porlocal guess its dev servers
porlocal detect ~/code/my-app
porlocal add-project --name my-app --path ~/code/my-app
porlocal add-server --project my-app --name web --command "npm run dev" --port 3000 --start

# Day to day
porlocal status                 # or --json for scripts/agents
porlocal start my-app/web
porlocal stop my-app/web
porlocal restart my-app/web
porlocal logs my-app/web --tail 100

# Port conflicts
porlocal port 3000              # who's listening?
porlocal kill-port 3000         # stop an unrelated process (asks for confirmation)
porlocal take-over my-app/web   # stop whatever squats the configured port, then start under porlocal

# Web dashboard
porlocal dashboard              # builds it on first run, opens your browser
```

Run `porlocal --help` or `porlocal <command> --help` for the full list and flags. Every command that needs the daemon launches it automatically if it isn't already running.

## How it works

npm workspaces monorepo, three packages:

- **`apps/porlocal`** — the CLI, the daemon it spawns, and the `Supervisor` that actually runs and watches your servers' processes. This is the whole product's runtime; it has no dependency on the dashboard and stays up even if the dashboard is never opened.
- **`apps/dashboard`** — a TanStack Start + Mantine web UI. A separate, optional client of the daemon's API, with its own production build.
- **`packages/core`** — shared TypeScript types for the shapes that flow between the daemon and both clients, so they can't drift apart.

### `apps/porlocal`

One Node.js process, one event loop, run as a background daemon — supervision isn't a separate thing running alongside it, it *is* the daemon. Inside that single process:

- an `http.createServer` handling the control API
- a `Supervisor` instance (`apps/porlocal/src/daemon/supervisor.ts`), a plain in-memory object the HTTP handlers call methods on
- `setInterval` health-check timers

The only real extra OS processes involved are the dev servers themselves, spawned as children of the daemon — one per running server, each with its own pid, independent of the daemon's.

#### CLI ↔ daemon

The CLI is a thin client; it holds no supervision logic itself. Every command that needs live state (`start`, `stop`, `logs`, ...) sends an HTTP request to the daemon over `127.0.0.1:7737` and gets back a JSON envelope (`{ok, data}` or `{ok: false, error}`). If nothing answers, the CLI spawns the daemon as a detached background process and polls `/ping` until it's up — you never start it manually. `status`/`detect`/`port` fall back to reading the config file or the OS directly when the daemon isn't reachable, so basic inspection still works even before anything is running. The daemon also exposes `/events`, a Server-Sent Events stream the dashboard subscribes to for live state and log updates instead of polling.

#### Process supervision

The `Supervisor` spawns each server with `child_process.spawn(command, { shell: true })`, captures stdout/stderr into an in-memory ring buffer plus a log file, and polls a health check (TCP connect, plus an optional HTTP request) every 2 seconds to decide between `starting`/`running`. A crash triggers an auto-restart (up to `maxRestartAttempts`) unless the stop was explicit.

Two details fell out of testing this for real rather than assuming it would just work:

- `shell: true` means the pid Node hands back is the shell's (`cmd.exe`/`sh`), not the real process listening on the port — that's a grandchild. The supervisor re-resolves the actual listening pid via the OS on every health tick, so safety checks (see below) recognize the right process.
- When the daemon itself restarts (crash, or you just relaunched it), Node doesn't kill orphaned children — they keep running. On startup the daemon checks every configured server's port and **adopts** whatever's already answering there instead of reporting it as stopped. Adopted servers have no `ChildProcess` handle (porlocal never spawned them this time around), so `stop`/`kill-port` act on the raw pid directly, and death is detected by the port going quiet rather than an `exit` event.

#### Port detection

There's no portable Node API for "who's listening on this port," so it's OS-specific: `lsof` on macOS/Linux, `netstat` + a batched `Get-CimInstance Win32_Process` (for the full command line, since Windows has no cwd API) on Windows. A plain bind-test (`isPortFree`) exists as a fallback but isn't trusted first — on this machine, some VPN/EDR software lets a second process bind a port that's already listened on, silently giving a wrong answer.

#### Safety model

Nothing here auto-kills anything. `kill-port` and `take-over` always require confirmation — an interactive prompt, or an explicit `--yes` for scripts/agents — and the daemon itself refuses to let `kill-port` target a pid it recognizes as one of its own supervised servers (`isManagedPid`), so a slip of the command line can't take down something porlocal is managing.

#### Agent integration

`porlocal init` writes an idempotent, marker-delimited rule into `AGENTS.md` telling AI coding agents to always go through `porlocal` instead of launching dev servers directly (in their own shell tool, which blocks their turn and dies when the session ends), and installs a skill (`apps/porlocal/skills/porlocal/SKILL.md`) documenting the CLI. See it in action: `porlocal init` in a project, then check its `AGENTS.md`.

#### Config

Lives at `~/.config/porlocal/config.json` (`%APPDATA%\porlocal` on Windows, `~/Library/Application Support/porlocal` on macOS) — plain JSON, versioned, hot-read on every request rather than cached. Logs live alongside it in `logs/`.

### `apps/dashboard`

Built with TanStack Start (React) + Mantine, served by its own Nitro production build (`porlocal dashboard` builds it once, then runs `node .output/server/index.mjs`). It talks to the daemon's HTTP + SSE API from the browser; since it can end up on any port (its default can be taken by something else), the daemon's CORS allows any `localhost`/`127.0.0.1` origin rather than a fixed one — never a wildcard, since a page from a random remote site can't present that origin. When the daemon isn't reachable, every page shows a dedicated "daemon offline" screen with instructions instead of a silently broken empty page.

### `packages/core`

Shared TypeScript types (`ServerConfig`, `ProjectConfig`, `ServerState`, `PortListener`, ...) for the config/state shapes that flow between the daemon and both clients — a single source of truth instead of each side keeping its own copy.

## Development

```bash
npm run build          # build packages/core then apps/porlocal
npm run typecheck      # typecheck all three workspace packages
npm run daemon:dev     # daemon with auto-restart on file changes (tsx watch)
npm run dashboard:dev  # dashboard dev server (Vite)
```
