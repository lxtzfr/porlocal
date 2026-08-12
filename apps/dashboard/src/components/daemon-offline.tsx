import { Alert, Button, Code, Stack, Text, Title } from "@mantine/core";
import { PORLOCAL_API_BASE } from "../lib/porlocal-client";

interface DaemonOfflineProps {
  onRetry: () => void;
}

/**
 * Nothing on any page works without the daemon: no status, no start/stop,
 * no ports view. Shown instead of the page content rather than as a small
 * badge, since a badge is easy to miss and leaves an empty/broken-looking
 * page behind it.
 */
export function DaemonOffline({ onRetry }: DaemonOfflineProps) {
  return (
    <Stack align="center" justify="center" gap="md" style={{ minHeight: "60vh" }} p="xl">
      <Title order={3}>Daemon not reachable</Title>
      <Text c="dimmed" ta="center" maw={480}>
        Porlocal's daemon isn't running (or isn't reachable at {PORLOCAL_API_BASE}). Nothing on this page will work
        until it starts.
      </Text>
      <Alert color="blue" title="Start it" maw={480} w="100%">
        <Text size="sm">Any CLI command launches the daemon automatically:</Text>
        <Code block mt="xs">
          porlocal status
        </Code>
        <Text size="sm" mt="sm">
          Or in dev mode, restarting on every change:
        </Text>
        <Code block mt="xs">
          npm run daemon:dev
        </Code>
      </Alert>
      <Button variant="light" onClick={onRetry}>
        Retry
      </Button>
    </Stack>
  );
}
