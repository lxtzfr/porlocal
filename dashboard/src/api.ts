import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { MachineResponse, Managed, StateResponse, Zombie } from '../../src/api'

export class ApiError extends Error {}

export async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }))
  if (!res.ok) throw new ApiError(data.error ?? `${res.status}`)
  return data as T
}

// The daemon pushes both over /api/events (useEvents): the queries only hold what it last sent.
const pushed = { staleTime: Infinity, refetchOnWindowFocus: false } as const
export const useDaemonState = () => useQuery({ queryKey: ['state'], queryFn: () => call<StateResponse>('/api/state'), ...pushed })
// One snapshot (zombies, ports, checkouts): the daemon reads the machine once for all.
export const useMachine = () => useQuery({ queryKey: ['machine'], queryFn: () => call<MachineResponse>('/api/machine'), ...pushed })

/** Feeds the query cache from the daemon's event stream; false while it is unreachable (EventSource retries alone). */
export function useEvents(): boolean {
  const client = useQueryClient()
  const [live, setLive] = useState(false)
  useEffect(() => {
    const source = new EventSource('/api/events')
    source.onopen = () => setLive(true)
    source.onerror = () => setLive(false)
    for (const key of ['state', 'machine']) {
      source.addEventListener(key, (e) => client.setQueryData([key], JSON.parse((e as MessageEvent).data)))
    }
    return () => source.close()
  }, [client])
  return live
}

// Keeps the last part only: a chatty dev server must not grow the page without end.
const MAX_LOG_CHARS = 500_000

/** The process's log: its tail, then each piece the daemon sees appended (reset when the log is rotated). */
export function useLogStream(id: string | null, tail = 500): { text: string; error: string | null } {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setText('')
    setError(null)
    if (id === null) return
    const source = new EventSource(`/api/logs/stream?id=${encodeURIComponent(id)}&tail=${tail}`)
    source.addEventListener('reset', (e) => setText(JSON.parse((e as MessageEvent).data)))
    source.addEventListener('append', (e) => setText((t) => (t + JSON.parse((e as MessageEvent).data)).slice(-MAX_LOG_CHARS)))
    source.onopen = () => setError(null)
    source.onerror = () => setError('stream interrupted, reconnecting…')
    return () => source.close()
  }, [id, tail])
  return { text, error }
}

/** Re-renders every `everyMs`: countdowns and uptimes move between pushes. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

export type ProcessAction = 'stop' | 'restart' | 'keep' | 'forget'

// No invalidation after an action: the daemon pushes the new state as soon as a POST is done.
export function useProcessAction() {
  return useMutation({
    mutationFn: ({ action, id }: { action: ProcessAction; id: string }) => call<Managed | null>(`/api/${action}`, { id }),
    onSuccess: (p, { action, id }) => {
      const notes = p?.notes?.length ? p.notes.join('\n') : undefined
      notifications.show({ title: `${action} ${id}`, message: notes ?? 'done', color: 'teal' })
    },
    onError: (err, { action, id }) => notifications.show({ title: `${action} ${id} failed`, message: err.message, color: 'red' }),
  })
}

export type CheckoutAction = 'env' | 'free' | 'done'

/** `env` rewrites the checkout's `.env.local`; `free` / `done` run its `pnpm wt` on the slot. */
export function useCheckoutAction() {
  return useMutation({
    mutationFn: ({ action, path }: { action: CheckoutAction; path: string; label: string }) =>
      action === 'env' ? call<{ keys: string[] }>('/api/checkout/env', { path }).then((r) => `rewritten: ${r.keys.join(', ') || 'no key'}`) : call<{ output: string }>('/api/checkout/wt', { path, command: action }).then((r) => r.output.split('\n').filter((l) => l.startsWith('[wt]')).at(-1) ?? 'done'),
    onSuccess: (message, { action, label }) => notifications.show({ title: `${label}: ${action === 'env' ? '.env.local' : `wt ${action}`}`, message, color: 'teal' }),
    onError: (err, { action, label }) => notifications.show({ title: `${label}: ${action === 'env' ? '.env.local' : `wt ${action}`} failed`, message: err.message, color: 'red', autoClose: false }),
  })
}

/** Starts a service the checkout declares (what `porlocal run <service>` does there). */
export function useStartService() {
  return useMutation({
    mutationFn: ({ path, service }: { path: string; service: string }) => call<Managed>('/api/checkout/run', { path, service }),
    onSuccess: (p, { service }) => notifications.show({ title: `start ${service}`, message: p.notes?.join('\n') ?? 'started', color: 'teal' }),
    onError: (err, { service }) => notifications.show({ title: `start ${service} failed`, message: err.message, color: 'red', autoClose: false }),
  })
}

export function useKill() {
  return useMutation({
    mutationFn: (pid: number) => call<Zombie>('/api/kill', { pid }),
    onSuccess: (z) => notifications.show({ title: `Killed PID ${z.pid}`, message: `${z.name} (${z.checkout})`, color: 'teal' }),
    onError: (err, pid) => notifications.show({ title: `Kill ${pid} failed`, message: err.message, color: 'red' }),
  })
}
