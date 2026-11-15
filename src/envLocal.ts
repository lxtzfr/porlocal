// `.env.local` managed block: the same block my-stack's `wt env` writes (same markers, block first so a hand-written
// line below it wins). porlocal rewrites it with leased ports; keys it can't resolve (`{database:...}`) keep wt's value.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { refTarget, type Workspace } from './workspace.js'

export const LOCAL_ENV = '.env.local'
const BLOCK_START = '# my-stack services: start (rewritten by `pnpm wt env`; override a key on a line below the block)'
const START_PREFIX = '# my-stack services: start'
const BLOCK_END = '# my-stack services: end'
const PLACEHOLDER = /\{(port|url|database):([^}]+)\}/g

function blockRange(lines: string[]): [number, number] | null {
  const start = lines.findIndex((line) => line.startsWith(START_PREFIX))
  const end = lines.indexOf(BLOCK_END)
  return start >= 0 && end > start ? [start, end] : null
}

const readLines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf-8').split(/\r?\n/) : [])

export function readBlock(dir: string): Record<string, string> {
  const lines = readLines(join(dir, LOCAL_ENV))
  const range = blockRange(lines)
  if (!range) return {}
  return Object.fromEntries(
    lines
      .slice(range[0] + 1, range[1])
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}

/** Returns true when the file changed. */
export function writeBlock(dir: string, values: Record<string, string>): boolean {
  const file = join(dir, LOCAL_ENV)
  const lines = readLines(file)
  const range = blockRange(lines)
  const rest = range ? [...lines.slice(0, range[0]), ...lines.slice(range[1] + 1)] : lines
  const block = Object.keys(values).length ? [BLOCK_START, ...Object.entries(values).map(([k, v]) => `${k}=${v}`), BLOCK_END] : []
  const content = [...block, ...rest].join('\n').replace(/^\n+/, '').replace(/\n*$/, '\n')
  const before = existsSync(file) ? readFileSync(file, 'utf-8') : ''
  if (content.trim() === before.trim()) return false
  writeFileSync(file, content.trim() ? content : '', 'utf-8')
  return true
}

export type PortOf = (workspace: string, service: string) => number | undefined

/** `myStack.env` of `ws` with every `{port:...}` / `{url:...}` resolved through `portOf`. */
export function resolveEnv(ws: Workspace, portOf: PortOf): { values: Record<string, string>; skipped: string[] } {
  const current = readBlock(ws.path)
  const values: Record<string, string> = {}
  const skipped: string[] = []
  for (const [key, template] of Object.entries(ws.env)) {
    if (template.includes('{database:')) {
      if (current[key] !== undefined) values[key] = current[key]
      continue
    }
    try {
      values[key] = template.replace(PLACEHOLDER, (_, kind: string, ref: string) => {
        const target = refTarget(ws, ref)
        const port = portOf(target.workspace, target.service)
        if (port === undefined) throw new Error(`no port for ${ref}`)
        return kind === 'url' ? `http://localhost:${port}` : String(port)
      })
    } catch (err) {
      skipped.push(`${key}: ${(err as Error).message}`)
      if (current[key] !== undefined) values[key] = current[key]
    }
  }
  return { values, skipped }
}

/** `{port}` / `{url}` (this service), `{port:<ref>}` / `{url:<ref>}` in a command line. */
export function expandCommand(cmd: string, ws: Workspace, port: number, portOf: PortOf): string {
  return cmd
    .replace(/\{port\}/g, String(port))
    .replace(/\{url\}/g, `http://localhost:${port}`)
    .replace(/\{(port|url):([^}]+)\}/g, (match, kind: string, ref: string) => {
      const target = refTarget(ws, ref)
      const p = portOf(target.workspace, target.service)
      if (p === undefined) return match
      return kind === 'url' ? `http://localhost:${p}` : String(p)
    })
}

/** Does `ws`'s env reference `<repo>/<service>` in the checkout `target`? (a dependent to rewrite on a port change) */
export function dependsOn(ws: Workspace, target: string, service: string): boolean {
  return Object.values(ws.env).some((template) =>
    [...template.matchAll(PLACEHOLDER)].some(([, kind, ref]) => {
      if (kind === 'database' || !ref) return false
      const t = refTarget(ws, ref)
      return t.workspace === target && t.service === service
    }),
  )
}
