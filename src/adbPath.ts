import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const exe = process.platform === 'win32' ? 'adb.exe' : 'adb'

function onPath(): boolean {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', ['adb'], { windowsHide: true }).status === 0
}

// Unity Hub's install folders: the default one and the user-chosen one (Hub settings: secondaryInstallPath.json).
function hubEditorDirs(): string[] {
  const dirs: string[] = []
  if (process.platform === 'win32') dirs.push(join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Unity', 'Hub', 'Editor'))
  else if (process.platform === 'darwin') dirs.push('/Applications/Unity/Hub/Editor')
  else dirs.push(join(homedir(), 'Unity', 'Hub', 'Editor'))
  const settings = process.platform === 'win32' ? join(process.env.APPDATA ?? '', 'UnityHub', 'secondaryInstallPath.json')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'UnityHub', 'secondaryInstallPath.json')
    : join(homedir(), '.config', 'UnityHub', 'secondaryInstallPath.json')
  try {
    const secondary = JSON.parse(readFileSync(settings, 'utf-8'))
    if (typeof secondary === 'string' && secondary) dirs.push(secondary)
  } catch {
    // no Hub, or no secondary path
  }
  return dirs
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[^0-9]+/).filter(Boolean).map(Number)
  const pb = b.split(/[^0-9]+/).filter(Boolean).map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

// The bundled adb of the newest Unity editor with Android support. Two adb versions fight over the one adb server
// (each restarts it): the tracker re-applies bindings after each restart, so a version mismatch only costs a blip.
export function unityAdb(editorDirs = hubEditorDirs()): string | null {
  const found: Array<{ version: string; path: string }> = []
  for (const dir of editorDirs) {
    if (!existsSync(dir)) continue
    for (const version of readdirSync(dir)) {
      const data = process.platform === 'darwin' ? join(dir, version) : join(dir, version, 'Editor', 'Data')
      const path = join(data, 'PlaybackEngines', 'AndroidPlayer', 'SDK', 'platform-tools', exe)
      if (existsSync(path)) found.push({ version, path })
    }
  }
  found.sort((a, b) => compareVersions(b.version, a.version))
  return found[0]?.path ?? null
}

// `ADB`, then PATH, then the Android SDK, then Unity's bundled one (the usual case on a Unity-only machine).
export function findAdb(): string {
  if (process.env.ADB) return process.env.ADB
  if (onPath()) return 'adb'
  for (const sdk of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    const path = sdk && join(sdk, 'platform-tools', exe)
    if (path && existsSync(path)) return path
  }
  return unityAdb() ?? 'adb'
}
