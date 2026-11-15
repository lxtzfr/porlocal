import { Badge, Group, Table, Text, Tooltip } from '@mantine/core'
import type { Zombie } from '../../../src/api'
import { Path, PortLink } from './cells'
import { KillButton } from './KillButton'
import { Empty } from './Section'

export function ZombiesTable({ zombies }: { zombies: Zombie[] }) {
  if (!zombies.length) return <Empty>None: every dev process of these checkouts runs under porlocal.</Empty>
  return (
    <Table.ScrollContainer minWidth={900}>
      <Table highlightOnHover verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            {['PID', 'Name', 'Ports', 'Checkout', 'Command', ''].map((h) => <Table.Th key={h}>{h}</Table.Th>)}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {zombies.map((z) => (
            <Table.Tr key={z.pid}>
              <Table.Td><Text size="sm">{z.pid}</Text></Table.Td>
              <Table.Td>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm">{z.name}</Text>
                  {z.orphan && (
                    <Tooltip label="Its parent is gone">
                      <Badge color="yellow" variant="light" size="sm">orphan</Badge>
                    </Tooltip>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <Group gap={6}>{z.ports.length ? z.ports.map((p) => <PortLink key={p} port={p} />) : <Text size="sm" c="dimmed">-</Text>}</Group>
              </Table.Td>
              <Table.Td><Path value={z.checkout} /></Table.Td>
              <Table.Td><Path value={z.cmd} max={360} /></Table.Td>
              <Table.Td>
                <KillButton pid={z.pid} name={z.name} checkout={z.checkout} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
