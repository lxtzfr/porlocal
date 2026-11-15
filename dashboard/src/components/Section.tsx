import { Card, Group, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Group gap="xs" mb="sm">
        <Title order={2} size="sm" tt="uppercase" c="dimmed" fw={600}>
          {title}
        </Title>
        {count !== undefined && <Text size="xs" c="dimmed">({count})</Text>}
      </Group>
      {children}
    </Card>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <Text size="sm" c="dimmed">{children}</Text>
}
