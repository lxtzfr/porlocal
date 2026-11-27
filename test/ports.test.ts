import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isFree } from '../src/ports.js'

describe('isFree', () => {
  it.each(['127.0.0.1', '0.0.0.0', '::1', '::'])('sees a server listening on %s', async (host) => {
    const server = createServer()
    await new Promise<void>((done) => server.listen({ port: 0, host }, done))
    const { port } = server.address() as { port: number }
    expect(await isFree(port)).toBe(false)
    await new Promise((done) => server.close(done))
    expect(await isFree(port)).toBe(true)
  })
})
