import { Alert, Badge, Group, Stack, Table, Text } from '@mantine/core'
import { IconAlertTriangle, IconDeviceMobile } from '@tabler/icons-react'
import type { StateResponse } from '../../../src/api'
import { Cmd, Path } from './cells'
import { Empty } from './Section'

export function DevicesSection({ state }: { state: StateResponse }) {
  return (
    <Stack gap="sm">
      {!state.adb && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
          adb not found: set <Cmd>ADB</Cmd> to its path.
        </Alert>
      )}
      <Group gap="xs">
        <Text size="sm" c="dimmed">Connected:</Text>
        {state.devices.length
          ? state.devices.map((d) => <Badge key={d} variant="light" leftSection={<IconDeviceMobile size={12} />}>{d}</Badge>)
          : <Text size="sm" c="dimmed">none</Text>}
      </Group>
      {state.bindings.length ? (
        <Table.ScrollContainer minWidth={600}>
          <Table highlightOnHover verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                {['Device', 'Device port', 'Host port', 'Service', 'Checkout'].map((h) => <Table.Th key={h}>{h}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {state.bindings.map((b) => (
                <Table.Tr key={`${b.device}/${b.devicePort}`}>
                  <Table.Td><Text size="sm">{b.device}</Text></Table.Td>
                  <Table.Td><Text size="sm">{b.devicePort}</Text></Table.Td>
                  <Table.Td><Text size="sm">{b.hostPort ?? '?'}</Text></Table.Td>
                  <Table.Td><Text size="sm">{b.service}</Text></Table.Td>
                  <Table.Td><Path value={b.workspace} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Empty>No binding: <Cmd>porlocal device bind &lt;service&gt; --port 3001</Cmd></Empty>
      )}
    </Stack>
  )
}
