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

/** Every listening TCP port: PID -> its ports (best effort: netstat on Windows, lsof elsewhere). */
export function listeningPorts(): Map<number, number[]> {
  const byPid = new Map<number, number[]>()
  const add = (pid: number, port: number) => {
    const ports = byPid.get(pid) ?? []
    if (!ports.includes(port)) byPid.set(pid, [...ports, port])
  }
  try {
    if (process.platform === 'win32') {
      const out = ['TCP', 'TCPv6'].map((proto) => execFileSync('netstat', ['-ano', '-p', proto], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })).join('\n')
      for (const line of out.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/)
        if (cols[0] === 'TCP' && cols[3] === 'LISTENING') add(Number(cols[4]), Number(cols[1]!.slice(cols[1]!.lastIndexOf(':') + 1)))
      }
    } else {
      // -F pn: `p<pid>` then `n<addr>:<port>` lines.
      let pid = 0
      for (const line of execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).split('\n')) {
        if (line.startsWith('p')) pid = Number(line.slice(1))
        else if (line.startsWith('n') && pid) add(pid, Number(line.slice(line.lastIndexOf(':') + 1)))
      }
    }
  } catch {
    // no netstat / lsof, or none listening (lsof exits 1)
  }
  return byPid
}

/** Who listens on `port`. */
export function portHolder(port: number): PortHolder | null {
  for (const [pid, ports] of listeningPorts()) if (ports.includes(port)) return { pid }
  return null
}

export async function waitListening(port: number, timeoutMs: number, stillAlive: () => boolean): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until && stillAlive()) {
    if (!(await isFree(port))) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}
