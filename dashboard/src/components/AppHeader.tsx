import { ActionIcon, Badge, Button, Group, Text, Title, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core'
import { IconLayoutDashboard, IconMoon, IconPlugConnected, IconSun } from '@tabler/icons-react'
import { Link, useLocation } from '@tanstack/react-router'
import { useDaemonState, useMachine } from '../api'
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
  const machine = useMachine()
  const path = useLocation({ select: (l) => l.pathname })
  const s = state.data
  const devPorts = machine.data?.ports.filter((p) => !p.system).length
  const conflicts = machine.data?.ports.filter((p) => p.wantedBy.length).length ?? 0
  const nav = (to: '/' | '/ports', label: string, icon: React.ReactNode, extra?: React.ReactNode) => (
    <Button component={Link} to={to} size="xs" variant={path === to ? 'light' : 'subtle'} leftSection={icon} rightSection={extra}>
      {label}
    </Button>
  )
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
      <Group gap="xs">
        {nav('/', 'Dashboard', <IconLayoutDashboard size={16} />)}
        {nav('/ports', 'Ports', <IconPlugConnected size={16} />,
          devPorts !== undefined && <Badge size="xs" variant="light" color={conflicts ? 'red' : 'gray'}>{conflicts ? `${conflicts} conflict` : devPorts}</Badge>)}
        <ThemeToggle />
      </Group>
    </Group>
  )
}
