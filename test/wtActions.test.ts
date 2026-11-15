import { describe, expect, it } from 'vitest'
import { runWt, type WtCommand } from '../src/daemon/wtActions.js'
import type { Workspace } from '../src/workspace.js'

const silent = { info: () => {}, warn: () => {}, error: () => {} }
const ws = (n: number | null, name: string): Workspace => ({ path: '/x', main: '/m', repo: 'r', n, name, links: {}, services: {}, env: {} })

describe('runWt', () => {
  it('only runs free / done, on a slot, with a plain slot name', () => {
    expect(() => runWt(ws(2, 'r-2'), 'remove' as WtCommand, silent)).toThrow('unknown wt command')
    expect(() => runWt(ws(1, 'r'), 'free', silent)).toThrow('is no slot')
    expect(() => runWt(ws(null, 'r@x'), 'done', silent)).toThrow('is no slot')
    expect(() => runWt(ws(2, 'r-2 & calc'), 'free', silent)).toThrow('unexpected slot name')
  })
})
