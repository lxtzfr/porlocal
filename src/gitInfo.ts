import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const read = (file: string) => {
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

// Read straight from the files, no `git` call: it runs on every machine tick, for every checkout.
function gitDir(path: string): string | null {
  const dotGit = join(path, '.git')
  if (!existsSync(dotGit)) return null
  if (statSync(dotGit).isDirectory()) return dotGit
  const target = read(dotGit)?.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
  return target ? (isAbsolute(target) ? target : resolve(path, target)) : null
}

/** The branch checked out at `path` (a short SHA when detached), null outside a git checkout. */
export function currentBranch(path: string): string | null {
  const dir = gitDir(path)
  const head = dir && read(join(dir, 'HEAD'))?.trim()
  if (!head) return null
  return head.startsWith('ref: ') ? head.slice(5).replace(/^refs\/heads\//, '') : head.slice(0, 8)
}

/** `origin`'s web page (GitHub, GitLab or any host that serves the repo over https), from the main checkout's config. */
export function remoteWebUrl(main: string): string | null {
  const config = read(join(main, '.git', 'config'))
  const url = config?.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)?.[1]
  if (!url) return null
  const ssh = url.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`
  const https = url.match(/^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?$/)
  return https ? `https://${https[1]}` : null
}

/** The issue a `<n>-<slug>` branch works on (the tickets convention), as a link on `origin`. */
export function issueUrl(branch: string | null, web: string | null): string | null {
  const n = branch?.match(/^(\d+)-/)?.[1]
  if (!n || !web) return null
  return web.includes('gitlab') ? `${web}/-/issues/${n}` : `${web}/issues/${n}`
}
