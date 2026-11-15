import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions, unityAdb } from '../src/adbPath.js'

const exe = process.platform === 'win32' ? 'adb.exe' : 'adb'

function editor(hub: string, version: string, android = true): string {
  const data = process.platform === 'darwin' ? join(hub, version) : join(hub, version, 'Editor', 'Data')
  const tools = join(data, 'PlaybackEngines', 'AndroidPlayer', 'SDK', 'platform-tools')
  mkdirSync(android ? tools : data, { recursive: true })
  if (android) writeFileSync(join(tools, exe), '')
  return join(tools, exe)
}

describe('unityAdb', () => {
  it('versions compare numerically', () => {
    expect(compareVersions('6000.3.28f1', '6000.3.6f1')).toBeGreaterThan(0)
    expect(compareVersions('2022.3.1f1', '6000.0.1f1')).toBeLessThan(0)
  })

  it('takes the newest editor with Android support', () => {
    const hub = mkdtempSync(join(tmpdir(), 'porlocal-hub-'))
    editor(hub, '6000.0.66f2')
    const newest = editor(hub, '6000.3.28f1')
    editor(hub, '6000.3.6f1')
    editor(hub, '6000.4.0f1', false)
    expect(unityAdb([hub, join(hub, 'missing')])).toBe(newest)
    expect(unityAdb([join(hub, 'missing')])).toBeNull()
  })
})
