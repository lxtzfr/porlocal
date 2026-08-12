import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, Badge, Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import { usePorlocalEvents } from "../hooks/use-porlocal-events";
import { startServer, stopServer, restartServer, type ServerStatus } from "../lib/porlocal-client";
import { LogsDrawer } from "../components/logs-drawer";

export const Route = createFileRoute("/")({ component: Dashboard });

const STATUS_COLOR: Record<ServerStatus, string> = {
  running: "green",
  starting: "yellow",
  crashed: "red",
  stopped: "gray",
};

function Dashboard() {
  const { connected, projects, states, subscribeLogs } = usePorlocalEvents();
  const [logsFor, setLogsFor] = useState<{ id: string; label: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function run(action: (serverId: string) => Promise<unknown>, serverId: string) {
    setPending(serverId);
    try {
      await action(serverId);
    } finally {
      setPending(null);
    }
  }

  return (
    <Stack p="lg" gap="lg">
      <Group justify="space-between">
        <Title order={2}>Porlocal</Title>
        <Badge color={connected ? "green" : "red"} variant="light">
          {connected ? "daemon connected" : "daemon offline"}
        </Badge>
      </Group>

      {projects.length === 0 && (
        <Alert color="blue">No projects configured yet. Use the porlocal CLI to add one.</Alert>
      )}

      {projects.map((project) => (
        <Stack key={project.id} gap="xs">
          <Group gap="xs">
            <Text fw={600}>{project.name}</Text>
            <Text size="sm" c="dimmed">
              {project.root}
            </Text>
          </Group>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Server</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Port</Table.Th>
                <Table.Th>Command</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {project.servers.map((server) => {
                const status = states[server.id]?.status ?? "stopped";
                return (
                  <Table.Tr key={server.id}>
                    <Table.Td>{server.name}</Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLOR[status]} variant="light">
                        {status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{server.port ?? "—"}</Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {server.command}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <Button
                          size="xs"
                          variant="light"
                          loading={pending === server.id}
                          disabled={status === "running" || status === "starting"}
                          onClick={() => run(startServer, server.id)}
                        >
                          Start
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          color="orange"
                          loading={pending === server.id}
                          onClick={() => run(restartServer, server.id)}
                        >
                          Restart
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          loading={pending === server.id}
                          disabled={status === "stopped"}
                          onClick={() => run(stopServer, server.id)}
                        >
                          Stop
                        </Button>
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() => setLogsFor({ id: server.id, label: `${project.name}/${server.name}` })}
                        >
                          Logs
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Stack>
      ))}

      <LogsDrawer
        serverId={logsFor?.id ?? null}
        serverLabel={logsFor?.label ?? ""}
        onClose={() => setLogsFor(null)}
        subscribeLogs={subscribeLogs}
      />
    </Stack>
  );
}
