import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const START = '# my-stack services: start (rewritten by `pnpm wt env`; override a key on a line below the block)'

/** A committed git repo `parent/name` whose package.json holds `myStack`. */
export function repo(parent: string, name: string, myStack: object): string {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ myStack }))
  execFileSync('git', ['init', '-q', '-b', 'main', dir])
  execFileSync('git', ['-C', dir, 'add', '-A'])
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'])
  return dir
}
