import { ActionIcon, Badge, Group, Text, Title, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core'
import { IconMoon, IconSun } from '@tabler/icons-react'
import { useDaemonState } from '../api'
import { isRunning } from '../format'

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

export function AppHeader({ live }: { live: boolean }) {
  const state = useDaemonState()
  const s = state.data
  return (
    <Group justify="space-between" mb="md">
      <Group gap="sm" align="center">
        <Title order={1} size="h3">porlocal</Title>
        <Badge color={live ? 'teal' : 'red'} variant="dot">{live ? 'live' : 'daemon unreachable'}</Badge>
        {s && (
          <Text size="sm" c="dimmed">
            {s.processes.filter((p) => isRunning(p.status)).length} running, last change {new Date(state.dataUpdatedAt).toLocaleTimeString()}
          </Text>
        )}
      </Group>
      <ThemeToggle />
    </Group>
  )
}
