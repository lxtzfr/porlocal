# porlocal

Optional local dev helper: leases ports, launches and supervises dev servers (stopped when their owner dies), keeps
device port mappings (`adb reverse`), shows it all in a dashboard. Projects must run without it: it only fills the
same `.env.local` block my-stack's `wt env` writes (contract: `src/envLocal.ts`, my-stack `core/conventions/services.md`).

## Commands

- `pnpm install`, `pnpm build` (tsc -> `dist/`), `pnpm test` (vitest), `pnpm typecheck`.
- `node dist/cli.js <command>` (`pnpm link --global`: the `porlocal` command). `porlocal --help` lists the commands.
- Try it without touching the real daemon: `PORLOCAL_HOME=<tmp dir> PORLOCAL_PORT=4790 node dist/cli.js ...`, then
  `daemon stop` and stop what it launched.

## Layout

- `src/cli.ts` (CLI, talks HTTP to the daemon, starts it detached on demand: `client.ts`; login start: `autostart.ts`).
- `src/daemon/`: `main.ts`, `server.ts` (JSON API + `dashboard.ts` page on 127.0.0.1:4780), `supervisor.ts` (leases,
  processes, owners), `adb.ts` (device bindings), `state.ts` (`~/.porlocal/state.json`, logs in `~/.porlocal/logs/`).
- Shared: `workspace.ts` (checkout, slot n, declared services, links), `envLocal.ts`, `ports.ts`, `procs.ts`, `adbPath.ts` (ADB, PATH, Android SDK, Unity Hub).

## Rules

- Never move a port silently: a taken leased / declared port is an error unless `--new-port`; a move rewrites the
  `.env.local` of every checkout reading it and flags (or restarts) what runs there.
- Launched processes must outlive the daemon: output goes straight to their log file (no pipe), stop = kill the whole
  tree (`killTree`), re-adoption by PID or port holder.
- The API stays local-only: Host header checked, POST JSON only (no cross-site form).
- Paths go through `normalize()` (realpath, `/`): git prints long paths, a cwd may be a Windows 8.3 short one.

<!-- my-stack:core:conventions:start -->
<!-- Managed by my-stack (`my-stack update`): do not edit inside this block. -->
@claude/my-stack/core/CLAUDE.md
<!-- my-stack:core:conventions:end -->

<!-- my-stack:local:start -->
<!-- Managed by my-stack (`my-stack update`): do not edit inside this block. -->
my-stack copies not committed (`my-stack.json` `local`): `core`.
When one is missing (fresh clone: no `claude/my-stack/<kit>/`), say so before any task: `my-stack restore`
rewrites them (needs the my-stack clone).
<!-- my-stack:local:end -->
