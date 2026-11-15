import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { State, Zombie } from '../src/api.js'
import { checkouts } from '../src/daemon/checkouts.js'
import { currentBranch, issueUrl, remoteWebUrl } from '../src/gitInfo.js'
import { normalize, type Workspace } from '../src/workspace.js'

// Slots live in `<parent>.wt/<repo>-<n>`, shared by every repo of the parent.
const root = join(normalize(mkdtempSync(join(tmpdir(), 'porlocal-checkouts-'))), 'ws')
const dir = (...parts: string[]) => {
  const path = join(root, ...parts)
  mkdirSync(path, { recursive: true })
  return normalize(path)
}
const server = dir('server')
const web = dir('web')
const web2 = normalize(join(root + '.wt', 'web-2'))
mkdirSync(web2, { recursive: true })
const admin = dir('admin')
const ENV = '# my-stack services: start\nAPI_URL=http://localhost:4100\n# my-stack services: end\n'
writeFileSync(join(web, '.env.local'), ENV)
writeFileSync(join(web2, '.env.local'), ENV.replace('4100', '3001'))
for (const path of [server, web, web2, admin]) writeFileSync(join(path, 'package.json'), '{}')

const ws = (path: string, repo: string, n: number, env: Record<string, string> = {}): Workspace => ({ path, main: join(root, repo), repo, n, services: {}, env, links: {} })
const workspaces: Record<string, Workspace> = {
  [server]: ws(server, 'server', 1),
  [web]: ws(web, 'web', 1, { API_URL: '{url:server/api}' }),
  [web2]: ws(web2, 'web', 2, { API_URL: '{url:server/api}' }),
  // Never run, points at nothing known: left out.
  [admin]: ws(admin, 'admin', 1),
}
const state = { leases: [{ workspace: server, service: 'api', port: 4100 }], processes: [], bindings: [] } as unknown as State

describe('checkouts', () => {
  const run = (listening: number[], zombies: Zombie[] = []) =>
    checkouts({ state, zombies, listening: new Set(listening), workspace: (p) => workspaces[p]! })

  it('lists the known checkouts and the siblings using them, with their links', () => {
    const list = run([4100])
    expect(list.map((c) => c.label)).toEqual(['server', 'web', 'web-2'])
    const [s, w, w2] = list
    expect(w!.uses).toEqual([{ key: 'API_URL', workspace: server, service: 'api', port: 4100, status: 'ok' }])
    expect(w2!.uses[0]).toMatchObject({ status: 'stale', written: 'http://localhost:3001', expected: 'http://localhost:4100' })
    expect(s!.usedBy.map((u) => [u.label, u.status])).toEqual([['web', 'ok'], ['web-2', 'stale']])
  })

  it('flags a link whose target does not listen', () => {
    expect(run([]).find((c) => c.label === 'web')!.uses[0]!.status).toBe('down')
  })
})

describe('gitInfo', () => {
  it('reads the branch of a checkout and of a worktree', () => {
    const main = dir('repo')
    mkdirSync(join(main, '.git', 'worktrees', 'repo-2'), { recursive: true })
    writeFileSync(join(main, '.git', 'HEAD'), 'ref: refs/heads/master\n')
    writeFileSync(join(main, '.git', 'worktrees', 'repo-2', 'HEAD'), 'ref: refs/heads/8-checkouts\n')
    const slot = dir('repo.wt', 'repo-2')
    writeFileSync(join(slot, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'repo-2')}\n`)
    expect(currentBranch(main)).toBe('master')
    expect(currentBranch(slot)).toBe('8-checkouts')
    expect(currentBranch(admin)).toBeNull()
  })

  it('links a <n>-<slug> branch to its issue on origin', () => {
    const main = dir('remote')
    mkdirSync(join(main, '.git'))
    writeFileSync(join(main, '.git', 'config'), '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:me/remote.git\n')
    expect(remoteWebUrl(main)).toBe('https://github.com/me/remote')
    expect(issueUrl('8-checkouts', 'https://github.com/me/remote')).toBe('https://github.com/me/remote/issues/8')
    expect(issueUrl('8-x', 'https://gitlab.com/me/r')).toBe('https://gitlab.com/me/r/-/issues/8')
    expect(issueUrl('master', 'https://github.com/me/remote')).toBeNull()
  })
})
