import type { ServerResponse } from 'node:http'
import type { Logger } from '../log.js'

export interface EventStream {
  send(event: string, json: string): void
  onClose(fn: () => void): void
}

// Server-sent events: a GET the browser's EventSource keeps open (and reopens on its own after a daemon restart).
export function eventStream(res: ServerResponse): EventStream {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  res.write('retry: 2000\n\n')
  // A comment line now and then: proxies and idle timeouts never see a silent connection.
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
  res.on('close', () => clearInterval(ping))
  return {
    send: (event, json) => res.write(`event: ${event}\ndata: ${json}\n\n`),
    onClose: (fn) => res.on('close', fn),
  }
}

/**
 * One value pushed to every listener whenever its JSON changes: computed every `everyMs` while someone listens (one
 * shared timer, none when nobody does), and right away on `poke()` (after an action).
 */
export class Feed<T> {
  private readonly clients = new Set<EventStream>()
  private last = ''
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly event: string,
    private readonly compute: () => T,
    private readonly everyMs: number,
    private readonly log: Logger,
  ) {}

  add(stream: EventStream): void {
    this.clients.add(stream)
    stream.onClose(() => {
      this.clients.delete(stream)
      if (this.clients.size === 0) this.stopTimer()
    })
    const json = this.json()
    if (json === undefined) return
    this.last = json
    stream.send(this.event, json)
    this.timer ??= setInterval(() => this.poke(), this.everyMs)
  }

  poke(): void {
    if (this.clients.size === 0) return
    const json = this.json()
    if (json === undefined || json === this.last) return
    this.last = json
    for (const c of this.clients) c.send(this.event, json)
  }

  private json(): string | undefined {
    try {
      return JSON.stringify(this.compute())
    } catch (err) {
      this.log.error(`event ${this.event}`, err)
      return undefined
    }
  }

  private stopTimer(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.last = ''
  }
}
