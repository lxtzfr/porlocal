import { Code, Drawer, ScrollArea, Text } from '@mantine/core'
import { useEffect, useRef } from 'react'
import { useLogStream } from '../api'

// Follows the end of the log while the reader is at the bottom; scrolling up stops following.
export function LogDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const logs = useLogStream(id)
  const viewport = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    follow.current = true
  }, [id])
  useEffect(() => {
    const v = viewport.current
    if (v && follow.current) v.scrollTop = v.scrollHeight
  }, [logs.text])
  return (
    <Drawer opened={id !== null} onClose={onClose} position="right" size="70%" title={<Text fw={600}>Logs: {id}</Text>}>
      {logs.error && <Text c="yellow" size="sm">{logs.error}</Text>}
      <ScrollArea h="calc(100vh - 90px)" viewportRef={viewport}
        onScrollPositionChange={({ y }) => {
          const v = viewport.current
          if (v) follow.current = y + v.clientHeight >= v.scrollHeight - 20
        }}>
        <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{logs.text || '(empty)'}</Code>
      </ScrollArea>
    </Drawer>
  )
}
