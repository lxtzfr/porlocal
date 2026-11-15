import { spawn } from 'node:child_process'

/** Opens a URL in the default browser, without waiting for it. */
export function openUrl(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true, windowsHide: true }).unref()
}
