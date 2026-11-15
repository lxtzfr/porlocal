import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer()
    server.once('error', (err: NodeJS.ErrnoException) => done(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT'))
    server.listen({ port, host, exclusive: true }, () => server.close(() => done(true)))
  })
}

// Both stacks: Vite binds ::1 for `localhost`, Nest 0.0.0.0 / ::; a port held on either one is taken.
export async function isFree(port: number): Promise<boolean> {
  return (await canListen(port, '127.0.0.1')) && (await canListen(port, '::1')) && (await canListen(port, '::'))
}

export interface PortHolder {
  pid: number
}

/** Who listens on `port` (best effort: netstat on Windows, lsof elsewhere). */
export function portHolder(port: number): PortHolder | null {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      const out6 = execFileSync('netstat', ['-ano', '-p', 'TCPv6'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      for (const line of `${out}\n${out6}`.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/)
        if (cols[0] === 'TCP' && cols[3] === 'LISTENING' && cols[1]?.endsWith(`:${port}`)) return { pid: Number(cols[4]) }
      }
      return null
    }
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    const pid = Number(out.split('\n')[0])
    return pid ? { pid } : null
  } catch {
    return null
  }
}

export async function waitListening(port: number, timeoutMs: number, stillAlive: () => boolean): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until && stillAlive()) {
    if (!(await isFree(port))) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
