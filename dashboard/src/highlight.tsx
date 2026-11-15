import { createContext, useContext, useState, type ReactNode } from 'react'

/** What a hovered link points at: a service of a checkout, or a whole checkout (a "used by"). */
export interface Target {
  workspace: string
  service?: string
}

const Ctx = createContext<{ target: Target | null; set: (t: Target | null) => void }>({ target: null, set: () => {} })

// Page-wide: a link can point at a checkout of another group card.
export function HighlightProvider({ children }: { children: ReactNode }) {
  const [target, set] = useState<Target | null>(null)
  return <Ctx.Provider value={{ target, set }}>{children}</Ctx.Provider>
}

/** Props that make an element highlight `target` while hovered. */
export function useHighlighter(target: Target) {
  const { set } = useContext(Ctx)
  return { onMouseEnter: () => set(target), onMouseLeave: () => set(null) }
}

export function useIsHighlighted(workspace: string, service?: string): boolean {
  const { target } = useContext(Ctx)
  return !!target && target.workspace === workspace && target.service === service
}

export const HIGHLIGHT_BG = 'var(--mantine-primary-color-light)'
