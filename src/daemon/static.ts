import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// The dashboard's client build (`pnpm build`: dashboard/ -> dist/dashboard), next to dist/daemon/.
export const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard/', import.meta.url))
// The SPA shell TanStack Start prerenders: every non-file path gets it (client-side routes).
const SHELL = '_shell.html'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export interface StaticFile {
  status: number
  headers: Record<string, string>
  body: Buffer | string
}

export function dashboardFile(pathname: string, dir = DASHBOARD_DIR): StaticFile {
  const shell = join(dir, SHELL)
  if (!existsSync(shell)) {
    return { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: `dashboard not built (${dir}): pnpm build` }
  }
  let rel: string
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '')
  } catch {
    rel = ''
  }
  const file = join(dir, rel)
  // A `..` in the path must not leave the dashboard folder.
  const inside = file.startsWith(dir.endsWith(sep) ? dir : dir + sep)
  if (rel && inside && existsSync(file) && statSync(file).isFile()) {
    // Vite hashes asset names: they never change under the same URL.
    const cache = rel.startsWith(`assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
    return { status: 200, headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache }, body: readFileSync(file) }
  }
  return { status: 200, headers: { 'content-type': TYPES['.html']!, 'cache-control': 'no-cache' }, body: readFileSync(shell) }
}
