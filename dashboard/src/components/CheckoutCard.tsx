import { ActionIcon, Anchor, Badge, Card, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconArrowLeft, IconArrowRight, IconBrandVscode, IconGitBranch } from '@tabler/icons-react'
import type { CheckoutLink, LinkStatus, PortHolder } from '../../../src/api'
import { useNow } from '../api'
import { targetLabel, type CheckoutGroup, type ServiceRow } from '../../../src/checkoutGroups'
import { ago, isRunning } from '../format'
import { Path, PortLink } from './cells'
import { KillButton } from './KillButton'
import { Owner, ProcessActions, STATUS_COLOR } from './ProcessActions'

const LINK: Record<LinkStatus, { color: string; tip: string }> = {
  ok: { color: 'teal', tip: 'Its target listens, .env.local points at it' },
  down: { color: 'gray', tip: 'Nothing listens on its target' },
  stale: { color: 'red', tip: '.env.local points elsewhere: porlocal run (or pnpm wt env) rewrites it' },
  unresolved: { color: 'yellow', tip: 'No port known for its target: not declared, never leased' },
}

const holderName = (h: PortHolder | null) => (!h ? 'nothing' : h.kind === 'porlocal' ? `porlocal ${h.id}` : `${h.name} (PID ${h.pid})`)

function slotLabel(slot: number | null) {
  return slot === 1 ? 'main' : slot ? `slot ${slot}` : 'outside slots'
}

function Header({ g }: { g: CheckoutGroup }) {
  const c = g.checkout
  return (
    <Group justify="space-between" wrap="nowrap" mb="xs">
      <Group gap="sm" wrap="nowrap">
        <Title order={2} size="h4">{c.repo}</Title>
        <Badge variant="outline" color={c.slot === 1 ? 'blue' : 'grape'}>{slotLabel(c.slot)}</Badge>
        {c.branch && (
          <Group gap={4} wrap="nowrap">
            <IconGitBranch size={16} stroke={1.6} />
            <Text size="sm" ff="monospace">{c.branch}</Text>
          </Group>
        )}
        {c.issueUrl && (
          <Anchor href={c.issueUrl} target="_blank" rel="noopener" size="sm">#{c.issueUrl.split('/').pop()}</Anchor>
        )}
      </Group>
      <Group gap={4} wrap="nowrap">
        <Path value={c.path} max={360} />
        <Tooltip label="Open in VS Code">
          <ActionIcon component="a" href={`vscode://file/${c.path}`} variant="subtle" aria-label="Open in VS Code">
            <IconBrandVscode size={18} stroke={1.6} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  )
}

function LinkBadge({ l, groups }: { l: CheckoutLink; groups: CheckoutGroup[] }) {
  const tip = l.status === 'stale' ? `.env.local has ${l.written ?? 'nothing'}, should be ${l.expected}: porlocal run (or pnpm wt env) rewrites it` : LINK[l.status].tip
  return (
    <Tooltip label={tip} multiline maw={420}>
      <Badge color={LINK[l.status].color} variant="light" leftSection={<IconArrowRight size={12} />} tt="none">
        {l.key} {targetLabel(groups, l.workspace, l.service)}{l.port ? ` :${l.port}` : ''}{l.status !== 'ok' ? ` (${l.status})` : ''}
      </Badge>
    </Tooltip>
  )
}

function Links({ g, groups }: { g: CheckoutGroup; groups: CheckoutGroup[] }) {
  const { uses, usedBy } = g.checkout
  if (!uses.length && !usedBy.length) return null
  return (
    <Stack gap={4} mb="xs">
      {uses.length > 0 && (
        <Group gap={6}>
          <Text size="xs" c="dimmed" w={56}>uses</Text>
          {uses.map((l) => <LinkBadge key={l.key + l.service} l={l} groups={groups} />)}
        </Group>
      )}
      {usedBy.length > 0 && (
        <Group gap={6}>
          <Text size="xs" c="dimmed" w={56}>used by</Text>
          {usedBy.map((u) => (
            <Tooltip key={u.workspace + u.key} label={`${u.key} of ${u.workspace}: ${LINK[u.status].tip}`} multiline maw={420}>
              <Badge color={LINK[u.status].color} variant="light" leftSection={<IconArrowLeft size={12} />} tt="none">
                {u.label} {u.key}{u.status !== 'ok' ? ` (${u.status})` : ''}
              </Badge>
            </Tooltip>
          ))}
        </Group>
      )}
    </Stack>
  )
}

function PortCell({ r }: { r: ServiceRow }) {
  const conflict = r.portState?.status === 'conflict'
  return (
    <Group gap={6} wrap="nowrap">
      <PortLink port={r.port} />
      {conflict && (
        <Tooltip label={r.portState!.holder?.kind !== 'porlocal' ? r.portState!.holder?.cmd : undefined} disabled={!r.portState!.holder}>
          <Badge color="red" variant="light" size="sm" tt="none">taken by {holderName(r.portState!.holder)}</Badge>
        </Tooltip>
      )}
      {r.moved && (
        <Tooltip label={`Its declared port ${r.moved.port} is held by ${holderName(r.moved.holder)}`}>
          <Badge color="yellow" variant="light" size="sm" tt="none">moved from {r.moved.port}</Badge>
        </Tooltip>
      )}
    </Group>
  )
}

function ServiceStatus({ r }: { r: ServiceRow }) {
  const p = r.process
  if (!p) {
    const hand = r.portState?.status === 'hand'
    return <Badge color={hand ? 'orange' : 'gray'} variant="light">{hand ? 'started by hand' : 'not running'}</Badge>
  }
  return (
    <Group gap={6} wrap="nowrap">
      <Badge color={STATUS_COLOR[p.status]} variant="light">{p.status}{p.status === 'exited' && p.exitCode != null ? ` ${p.exitCode}` : ''}</Badge>
      {p.status === 'stopped' && p.stopReason && <Text size="xs" c="dimmed">{p.stopReason}</Text>}
    </Group>
  )
}

export function CheckoutCard({ g, groups, onLogs }: { g: CheckoutGroup; groups: CheckoutGroup[]; onLogs: (id: string) => void }) {
  const now = useNow()
  const empty = !g.services.length && !g.hand.length
  return (
    <Card withBorder radius="md" padding="md">
      <Header g={g} />
      <Links g={g} groups={groups} />
      {empty ? (
        <Text size="sm" c="dimmed">Nothing running here.</Text>
      ) : (
        <Table.ScrollContainer minWidth={800}>
          <Table highlightOnHover verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                {['Service', 'Port', 'Status', 'Owner', 'Up', ''].map((h) => <Table.Th key={h}>{h}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {g.services.map((r) => (
                <Table.Tr key={r.service}>
                  <Table.Td><Text fw={600} size="sm">{r.service}</Text></Table.Td>
                  <Table.Td><PortCell r={r} /></Table.Td>
                  <Table.Td><ServiceStatus r={r} /></Table.Td>
                  <Table.Td>{r.process && <Owner p={r.process} now={now} />}</Table.Td>
                  <Table.Td><Text size="sm">{r.process && isRunning(r.process.status) ? ago(r.process.startedAt, now) : ''}</Text></Table.Td>
                  <Table.Td>{r.process && <ProcessActions p={r.process} onLogs={onLogs} />}</Table.Td>
                </Table.Tr>
              ))}
              {g.hand.map((z) => (
                <Table.Tr key={z.pid}>
                  <Table.Td>
                    <Tooltip label={z.cmd} multiline maw={600} openDelay={300}>
                      <Text size="sm" truncate maw={220}>{z.name}</Text>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6}>{z.ports.length ? z.ports.map((p) => <PortLink key={p} port={p} />) : <Text size="sm" c="dimmed">-</Text>}</Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Badge color="orange" variant="light">started by hand</Badge>
                      {z.orphan && (
                        <Tooltip label="Its parent is gone">
                          <Badge color="yellow" variant="light" size="sm">orphan</Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td><Text size="xs" c="dimmed">PID {z.pid}</Text></Table.Td>
                  <Table.Td />
                  <Table.Td><Group justify="flex-end"><KillButton pid={z.pid} name={z.name} checkout={z.checkout} /></Group></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  )
}
