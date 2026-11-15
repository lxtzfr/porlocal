import { Stack } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useDaemonState, useMachine } from '../api'
import { projectView } from '../../../src/projectView'
import { Cmd } from '../components/cells'
import { GroupCard } from '../components/GroupCard'
import { DevicesSection } from '../components/DevicesSection'
import { LogDrawer } from '../components/LogDrawer'
import { Empty, Section } from '../components/Section'

export const Route = createFileRoute('/')({ component: Dashboard })

function Dashboard() {
  const state = useDaemonState()
  const machine = useMachine()
  const [logId, setLogId] = useState<string | null>(null)
  const s = state.data
  const groups = s ? projectView(s, machine.data) : []
  return (
    <>
      <Stack gap="md">
        {!s ? (
          <Empty>Loading…</Empty>
        ) : groups.length ? (
          groups.map((g) => <GroupCard key={g.group.id} group={g} all={groups} onLogs={setLogId} />)
        ) : (
          <Section title="Checkouts">
            <Empty>Nothing known yet: <Cmd>porlocal run &lt;service&gt;</Cmd> in a checkout.</Empty>
          </Section>
        )}
        {machine.isError && <Empty>Machine view unavailable: {machine.error.message}</Empty>}
        {s && <Section title="Devices">{<DevicesSection state={s} />}</Section>}
      </Stack>
      <LogDrawer id={logId} onClose={() => setLogId(null)} />
    </>
  )
}
