import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LogsResponse, Managed, StateResponse, Zombie } from '../../src/api'

export class ApiError extends Error {}

export async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }))
  if (!res.ok) throw new ApiError(data.error ?? `${res.status}`)
  return data as T
}

export const useDaemonState = () => useQuery({ queryKey: ['state'], queryFn: () => call<StateResponse>('/api/state'), refetchInterval: 2000 })

// Slower than /api/state: the daemon reads the whole process table.
export const useZombies = () => useQuery({ queryKey: ['zombies'], queryFn: () => call<Zombie[]>('/api/zombies'), refetchInterval: 5000 })

export const useLogs = (id: string | null) =>
  useQuery({
    queryKey: ['logs', id],
    queryFn: () => call<LogsResponse>(`/api/logs?id=${encodeURIComponent(id ?? '')}&tail=500`),
    enabled: id !== null,
    refetchInterval: 2000,
  })

export type ProcessAction = 'stop' | 'restart' | 'keep' | 'forget'

export function useProcessAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ action, id }: { action: ProcessAction; id: string }) => call<Managed | null>(`/api/${action}`, { id }),
    onSuccess: (p, { action, id }) => {
      const notes = p?.notes?.length ? p.notes.join('\n') : undefined
      notifications.show({ title: `${action} ${id}`, message: notes ?? 'done', color: 'teal' })
    },
    onError: (err, { action, id }) => notifications.show({ title: `${action} ${id} failed`, message: err.message, color: 'red' }),
    onSettled: () => client.invalidateQueries({ queryKey: ['state'] }),
  })
}

export function useKill() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (pid: number) => call<Zombie>('/api/kill', { pid }),
    onSuccess: (z) => notifications.show({ title: `Killed PID ${z.pid}`, message: `${z.name} (${z.checkout})`, color: 'teal' }),
    onError: (err, pid) => notifications.show({ title: `Kill ${pid} failed`, message: err.message, color: 'red' }),
    onSettled: () => client.invalidateQueries({ queryKey: ['zombies'] }),
  })
}
