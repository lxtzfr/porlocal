import { Stack } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useDaemonState, useMachine } from '../api'
import { DevicesSection } from '../components/DevicesSection'
import { LeasesTable } from '../components/LeasesTable'
import { LogDrawer } from '../components/LogDrawer'
import { ProcessesTable } from '../components/ProcessesTable'
import { Empty, Section } from '../components/Section'
import { ZombiesTable } from '../components/ZombiesTable'

export const Route = createFileRoute('/')({ component: Dashboard })

function Dashboard() {
  const state = useDaemonState()
  const machine = useMachine()
  const [logId, setLogId] = useState<string | null>(null)
  const s = state.data
  const zombies = machine.data?.zombies
  return (
    <>
      <Stack gap="md">
        <Section title="Processes" count={s?.processes.length}>
          {s ? <ProcessesTable processes={s.processes} onLogs={setLogId} /> : <Empty>Loading…</Empty>}
        </Section>
        <Section title="Outside porlocal" count={zombies?.length}>
          {zombies ? <ZombiesTable zombies={zombies} /> : <Empty>{machine.isError ? machine.error.message : 'Loading…'}</Empty>}
        </Section>
        <Section title="Leased ports" count={s?.leases.length}>
          {s ? <LeasesTable leases={s.leases} /> : <Empty>Loading…</Empty>}
        </Section>
        <Section title="Devices">{s ? <DevicesSection state={s} /> : <Empty>Loading…</Empty>}</Section>
      </Stack>
      <LogDrawer id={logId} onClose={() => setLogId(null)} />
    </>
  )
}
