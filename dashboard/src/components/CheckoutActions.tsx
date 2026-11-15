import { ActionIcon, Code, Menu, Text, Tooltip } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconDots, IconGitMerge, IconPlayerEject, IconRefresh } from '@tabler/icons-react'
import type { Checkout } from '../../../src/api'
import { useCheckoutAction, type CheckoutAction } from '../api'

/** A stale link's fix, and a slot's end of ticket (its repo's `pnpm wt`), each after a confirmation when it moves git. */
export function CheckoutActions({ c }: { c: Checkout }) {
  const action = useCheckoutAction()
  const run = (a: CheckoutAction) => action.mutate({ action: a, path: c.path, label: c.label })
  const stale = c.uses.some((l) => l.status === 'stale')
  const confirm = (a: 'free' | 'done', title: string, what: string) =>
    modals.openConfirmModal({
      title,
      children: (
        <Text size="sm">
          {what} Runs <Code>pnpm wt {a} {c.label}</Code> in the main checkout.
        </Text>
      ),
      labels: { confirm: title, cancel: 'Cancel' },
      confirmProps: { color: a === 'done' ? 'grape' : 'blue' },
      onConfirm: () => run(a),
    })
  return (
    <>
      {stale && (
        <Tooltip label="Rewrite .env.local with the ports porlocal knows (restart what reads it)">
          <ActionIcon variant="subtle" color="red" size="sm" loading={action.isPending && action.variables?.action === 'env'} onClick={() => run('env')} aria-label="Rewrite .env.local">
            <IconRefresh size={16} stroke={1.6} />
          </ActionIcon>
        </Tooltip>
      )}
      {c.slot !== null && c.slot >= 2 && c.branch && (
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" size="sm" loading={action.isPending && action.variables?.action !== 'env'} aria-label="Slot actions">
              <IconDots size={16} stroke={1.6} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>{c.label} · {c.branch}</Menu.Label>
            <Menu.Item leftSection={<IconPlayerEject size={14} />} onClick={() => confirm('free', 'Free the slot', `${c.label} goes back to the default branch; ${c.branch} is kept, local and pushed.`)}>
              Free the slot
            </Menu.Item>
            <Menu.Item leftSection={<IconGitMerge size={14} />} onClick={() => confirm('done', 'Merge and free', `${c.branch} is merged (--no-ff) into the default branch and pushed, then deleted; ${c.label} is freed.`)}>
              Merge and free
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
    </>
  )
}
