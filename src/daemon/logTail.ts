import { existsSync, readFileSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'

const lastLines = (text: string, lines: number) => text.split(/\r?\n/).slice(-lines).join('\n')

export function tailText(file: string, lines: number): string {
  return existsSync(file) ? lastLines(readFileSync(file, 'utf-8'), lines) : ''
}

export type LogChunk = { kind: 'reset' | 'append'; text: string }

/**
 * Emits the last `lines` of `file` (`reset`), then each piece appended to it. The launched process writes the file
 * itself (no pipe through the daemon), so it is polled by size; a smaller size means it was rotated: `reset` again.
 */
export function followLog(file: string, lines: number, emit: (chunk: LogChunk) => void, everyMs = 500): () => void {
  let offset = 0
  let decoder = new StringDecoder('utf8')
  let busy = false
  const size = () => (existsSync(file) ? statSync(file).size : 0)
  const reset = () => {
    const buf = existsSync(file) ? readFileSync(file) : Buffer.alloc(0)
    offset = buf.length
    decoder = new StringDecoder('utf8')
    emit({ kind: 'reset', text: lastLines(buf.toString('utf-8'), lines) })
  }
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const now = size()
      if (now < offset) reset()
      else if (now > offset) {
        const fh = await open(file, 'r')
        try {
          const buf = Buffer.alloc(now - offset)
          const { bytesRead } = await fh.read(buf, 0, buf.length, offset)
          offset += bytesRead
          const text = decoder.write(buf.subarray(0, bytesRead))
          if (text) emit({ kind: 'append', text })
        } finally {
          await fh.close()
        }
      }
    } catch {
      // Gone between the size check and the read (a rotation): the next tick resets.
    } finally {
      busy = false
    }
  }
  reset()
  const timer = setInterval(tick, everyMs)
  return () => clearInterval(timer)
}
