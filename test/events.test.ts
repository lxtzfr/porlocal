import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Feed, type EventStream } from '../src/daemon/events.js'
import { followLog, type LogChunk } from '../src/daemon/logTail.js'
import type { Logger } from '../src/log.js'

const log = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function stream() {
  const sent: Array<[string, unknown]> = []
  let close = () => {}
  const s: EventStream = { send: (e, json) => sent.push([e, JSON.parse(json)]), onClose: (fn) => (close = fn) }
  return { s, sent, close: () => close() }
}

describe('followLog', () => {
  it('sends the tail, then what is appended, and resets on rotation', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'porlocal-log-')), 'a.log')
    writeFileSync(file, 'one\ntwo\nthree\n')
    const chunks: LogChunk[] = []
    const stop = followLog(file, 2, (c) => chunks.push(c), 20)
    try {
      expect(chunks).toEqual([{ kind: 'reset', text: 'three\n' }])
      appendFileSync(file, 'four\n')
      // A UTF-8 character split between two reads comes out whole.
      const e = Buffer.from('é\n')
      appendFileSync(file, e.subarray(0, 1))
      await wait(80)
      appendFileSync(file, e.subarray(1))
      await wait(80)
      expect(chunks.slice(1).map((c) => c.text).join('')).toBe('four\né\n')
      writeFileSync(file, 'new\n')
      await wait(80)
      expect(chunks.at(-1)).toEqual({ kind: 'reset', text: 'new\n' })
    } finally {
      stop()
    }
  })
})

describe('Feed', () => {
  it('sends the value on join, then only when it changes, and stops computing once nobody listens', async () => {
    let value = 1
    const compute = vi.fn(() => ({ value }))
    const feed = new Feed('state', compute, 20, log)
    const a = stream()
    feed.add(a.s)
    expect(a.sent).toEqual([['state', { value: 1 }]])
    await wait(70)
    expect(a.sent).toHaveLength(1)
    value = 2
    feed.poke()
    expect(a.sent).toEqual([['state', { value: 1 }], ['state', { value: 2 }]])
    a.close()
    const calls = compute.mock.calls.length
    await wait(70)
    expect(compute.mock.calls.length).toBe(calls)
  })
})
