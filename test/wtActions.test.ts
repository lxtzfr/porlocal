import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasSlotActions, runWt, type WtCommand } from '../src/daemon/wtActions.js'
import type { Workspace } from '../src/workspace.js'

const silent = { info: () => {}, warn: () => {}, error: () => {} }
const repoWith = (scripts: Record<string, string>) => {
  const main = mkdtempSync(join(tmpdir(), 'porlocal-wt-'))
  writeFileSync(join(main, 'package.json'), JSON.stringify({ scripts }))
  return main
}
const withWt = repoWith({ wt: 'wt' })
const withoutWt = repoWith({ build: 'tsc' })
const ws = (n: number | null, name: string, main = withWt): Workspace => ({ path: '/x', main, repo: 'r', n, name, links: {}, services: {}, env: {} })

describe('runWt', () => {
  it('only runs free / done, on a slot of a repo running wt, with a plain slot name', () => {
    expect(() => runWt(ws(2, 'r-2'), 'remove' as WtCommand, silent)).toThrow('unknown wt command')
    expect(() => runWt(ws(1, 'r'), 'free', silent)).toThrow('is no slot')
    expect(() => runWt(ws(null, 'r@x'), 'done', silent)).toThrow('is no slot')
    expect(() => runWt(ws(2, 'r-2', withoutWt), 'free', silent)).toThrow('has no wt script')
    expect(() => runWt(ws(2, 'r-2 & calc'), 'free', silent)).toThrow('unexpected slot name')
  })
})

describe('hasSlotActions', () => {
  it('needs a slot and a wt script in the main checkout', () => {
    expect(hasSlotActions(ws(2, 'r-2'))).toBe(true)
    expect(hasSlotActions(ws(1, 'r'))).toBe(false)
    expect(hasSlotActions(ws(2, 'r-2', withoutWt))).toBe(false)
    expect(hasSlotActions(ws(2, 'r-2', '/nowhere'))).toBe(false)
  })
})
