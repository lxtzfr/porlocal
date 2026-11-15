import { describe, expect, it } from 'vitest'
import { detectOwner, isOneShot, msysParents, type ProcInfo } from '../src/procs.js'

const table = (procs: Array<[number, number, string, string]>) =>
  new Map<number, ProcInfo>(procs.map(([pid, ppid, name, cmd]) => [pid, { pid, ppid, name, cmd }]))

describe('isOneShot', () => {
  it.each([
    [String.raw`"C:\Program Files\Git\bin\bash.exe" -c "porlocal run"`, true],
    ['bash /home/me/.local/bin/porlocal run', true],
    [String.raw`C:\WINDOWS\system32\cmd.exe /d /s /c "porlocal run"`, true],
    ['pwsh.exe -NoProfile -Command porlocal run', true],
    ['pwsh.exe -noexit -command "try { . shellIntegration.ps1 } catch {}"', false],
    [String.raw`"C:\Program Files\PowerShell\7\pwsh.exe"`, false],
    ['bash --login -i', false],
  ])('%s -> %s', (cmd, expected) => expect(isOneShot(cmd)).toBe(expected))
})

describe('detectOwner', () => {
  it('skips the one-shot shell of a Claude Code tool call: owner = the session', () => {
    const t = table([
      [10, 1, 'node.exe', 'node claude-code/cli.js'],
      [20, 10, 'bash.exe', 'bash.exe -c "porlocal run api"'],
      [30, 20, 'node.exe', 'node C:/x/porlocal/dist/cli.js run api'],
    ])
    expect(detectOwner(t, 30)?.pid).toBe(10)
  })

  it('keeps an interactive terminal shell, skips package runners', () => {
    const t = table([
      [5, 1, 'WindowsTerminal.exe', 'WindowsTerminal.exe'],
      [10, 5, 'pwsh.exe', String.raw`"C:\Program Files\PowerShell\7\pwsh.exe"`],
      [20, 10, 'node.exe', 'node pnpm.cjs porlocal run'],
      [30, 20, 'node.exe', 'node dist/cli.js run'],
    ])
    expect(detectOwner(t, 30)?.pid).toBe(10)
  })

  it('no owner when the chain reaches the system', () => {
    const t = table([[30, 4, 'node.exe', 'node dist/cli.js run']])
    expect(detectOwner(t, 30)).toBeNull()
  })
})

describe('msysParents', () => {
  const ps = [
    '      PID    PPID    PGID     WINPID   TTY         UID    STIME COMMAND',
    '     3413       1    3413      23356  ?         197609 05:09:25 /usr/bin/bash',
    '     3414    3413    3413      23300  ?         197609 05:09:25 /usr/bin/sh',
    '     3415    3414    3413      25032  ?         197609 05:09:25 /usr/bin/ps',
  ].join('\n')

  it('maps Windows PIDs to their MSYS parent', () => {
    expect([...msysParents(ps)]).toEqual([[23300, 23356], [25032, 23300]])
  })

  // The bin shim `sh` execs node: ps lists node under the shim's MSYS PID, the shim's Windows stub has a dead parent.
  it('mends the chain a Git Bash exec cuts: owner = the session', () => {
    const t = table([
      [10, 1, 'claude.exe', 'claude.exe --resume x'],
      [31688, 10, 'bash.exe', 'bash.exe -c "porlocal up"'],
      [24896, 999, 'sh.exe', 'sh /c/Users/me/pnpm/porlocal up'],
      [30, 24896, 'node.exe', 'node dist/cli.js up'],
    ])
    const execPs = ['header', '     3529       1    3529      31688  ?  197609 05:11:07 /usr/bin/bash', '     3531    3529    3529         30  ?  197609 05:11:07 /c/Program Files/nodejs/node'].join('\n')
    expect(detectOwner(t, 30)).toBeNull()
    expect(detectOwner(t, 30, msysParents(execPs))?.pid).toBe(10)
  })
})
