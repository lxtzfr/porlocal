import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dashboardFile } from '../src/daemon/static.js'

const root = mkdtempSync(join(tmpdir(), 'porlocal-static-'))
const dir = join(root, 'dashboard')
mkdirSync(join(dir, 'assets'), { recursive: true })
writeFileSync(join(dir, '_shell.html'), '<html>shell</html>')
writeFileSync(join(dir, 'assets', 'index-abc.js'), 'js')
writeFileSync(join(root, 'secret.txt'), 'secret')

describe('dashboardFile', () => {
  it('serves a built asset, cached for good', () => {
    const f = dashboardFile('/assets/index-abc.js', dir)
    expect(f.body.toString()).toBe('js')
    expect(f.headers['content-type']).toMatch(/javascript/)
    expect(f.headers['cache-control']).toMatch(/immutable/)
  })

  it('answers the SPA shell for / and client routes', () => {
    for (const path of ['/', '/processes/web', '/assets/missing.js']) {
      const f = dashboardFile(path, dir)
      expect(f.status).toBe(200)
      expect(f.body.toString()).toBe('<html>shell</html>')
    }
  })

  it('never serves a file outside the dashboard folder', () => {
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt']) {
      expect(dashboardFile(path, dir).body.toString()).toBe('<html>shell</html>')
    }
  })

  it('says how to build it when missing', () => {
    const f = dashboardFile('/', join(root, 'none'))
    expect(f.status).toBe(503)
    expect(f.body).toMatch(/pnpm build/)
  })
})
