import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The daemon runs detached without a console: on Windows, any console child spawned without windowsHide pops a window.
const src = join(import.meta.dirname, '..', 'src')
const files = readdirSync(src, { recursive: true, encoding: 'utf-8' }).filter((f) => /\.tsx?$/.test(f))

function calls(code: string): string[] {
  const found: string[] = []
  for (const m of code.matchAll(/(?<![.\w])(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\(/g)) {
    let depth = 0
    let end = m.index + m[0].length - 1
    for (; end < code.length; end++) {
      if (code[end] === '(') depth++
      else if (code[end] === ')' && --depth === 0) break
    }
    found.push(code.slice(m.index, end + 1))
  }
  return found
}

describe('child processes', () => {
  it('are all spawned with windowsHide', () => {
    const missing = files.flatMap((f) =>
      calls(readFileSync(join(src, f), 'utf-8'))
        .filter((call) => !call.includes('windowsHide'))
        .map((call) => `${f}: ${call.split('\n')[0]}`),
    )
    expect(missing).toEqual([])
  })
})
