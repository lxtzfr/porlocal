import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dependsOn, expandCommand, readBlock, resolveEnv, writeBlock } from '../src/envLocal.js'
import { normalize, preferredPort, resolveWorkspace } from '../src/workspace.js'
import { repo, START } from './fixtures.js'

function layout() {
  const root = mkdtempSync(join(tmpdir(), 'porlocal-'))
  const ws = join(root, 'ws')
  const server = repo(ws, 'server', { services: { api: { port: 3001 } }, env: { PORT: '{port:api}', WEB_URL: '{url:web/web}', DATABASE_URL: '{database:DATABASE_URL}' } })
  const web = repo(ws, 'web', { services: { web: { port: 3000 } }, env: { PORT: '{port:web}', VITE_API_URL: '{url:server/api}' } })
  execFileSync('git', ['-C', server, 'worktree', 'add', '-q', '--detach', join(root, 'ws.wt', 'server-2')])
  return { root, server, web, server2: join(root, 'ws.wt', 'server-2') }
}

describe('block', () => {
  it('keeps hand-written lines below the block and the wt markers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'porlocal-'))
    writeFileSync(join(dir, '.env.local'), `${START}\nPORT=3000\n# my-stack services: end\nMANUAL=1\n`)
    expect(readBlock(dir)).toEqual({ PORT: '3000' })
    writeBlock(dir, { PORT: '4100' })
    expect(readFileSync(join(dir, '.env.local'), 'utf-8')).toBe(`${START}\nPORT=4100\n# my-stack services: end\nMANUAL=1\n`)
  })
})

describe('workspace + env', () => {
  it('slot ports follow wt (+10 per slot), links pick the sibling checkout, database keeps wt value', () => {
    const { server2, web } = layout()
    const s2 = resolveWorkspace(server2)
    expect(s2.n).toBe(2)
    expect(preferredPort(s2, 'api')).toBe(3011)
    writeFileSync(join(server2, '.env.local'), `${START}\nDATABASE_URL=postgres://x/app_2\n# my-stack services: end\n`)
    const portOf = (w: string, s: string) => (w === normalize(web) && s === 'web' ? 4100 : preferredPort(resolveWorkspace(w), s))
    expect(resolveEnv(s2, portOf).values).toEqual({ PORT: '3011', WEB_URL: 'http://localhost:4100', DATABASE_URL: 'postgres://x/app_2' })
  })

  it('finds dependents through links and expands commands', () => {
    const { server, server2, web } = layout()
    const w = resolveWorkspace(web)
    expect(dependsOn(w, normalize(server), 'api')).toBe(true)
    expect(dependsOn(w, normalize(server2), 'api')).toBe(false)
    expect(dependsOn({ ...w, links: { server: 2 } }, normalize(server2), 'api')).toBe(true)
    const portOf = (ws: string, s: string) => preferredPort(resolveWorkspace(ws), s)
    expect(expandCommand('vite --port {port} --api {url:server/api}', w, 4100, portOf)).toBe('vite --port 4100 --api http://localhost:3001')
  })
})
