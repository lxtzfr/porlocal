import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Badge, Button, Group, Loader, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import { usePortsSnapshot } from "../hooks/use-ports-snapshot";
import { killPort } from "../lib/porlocal-client";

export const Route = createFileRoute("/ports")({ component: SystemPorts });

function SystemPorts() {
  const { ports, loading, refresh } = usePortsSnapshot();
  const [pending, setPending] = useState<number | null>(null);

  async function handleKill(port: number, command: string) {
    if (!window.confirm(`Stop ${command} on port ${port}? This cannot be undone.`)) return;
    setPending(port);
    try {
      await killPort(port);
      refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to stop the process.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Stack p="lg" gap="md">
      <Group justify="space-between">
        <Title order={2}>System ports</Title>
        <Group gap="xs">
          {loading && <Loader size="xs" />}
          <Button size="xs" variant="light" onClick={refresh}>
            Refresh
          </Button>
        </Group>
      </Group>

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Port</Table.Th>
            <Table.Th>Command</Table.Th>
            <Table.Th>PID</Table.Th>
            <Table.Th>Managed by</Table.Th>
            <Table.Th>Launched from</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {[...ports]
            .sort((a, b) => a.port - b.port)
            .map((listener) => (
              <Table.Tr key={`${listener.port}-${listener.pid}`}>
                <Table.Td>{listener.port}</Table.Td>
                <Table.Td>{listener.command}</Table.Td>
                <Table.Td>{listener.pid}</Table.Td>
                <Table.Td>
                  {listener.managedBy ? (
                    <Badge color="blue" variant="light">
                      {listener.managedBy.project}/{listener.managedBy.server}
                    </Badge>
                  ) : (
                    <Text size="sm" c="dimmed">
                      external
                    </Text>
                  )}
                </Table.Td>
                <Table.Td style={{ maxWidth: 360 }}>
                  {(() => {
                    const label = listener.directory ?? listener.commandLine;
                    if (!label) {
                      return (
                        <Text size="sm" c="dimmed">
                          unknown
                        </Text>
                      );
                    }
                    return (
                      <Tooltip label={label} multiline maw={480} openDelay={300}>
                        <Text size="sm" c="dimmed" truncate="end">
                          {label}
                        </Text>
                      </Tooltip>
                    );
                  })()}
                </Table.Td>
                <Table.Td>
                  {!listener.managedBy && (
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      loading={pending === listener.port}
                      onClick={() => handleKill(listener.port, listener.command)}
                    >
                      Stop
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
