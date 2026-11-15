import { Badge, Table, Text } from '@mantine/core'
import type { Lease } from '../../../src/api'
import { Path, PortLink } from './cells'
import { Empty } from './Section'

function Declared({ l }: { l: Lease }) {
  if (l.preferred == null) return <Text size="sm" c="dimmed">dynamic</Text>
  if (l.preferred === l.port) return <Text size="sm">{l.preferred}</Text>
  return <Badge color="yellow" variant="light">{l.preferred} taken</Badge>
}

export function LeasesTable({ leases }: { leases: Lease[] }) {
  if (!leases.length) return <Empty>No lease.</Empty>
  return (
    <Table.ScrollContainer minWidth={600}>
      <Table highlightOnHover verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            {['Port', 'Service', 'Checkout', 'Declared'].map((h) => <Table.Th key={h}>{h}</Table.Th>)}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {[...leases].sort((a, b) => a.port - b.port).map((l) => (
            <Table.Tr key={`${l.workspace}/${l.service}`}>
              <Table.Td><PortLink port={l.port} /></Table.Td>
              <Table.Td><Text size="sm">{l.service}</Text></Table.Td>
              <Table.Td><Path value={l.workspace} /></Table.Td>
              <Table.Td><Declared l={l} /></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}
