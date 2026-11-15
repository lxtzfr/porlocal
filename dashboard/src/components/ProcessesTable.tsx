import { ActionIcon, Badge, Group, Table, Text, Tooltip } from '@mantine/core'
import { IconFileText, IconPin, IconPlayerPlay, IconPlayerStop, IconRefresh, IconTrash } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import type { StateResponse } from '../../../src/api'
import { useNow, useProcessAction, type ProcessAction } from '../api'
import { ago, isRunning } from '../format'
import { Cmd, Path, PortLink } from './cells'
import { Empty } from './Section'

type Proc = StateResponse['processes'][number]

const STATUS_COLOR: Record<Proc['status'], string> = { ready: 'teal', starting: 'yellow', exited: 'gray', stopped: 'gray' }

function Owner({ p, now }: { p: Proc; now: number }) {
  if (!p.owner) return <Text size="sm" c="dimmed">none</Text>
  const left = p.ownerLostAt ? Math.max(0, Math.round((p.graceMs - (now - p.ownerLostAt)) / 1000)) : null
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

export function ProcessesTable({ processes, onLogs }: { processes: Proc[]; onLogs: (id: string) => void }) {
  const action = useProcessAction()
  const now = useNow()
  if (!processes.length) return <Empty>Nothing launched yet: <Cmd>porlocal run &lt;service&gt;</Cmd></Empty>
  const run = (a: ProcessAction, id: string) => () => action.mutate({ action: a, id })
  const busy = (a: ProcessAction, id: string) => action.isPending && action.variables?.action === a && action.variables.id === id
  const icon = { size: 18, stroke: 1.6 }
  return (
    <Table.ScrollContainer minWidth={900}>
      <Table highlightOnHover verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            {['Service', 'Port', 'Status', 'Owner', 'PID', 'Up', 'Checkout', ''].map((h) => <Table.Th key={h}>{h}</Table.Th>)}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {[...processes].sort((a, b) => a.id.localeCompare(b.id)).map((p) => {
            const running = isRunning(p.status)
            return (
              <Table.Tr key={p.id}>
                <Table.Td><Text fw={600} size="sm">{p.id}</Text></Table.Td>
                <Table.Td><PortLink port={p.port} /></Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Badge color={STATUS_COLOR[p.status]} variant="light">
                      {p.status}{p.status === 'exited' && p.exitCode != null ? ` ${p.exitCode}` : ''}
                    </Badge>
                    {p.status === 'stopped' && p.stopReason && <Text size="xs" c="dimmed">{p.stopReason}</Text>}
                  </Group>
                </Table.Td>
                <Table.Td><Owner p={p} now={now} /></Table.Td>
                <Table.Td><Text size="sm">{p.pid}</Text></Table.Td>
                <Table.Td><Text size="sm">{running ? ago(p.startedAt, now) : ''}</Text></Table.Td>
                <Table.Td><Path value={p.workspace} /></Table.Td>
                <Table.Td>
                  <Group gap={2} wrap="nowrap" justify="flex-end">
                    <Action label="Logs" icon={<IconFileText {...icon} />} onClick={() => onLogs(p.id)} />
                    {running ? (
                      <>
                        <Action label="Restart" icon={<IconRefresh {...icon} />} onClick={run('restart', p.id)} loading={busy('restart', p.id)} />
                        <Action label="Stop" color="red" icon={<IconPlayerStop {...icon} />} onClick={run('stop', p.id)} loading={busy('stop', p.id)} />
                        {p.owner && <Action label="Keep (outlive its owner)" icon={<IconPin {...icon} />} onClick={run('keep', p.id)} loading={busy('keep', p.id)} />}
                      </>
                    ) : (
                      <>
                        <Action label="Start" color="teal" icon={<IconPlayerPlay {...icon} />} onClick={run('restart', p.id)} loading={busy('restart', p.id)} />
                        <Action label="Forget" color="gray" icon={<IconTrash {...icon} />} onClick={run('forget', p.id)} loading={busy('forget', p.id)} />
                      </>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
