import { ActionIcon, Badge, Container, Group, Stack, Text, Title, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core'
import { IconMoon, IconSun } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useDaemonState, useZombies } from '../api'
import { DevicesSection } from '../components/DevicesSection'
import { LeasesTable } from '../components/LeasesTable'
import { LogDrawer } from '../components/LogDrawer'
import { ProcessesTable } from '../components/ProcessesTable'
import { Empty, Section } from '../components/Section'
import { ZombiesTable } from '../components/ZombiesTable'
import { isRunning } from '../format'

export const Route = createFileRoute('/')({ component: Dashboard })

function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme()
  const scheme = useComputedColorScheme('light')
  return (
    <Tooltip label="Toggle theme">
      <ActionIcon variant="default" aria-label="Toggle theme" onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>
        {scheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  )
}

function Dashboard() {
  const state = useDaemonState()
  const zombies = useZombies()
  const [logId, setLogId] = useState<string | null>(null)
  const s = state.data
  return (
    <Container size="xl" py="md">
      <Group justify="space-between" mb="md">
        <Group gap="sm" align="baseline">
          <Title order={1} size="h3">porlocal</Title>
          {state.isError ? (
            <Badge color="red" variant="light">daemon unreachable</Badge>
          ) : s ? (
            <Text size="sm" c="dimmed">
              {s.processes.filter((p) => isRunning(p.status)).length} running, updated {new Date(state.dataUpdatedAt).toLocaleTimeString()}
            </Text>
          ) : null}
        </Group>
        <ThemeToggle />
      </Group>
      <Stack gap="md">
        <Section title="Processes" count={s?.processes.length}>
          {s ? <ProcessesTable processes={s.processes} onLogs={setLogId} /> : <Empty>Loading…</Empty>}
        </Section>
        <Section title="Outside porlocal" count={zombies.data?.length}>
          {zombies.data ? <ZombiesTable zombies={zombies.data} /> : <Empty>{zombies.isError ? zombies.error.message : 'Loading…'}</Empty>}
        </Section>
        <Section title="Leased ports" count={s?.leases.length}>
          {s ? <LeasesTable leases={s.leases} /> : <Empty>Loading…</Empty>}
        </Section>
        <Section title="Devices">{s ? <DevicesSection state={s} /> : <Empty>Loading…</Empty>}</Section>
      </Stack>
      <LogDrawer id={logId} onClose={() => setLogId(null)} />
    </Container>
  )
}
