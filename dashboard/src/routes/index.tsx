import { Stack } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useDaemonState, useMachine } from '../api'
import { checkoutGroups } from '../../../src/checkoutGroups'
import { Cmd } from '../components/cells'
import { CheckoutCard } from '../components/CheckoutCard'
import { DevicesSection } from '../components/DevicesSection'
import { LogDrawer } from '../components/LogDrawer'
import { Empty, Section } from '../components/Section'

export const Route = createFileRoute('/')({ component: Dashboard })

function Dashboard() {
  const state = useDaemonState()
  const machine = useMachine()
  const [logId, setLogId] = useState<string | null>(null)
  const s = state.data
  const groups = s ? checkoutGroups(s, machine.data) : []
  return (
    <>
      <Stack gap="md">
        {!s ? (
          <Empty>Loading…</Empty>
        ) : groups.length ? (
          groups.map((g) => <CheckoutCard key={g.checkout.path} g={g} groups={groups} onLogs={setLogId} />)
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
