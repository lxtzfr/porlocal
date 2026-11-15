import { Badge, Group, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import type { MachinePort } from '../../../src/api'
import { useMachine } from '../api'
import { Path, PortLink } from '../components/cells'
import { Empty, Section } from '../components/Section'

export const Route = createFileRoute('/ports')({ component: PortsPage })

function Holder({ p }: { p: MachinePort }) {
  if (p.holder.kind === 'porlocal') return <Badge variant="light" color="teal">{p.holder.id}</Badge>
  if (p.holder.kind === 'zombie') return <Badge variant="light" color="yellow">outside porlocal</Badge>
  return <Text size="sm" c="dimmed">other</Text>
}

const matches = (p: MachinePort, q: string) =>
  !q || String(p.port).startsWith(q) || String(p.pid) === q || p.name.toLowerCase().includes(q) || p.cmd.toLowerCase().includes(q)

// Read-only for what porlocal does not run: kill stays limited to Outside porlocal (the dashboard page).
function PortsPage() {
  const machine = useMachine()
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const ports = machine.data?.ports
  const q = query.trim().toLowerCase()
  const shown = ports?.filter((p) => (all || !p.system || q) && matches(p, q))
  const hidden = ports ? ports.filter((p) => p.system).length : 0
  return (
    <Section title="Listening ports" count={shown?.length}>
      <Group mb="sm" gap="md">
        <TextInput placeholder="Port, PID, process or command" leftSection={<IconSearch size={16} />} value={query}
          onChange={(e) => setQuery(e.currentTarget.value)} w={320} size="sm" />
        <Switch label={`Show system ports (${hidden})`} checked={all} onChange={(e) => setAll(e.currentTarget.checked)} size="sm" />
      </Group>
      {!shown ? (
        <Empty>{machine.isError ? machine.error.message : 'Loading…'}</Empty>
      ) : !shown.length ? (
        <Empty>{q ? `Nothing listening matches "${query}".` : 'No dev port listening.'}</Empty>
      ) : (
        <Table.ScrollContainer minWidth={900}>
          <Table highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                {['Port', 'Process', 'PID', 'Holder', 'Wanted by', 'Command'].map((h) => <Table.Th key={h}>{h}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((p) => (
                <Table.Tr key={`${p.port}/${p.pid}`}>
                  <Table.Td><PortLink port={p.port} /></Table.Td>
                  <Table.Td><Text size="sm" c={p.system ? 'dimmed' : undefined}>{p.name}</Text></Table.Td>
                  <Table.Td><Text size="sm">{p.pid}</Text></Table.Td>
                  <Table.Td><Holder p={p} /></Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {p.wantedBy.map((w) => (
                        <Tooltip key={`${w.workspace}/${w.service}`} label={`${w.workspace}: its declared port, held by ${p.name}`}>
                          <Badge color="red" variant="light">{w.service}</Badge>
                        </Tooltip>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td><Path value={p.cmd} max={420} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Section>
  )
}
