# porlocal

Optional local dev helper for Windows: it leases ports, launches and supervises the dev servers of your projects, keeps
device port mappings (`adb reverse`) and shows everything in a dashboard. A project never needs it: it runs with a plain
`pnpm dev` (the declared port) and porlocal only fills the same `.env.local` block `pnpm wt env` writes.

## Install

`pnpm install`, `pnpm build`, then `pnpm link --global` for the `porlocal` command. `porlocal --help` lists every command.

## Run a project with porlocal

1. Declare its dev servers in the project's `package.json` (the port is the main checkout's, the project's own range):

   ```json
   "localDev": {
     "services": { "web": { "port": 3000, "run": "pnpm dev" } },
     "env": { "PORT": "{port:web}" }
   }
   ```

2. Make the dev server read its port from the environment, never from a `--port` flag (Vite:
   `server: { port: Number(process.env.PORT ?? loadEnv('development', process.cwd(), 'PORT').PORT) || 3000, strictPort: true }`).
3. `pnpm wt env` once in the checkout (writes `PORT=...` in `.env.local`), then `porlocal up` from it (every service) or
   `porlocal run web`.

If the declared port is taken, porlocal says so and starts the service on another one, rewriting `.env.local`: whatever
else reads the port (a script, an agent, an OAuth redirect URL) must read `.env.local` too, or it keeps aiming at the
declared one. `porlocal status` shows each checkout, its services, and what runs there outside porlocal (a `pnpm dev` by
hand, a leftover); `porlocal ports` shows who holds each port.

Do not add a `porlocal` script to a project's `package.json`: the tool is optional, a clone without it must still work.

## Daily use

`porlocal logs <service> -f`, `porlocal stop|restart <service>`, `porlocal dashboard`, `porlocal daemon autostart on`
(daemon and tray icon at login). A service stops when the terminal, IDE or Claude Code session that started it ends
(30 s grace); `porlocal keep <service>` detaches it from its owner.
