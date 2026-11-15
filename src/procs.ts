import { execFileSync, spawnSync } from 'node:child_process'

export interface ProcInfo {
  pid: number
  ppid: number
  name: string
  cmd: string
}

export function processTable(): Map<number, ProcInfo> {
  const table = new Map<number, ProcInfo>()
  if (process.platform === 'win32') {
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    for (const p of JSON.parse(out) as Array<{ ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null }>) {
      table.set(p.ProcessId, { pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, cmd: p.CommandLine ?? '' })
    }
    return table
  }
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm=,args='], { encoding: 'utf-8' })
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/)
    if (m) table.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), name: m[3]!, cmd: m[4]! })
  }
  return table
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
export function detectOwner(table: Map<number, ProcInfo>, fromPid: number): ProcInfo | null {
  let current = table.get(fromPid)
  const seen = new Set<number>()
  while (current && !seen.has(current.pid)) {
    seen.add(current.pid)
    const parent = table.get(current.ppid)
    if (!parent || parent.pid <= 4) return null
    const oneShotShell = SHELLS.test(parent.name) && isOneShot(parent.cmd)
    const runner = RUNNERS.test(parent.name) || (/^node(\.exe)?$/i.test(parent.name) && RUNNERS.test(parent.cmd))
    if (!oneShotShell && !runner) return parent
    current = parent
  }
  return null
}
