import { Badge, Button, Group, Table, Text, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconSkull } from '@tabler/icons-react'
import type { Zombie } from '../../../src/api'
import { useKill } from '../api'
import { Path, PortLink } from './cells'
import { Empty } from './Section'

export function ZombiesTable({ zombies }: { zombies: Zombie[] }) {
  const kill = useKill()
  if (!zombies.length) return <Empty>None: every dev process of these checkouts runs under porlocal.</Empty>
  const confirm = (z: Zombie) =>
    modals.openConfirmModal({
      title: `Kill PID ${z.pid}?`,
      children: <Text size="sm">{z.name} in {z.checkout}, and its whole process tree.</Text>,
      labels: { confirm: 'Kill', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => kill.mutate(z.pid),
    })
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
                <Button size="compact-xs" variant="light" color="red" leftSection={<IconSkull size={14} />}
                  loading={kill.isPending && kill.variables === z.pid} onClick={() => confirm(z)}>
                  kill
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
