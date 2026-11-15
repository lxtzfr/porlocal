import { Button, Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconSkull } from '@tabler/icons-react'
import { useKill } from '../api'

/** Kills a process of Outside porlocal (the daemon refuses any other PID), after a confirmation. */
export function KillButton({ pid, name, checkout }: { pid: number; name: string; checkout: string }) {
  const kill = useKill()
  const confirm = () =>
    modals.openConfirmModal({
      title: `Kill PID ${pid}?`,
      children: <Text size="sm">{name} in {checkout}, and its whole process tree.</Text>,
      labels: { confirm: 'Kill', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => kill.mutate(pid),
    })
  return (
    <Button size="compact-xs" variant="light" color="red" leftSection={<IconSkull size={14} />} loading={kill.isPending} onClick={confirm}>
      kill
    </Button>
  )
}
