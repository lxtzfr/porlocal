import { Badge, Group, Table, Text, Tooltip } from '@mantine/core'
import type { PortStatus, ProjectPort } from '../../../src/api'
import { Path, PortLink } from './cells'
import { KillButton } from './KillButton'
import { Empty } from './Section'

const STATUS: Record<PortStatus, { color: string; label: string; tip: string }> = {
  ok: { color: 'teal', label: 'ok', tip: 'Its service runs on it under porlocal' },
  free: { color: 'gray', label: 'free', tip: 'Leased, nothing listens on it' },
  moved: { color: 'yellow', label: 'moved', tip: 'Its declared port was taken: the service got another one' },
  hand: { color: 'orange', label: 'started by hand', tip: 'A dev process of a checkout, outside porlocal' },
  conflict: { color: 'red', label: 'conflict', tip: 'Another service or app holds it' },
}

const label = (workspace: string, service: string) => `${workspace.split('/').pop()}/${service}`

function Holder({ p }: { p: ProjectPort }) {
  const h = p.holder
  if (!h) return <Text size="sm" c="dimmed">-</Text>
  if (h.kind === 'porlocal') return <Text size="sm">{h.id}</Text>
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="sm">{h.name}</Text>
      <Text size="xs" c="dimmed">{h.pid}</Text>
    </Group>
  )
}

export function PortsTable({ ports }: { ports: ProjectPort[] }) {
  if (!ports.length) return <Empty>No project port yet: <code>porlocal run</code> leases one.</Empty>
  return (
    <Table.ScrollContainer minWidth={800}>
      <Table highlightOnHover verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            {['Port', 'Status', 'Service', 'Held by', 'Command', ''].map((h) => <Table.Th key={h}>{h}</Table.Th>)}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {ports.map((p) => {
            const s = STATUS[p.status]
            const h = p.holder
            return (
              <Table.Tr key={`${p.port}/${p.expected?.workspace ?? ''}/${p.expected?.service ?? ''}`}>
                <Table.Td>{h ? <PortLink port={p.port} /> : <Text size="sm">{p.port}</Text>}</Table.Td>
                <Table.Td>
                  <Tooltip label={s.tip}>
                    <Badge color={s.color} variant="light">{s.label}{p.movedTo ? ` → ${p.movedTo}` : ''}</Badge>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  {p.expected ? (
                    <Tooltip label={p.expected.workspace} openDelay={400}>
                      <Text size="sm">{label(p.expected.workspace, p.expected.service)}</Text>
                    </Tooltip>
                  ) : <Text size="sm" c="dimmed">-</Text>}
                </Table.Td>
                <Table.Td><Holder p={p} /></Table.Td>
                <Table.Td>{h && h.kind !== 'porlocal' ? <Path value={h.cmd} max={380} /> : null}</Table.Td>
                <Table.Td>{h?.kind === 'zombie' && <KillButton pid={h.pid} name={h.name} checkout={h.checkout} />}</Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
