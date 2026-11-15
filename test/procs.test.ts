import { describe, expect, it } from 'vitest'
import { detectOwner, isOneShot, type ProcInfo } from '../src/procs.js'

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
