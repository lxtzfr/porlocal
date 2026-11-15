export interface Logger {
  info(message: string): void
  warn(message: string): void
  error(message: string, err?: unknown): void
}

const stamp = () => new Date().toISOString()

export function createLogger(scope: string): Logger {
  return {
    info: (m) => console.log(`${stamp()} [${scope}] ${m}`),
    warn: (m) => console.warn(`${stamp()} [${scope}] WARN ${m}`),
    error: (m, err) => console.error(`${stamp()} [${scope}] ERROR ${m}${err ? `: ${err instanceof Error ? err.stack ?? err.message : String(err)}` : ''}`),
  }
}
