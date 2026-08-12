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

## Architecture

npm workspaces monorepo:

- **`apps/porlocal`** — the CLI, plus the daemon it spawns (a small loopback-only HTTP + SSE server) and the `Supervisor` that actually runs and watches your servers' processes. This is the whole product's runtime; it has no dependency on the dashboard and stays up even if the dashboard is never opened.
- **`apps/dashboard`** — a TanStack Start + Mantine web UI. A separate, optional client of the daemon's API. Ships as its own production build (`porlocal dashboard` builds and serves it) so nothing in the daemon depends on it being present.
- **`packages/core`** — shared TypeScript types for the config/state shapes that flow between the daemon and both clients.

Both the daemon's control API and the dashboard's server bind to `127.0.0.1` only — nothing here is meant to be reachable from the network.

Config lives at `~/.config/porlocal/config.json` (or the platform equivalent — `%APPDATA%\porlocal` on Windows, `~/Library/Application Support/porlocal` on macOS), and logs at `~/.config/porlocal/logs/`.

More context on the design decisions along the way: [`docs/portly-analysis.md`](docs/portly-analysis.md) and [`ROADMAP.md`](ROADMAP.md).

## Development

```bash
npm run build          # build packages/core then apps/porlocal
npm run typecheck      # typecheck all three workspace packages
npm run daemon:dev     # daemon with auto-restart on file changes (tsx watch)
npm run dashboard:dev  # dashboard dev server (Vite)
```
