import { ActionIcon, Badge, Group, Text, Tooltip } from '@mantine/core'
import { IconFileText, IconPin, IconPlayerPlay, IconPlayerStop, IconRefresh, IconTrash } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { useProcessAction, useStartService, type ProcessAction } from '../api'
import type { Proc } from '../../../src/projectView'
import { isRunning } from '../format'

export const STATUS_COLOR: Record<Proc['status'], string> = { ready: 'teal', starting: 'yellow', exited: 'gray', stopped: 'gray' }

export function Owner({ p, now }: { p: Proc; now: number }) {
  if (!p.owner) return <Text size="sm" c="dimmed">none</Text>
  const left = p.ownerLostAt && isRunning(p.status) ? Math.max(0, Math.round((p.graceMs - (now - p.ownerLostAt)) / 1000)) : null
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="sm">{p.owner.name}</Text>
      <Text size="xs" c="dimmed">{p.owner.pid}</Text>
      {left !== null && <Badge color="red" variant="light" size="sm">gone, stops in {left}s</Badge>}
    </Group>
  )
}

function Action({ label, icon, color, onClick, loading }: { label: string; icon: ReactNode; color?: string; onClick: () => void; loading?: boolean }) {
  return (
    <Tooltip label={label}>
      <ActionIcon variant="subtle" color={color} onClick={onClick} loading={loading} aria-label={label}>
        {icon}
      </ActionIcon>
    </Tooltip>
  )
}

export function StartService({ workspace, service }: { workspace: string; service: string }) {
  const start = useStartService()
  return (
    <Group gap={2} wrap="nowrap" justify="flex-end">
      <Action label="Start" color="teal" icon={<IconPlayerPlay size={18} stroke={1.6} />} onClick={() => start.mutate({ path: workspace, service })} loading={start.isPending} />
    </Group>
  )
}

export function ProcessActions({ p, onLogs }: { p: Proc; onLogs: (id: string) => void }) {
  const action = useProcessAction()
  const run = (a: ProcessAction) => () => action.mutate({ action: a, id: p.id })
  const busy = (a: ProcessAction) => action.isPending && action.variables?.action === a
  const icon = { size: 18, stroke: 1.6 }
  return (
    <Group gap={2} wrap="nowrap" justify="flex-end">
      <Action label="Logs" icon={<IconFileText {...icon} />} onClick={() => onLogs(p.id)} />
      {isRunning(p.status) ? (
        <>
          <Action label="Restart" icon={<IconRefresh {...icon} />} onClick={run('restart')} loading={busy('restart')} />
          <Action label="Stop" color="red" icon={<IconPlayerStop {...icon} />} onClick={run('stop')} loading={busy('stop')} />
          {p.owner && <Action label="Keep (outlive its owner)" icon={<IconPin {...icon} />} onClick={run('keep')} loading={busy('keep')} />}
        </>
      ) : (
        <>
          <Action label="Start" color="teal" icon={<IconPlayerPlay {...icon} />} onClick={run('restart')} loading={busy('restart')} />
          <Action label="Forget" color="gray" icon={<IconTrash {...icon} />} onClick={run('forget')} loading={busy('forget')} />
        </>
      )}
    </Group>
  )
}
