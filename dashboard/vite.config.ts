import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // `.env.local` of the checkout (repo root): the dev port `wt env` / porlocal gave this slot.
  const env = { ...loadEnv(mode, '..', ''), ...process.env }
  const daemon = `http://127.0.0.1:${env.PORLOCAL_PORT ?? 4780}`
  return {
    plugins: [
      // SPA mode: the build is static files the daemon serves; Start never runs a server of its own.
      tanstackStart({ spa: { enabled: true } }),
      viteReact(),
    ],
    // The daemon serves the client build from the package's dist; the server build only prerenders the SPA shell.
    environments: { client: { build: { outDir: '../dist/dashboard', emptyOutDir: true } } },
    // One local page loaded from 127.0.0.1: bundle size doesn't matter, no code splitting needed.
    build: { chunkSizeWarningLimit: 2000 },
    server: {
      port: Number(env.DASHBOARD_PORT ?? 4090),
      strictPort: true,
      // changeOrigin: the daemon only answers a 127.0.0.1 / localhost Host header.
      proxy: { '/api': { target: daemon, changeOrigin: true } },
    },
  }
})
