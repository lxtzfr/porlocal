import { Anchor, Code, Text, Tooltip } from '@mantine/core'

export function PortLink({ port }: { port: number }) {
  return (
    <Anchor href={`http://localhost:${port}`} target="_blank" rel="noopener" size="sm">
      {port}
    </Anchor>
  )
}

export function Path({ value, max = 320 }: { value: string; max?: number }) {
  return (
    <Tooltip label={value} openDelay={400} multiline maw={600}>
      <Text size="xs" c="dimmed" truncate="start" maw={max}>
        {value}
      </Text>
    </Tooltip>
  )
}

export const Cmd = ({ children }: { children: string }) => <Code>{children}</Code>
