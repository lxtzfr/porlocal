import { execFileSync, spawnSync } from 'node:child_process'

export interface ProcInfo {
  pid: number
  ppid: number
  name: string
  cmd: string
}

/** `ConvertTo-Json -Compress` output. PowerShell 5.1 leaves some control characters of a command line unescaped. */
export function parseWindowsProcesses(json: string): ProcInfo[] {
  const rows = JSON.parse(json.replace(/[\x00-\x1f]/g, ' ')) as Array<{ ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null }>
  return rows.map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, cmd: p.CommandLine ?? '' }))
}

export function processTable(): Map<number, ProcInfo> {
  const table = new Map<number, ProcInfo>()
  if (process.platform === 'win32') {
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    for (const p of parseWindowsProcesses(out)) table.set(p.pid, p)
    return table
  }
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm=,args='], { encoding: 'utf-8', windowsHide: true })
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/)
    if (m) table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), name: m[3]!, cmd: m[4]! })
  }
  return table
}

/** `pid` then its parents, up to `max` (a PID reused as its own ancestor ends it). */
export function ancestry(table: Map<number, ProcInfo>, pid: number, max = 30): ProcInfo[] {
  const chain: ProcInfo[] = []
  for (let p = table.get(pid); p && chain.length < max && !chain.includes(p); p = table.get(p.ppid)) chain.push(p)
  return chain
}

/**
 * Git Bash (MSYS): a fork + exec leaves the Windows parent PID of the exec'd process pointing at a process gone, which
 * cuts the chain to the session. MSYS `ps` still links them: Windows PID -> its MSYS parent's Windows PID.
 */
export function msysParents(psOutput: string): Map<number, number> {
  const rows = psOutput.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/).map(Number)).filter((r) => r.length >= 4 && r.slice(0, 4).every(Number.isInteger))
  const winpid = new Map(rows.map(([pid, , , win]) => [pid!, win!]))
  const parents = new Map<number, number>()
  for (const [, ppid, , win] of rows) if (winpid.has(ppid!)) parents.set(win!, winpid.get(ppid!)!)
  return parents
}

/** The MSYS links of this machine, read from the CLI when it runs under Git Bash (the daemon has no MSYS PATH). */
export function readMsysParents(): Array<[number, number]> {
  if (process.platform !== 'win32' || !process.env.MSYSTEM) return []
  try {
    return [...msysParents(execFileSync('ps', ['-l'], { encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }))]
  } catch {
    return []
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Kills `pid` and every descendant: `pnpm dev` -> node -> vite, killing only the first leaves the server running. */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM') // spawned detached: its own process group
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
  }, 3000).unref()
}

const SHELLS = /^(bash|sh|zsh|dash|fish|cmd|powershell|pwsh)(\.exe)?$/i

/** A terminal tab's shell (not one running a single command): where a dev tree started by hand stops. */
export const isInteractiveShell = (p: ProcInfo) => SHELLS.test(p.name) && !isOneShot(p.cmd)
const RUNNERS = /(porlocal|pnpm|npm|npx|corepack|yarn)/i

// A shell given a command (`-c`, `/c`, `-Command`, `-File`) or a script (a positional argument, e.g. a bin shim)
// exits when it is done; `-NoExit` (VS Code's PowerShell) or flags only (`bash --login -i`) is a terminal tab.
export function isOneShot(cmd: string): boolean {
  if (/(^|\s)-noexit(\s|$)/i.test(cmd)) return false
  const args = cmd.replace(/^\s*("[^"]*"|\S+)\s*/, '').match(/"[^"]*"|\S+/g) ?? []
  return args.some((arg) => /^(-c|\/c|\/k|-command|-file|-encodedcommand)$/i.test(arg) || !/^[-/]/.test(arg))
}

/**
 * The process whose life a launched service follows: the first ancestor that is not a one-shot wrapper. Skipped: a
 * shell running a single command (`bash -c`, `cmd /c`, `pwsh -Command` without `-NoExit`: Claude Code's Bash tool, a
 * script) and package runners. Kept: an interactive shell (a terminal tab), an IDE, a Claude Code session.
 */
export function detectOwner(table: Map<number, ProcInfo>, fromPid: number, parentHints = new Map<number, number>()): ProcInfo | null {
  let current = table.get(fromPid)
  const seen = new Set<number>()
  while (current && !seen.has(current.pid)) {
    seen.add(current.pid)
    // An exec keeps the MSYS PID: `ps` lists the exec'd process (already walked), not the stub whose parent is gone.
    const hinted = [...seen].reverse().map((pid) => parentHints.get(pid)).find((pid) => pid !== undefined && !seen.has(pid))
    const parent = table.get(current.ppid) ?? (hinted === undefined ? undefined : table.get(hinted))
    if (!parent || parent.pid <= 4) return null
    const oneShotShell = SHELLS.test(parent.name) && isOneShot(parent.cmd)
    const runner = RUNNERS.test(parent.name) || (/^node(\.exe)?$/i.test(parent.name) && RUNNERS.test(parent.cmd))
    if (!oneShotShell && !runner) return parent
    current = parent
  }
  return null
}
