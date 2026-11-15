import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Checkout, State, Zombie } from '../src/api.js'
import { projectGroups, projectName } from '../src/daemon/projectGroups.js'
import { checkouts } from '../src/daemon/checkouts.js'
import { currentBranch, issueUrl, remoteOf, remoteWebUrl } from '../src/gitInfo.js'
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

const ws = (path: string, repo: string, n: number, env: Record<string, string> = {}): Workspace => ({ path, main: join(root, repo), repo, n, name: n === 1 ? repo : `${repo}-${n}`, services: {}, env, links: {} })
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
    expect(remoteOf(remoteWebUrl(main))).toEqual({ slug: 'me/remote', url: 'https://github.com/me/remote' })
    expect(issueUrl('8-checkouts', 'https://github.com/me/remote')).toBe('https://github.com/me/remote/issues/8')
    expect(issueUrl('8-x', 'https://gitlab.com/me/r')).toBe('https://gitlab.com/me/r/-/issues/8')
    expect(issueUrl('master', 'https://github.com/me/remote')).toBeNull()
  })
})

describe('projectGroups', () => {
  const c = (path: string, label: string, slot: number, uses: string[] = [], branch = 'main') =>
    ({ path, repo: label.replace(/-\d+$/, ''), slot, label, remote: null, branch, issueUrl: null, uses: uses.map((w) => ({ key: 'K', workspace: w, service: 's', port: 1, status: 'ok' })), usedBy: [] }) as Checkout
  const P = 'C:/Git/P/ws'
  const list = [
    c(`${P}/server`, 'server', 1, [`${P}/web`]),
    c(`${P}/web`, 'web', 1, [`${P}/server`]),
    c(`${P}/unity`, 'unity', 1, [`${P}/server`]),
    c(`${P}.wt/server-2`, 'server-2', 2, [], '9-x'),
    c(`${P}.wt/web-2`, 'web-2', 2, [`${P}.wt/server-2`], '9-x'),
    // Points at the main server: joins the main group.
    c(`${P}.wt/admin-3`, 'admin-3', 3, [`${P}/server`], '7-y'),
    c(`${P}.wt/unity-2`, 'unity-2', 2, [], 'feat'),
  ]
  const mainOf = (path: string) => `${P}/${path.split('/').pop()!.replace(/-\d+$/, '')}`

  it('groups the checkouts linked together, named after the project', () => {
    const dir = join(root, 'proj')
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(join(dir, 'TRA-SIM.code-workspace'), '{}')
    const groups = projectGroups(list, (p) => join(dir, basename(p)))
    expect(groups.map((g) => [g.label, g.branch, g.paths.map((p) => p.split('/').pop())])).toEqual([
      ['TRA-SIM · main + slot 3', null, ['server', 'web', 'unity', 'admin-3']],
      ['TRA-SIM · slot 2', '9-x', ['server-2', 'web-2']],
      ['TRA-SIM · slot 2', 'feat', ['unity-2']],
    ])
    expect(groups.every((g) => g.kind === 'workspace' && g.workspace === dirname(join(dir, 'x')))).toBe(true)
  })

  it('names a group without a workspace repo after its repos: solo, or linked', () => {
    // `P` holds the repos side by side, it is no repo itself.
    expect(projectGroups(list, mainOf).map((g) => [g.kind, g.label])).toEqual([
      ['linked', 'admin + server + unity + web · main + slot 3'],
      ['linked', 'server + web · slot 2'],
      ['solo', 'unity · slot 2'],
    ])
  })

  it('names a project from its package name when no .code-workspace', () => {
    const dir = join(root, 'pkg')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{"name":"@tra-sim/workspace"}')
    expect(projectName(dir)).toBe('tra-sim')
  })
})
