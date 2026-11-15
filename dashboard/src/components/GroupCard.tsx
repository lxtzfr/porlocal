import { ActionIcon, Anchor, Badge, Card, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core'
import { IconArrowLeft, IconArrowRight, IconBrandVscode, IconGitBranch } from '@tabler/icons-react'
import type { CheckoutLink, LinkStatus, PortHolder } from '../../../src/api'
import { groupOf, targetLabel, type CheckoutView, type GroupView, type ServiceRow } from '../../../src/projectView'
import { useNow } from '../api'
import { HIGHLIGHT_BG, useHighlighter, useIsHighlighted } from '../highlight'
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
const COLUMNS = ['Service', 'Port', 'Status', 'Owner', 'Up', '']

const holderName = (h: PortHolder | null) => (!h ? 'nothing' : h.kind === 'porlocal' ? `porlocal ${h.id}` : `${h.name} (PID ${h.pid})`)
const slotLabel = (slot: number | null) => (slot === 1 ? 'main' : slot ? `slot ${slot}` : 'outside slots')

function Branch({ name, issueUrl }: { name: string; issueUrl: string | null }) {
  return (
    <Group gap={4} wrap="nowrap">
      <IconGitBranch size={16} stroke={1.6} />
      <Text size="sm" ff="monospace">{name}</Text>
      {issueUrl && <Anchor href={issueUrl} target="_blank" rel="noopener" size="sm">#{issueUrl.split('/').pop()}</Anchor>}
    </Group>
  )
}

/** All the context a link badge needs: names, and the group it leaves. */
interface Ctx {
  all: GroupView[]
  views: CheckoutView[]
  group: GroupView
}

function LinkBadge({ l, ctx }: { l: CheckoutLink; ctx: Ctx }) {
  const outside = groupOf(ctx.all, l.workspace)
  const leaves = outside && outside.id !== ctx.group.group.id
  const hover = useHighlighter({ workspace: l.workspace, service: l.service })
  const tip = l.status === 'stale' ? `.env.local has ${l.written ?? 'nothing'}, should be ${l.expected}: porlocal run (or pnpm wt env) rewrites it` : LINK[l.status].tip
  return (
    <Tooltip label={leaves ? `${tip}. Points out of this group, at ${outside.label}: wanted, or a missing wt link?` : tip} multiline maw={420}>
      <Badge {...hover} style={{ cursor: 'default' }} color={l.status === 'ok' && leaves ? 'yellow' : LINK[l.status].color} variant="light" leftSection={<IconArrowRight size={12} />} tt="none">
        {l.key} {targetLabel(ctx.views, l.workspace, l.service)}{l.port ? ` :${l.port}` : ''}{l.status !== 'ok' ? ` (${l.status})` : ''}{leaves ? ` · ${outside.label}` : ''}
      </Badge>
    </Tooltip>
  )
}

function UsedByBadge({ u }: { u: CheckoutView['checkout']['usedBy'][number] }) {
  const hover = useHighlighter({ workspace: u.workspace })
  return (
    <Tooltip label={`${u.key} of ${u.workspace}: ${LINK[u.status].tip}`} multiline maw={420}>
      <Badge {...hover} style={{ cursor: 'default' }} color={LINK[u.status].color} variant="light" leftSection={<IconArrowLeft size={12} />} tt="none">
        used by {u.label} {u.key}{u.status !== 'ok' ? ` (${u.status})` : ''}
      </Badge>
    </Tooltip>
  )
}

function CheckoutHeader({ v, ctx }: { v: CheckoutView; ctx: Ctx }) {
  const c = v.checkout
  const g = ctx.group.group
  // Inside the group, `uses` already draws each link: only what comes from another group is worth a "used by".
  const usedBy = c.usedBy.filter((u) => !g.paths.includes(u.workspace))
  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          {g.kind !== 'solo' && <Text fw={700}>{c.repo}</Text>}
          {g.label === g.name && c.slot === 1 ? null : <Badge variant="outline" size="sm" color={c.slot === 1 ? 'blue' : 'grape'}>{slotLabel(c.slot)}</Badge>}
          {c.branch && c.branch !== g.branch && <Branch name={c.branch} issueUrl={c.issueUrl} />}
        </Group>
        <Group gap={4} wrap="nowrap">
          <Path value={c.path} max={360} />
          <Tooltip label="Open in VS Code">
            <ActionIcon component="a" href={`vscode://file/${c.path}`} variant="subtle" size="sm" aria-label="Open in VS Code">
              <IconBrandVscode size={16} stroke={1.6} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {(c.uses.length > 0 || usedBy.length > 0) && (
        <Group gap={6}>
          {c.uses.map((l) => <LinkBadge key={l.key + l.service} l={l} ctx={ctx} />)}
          {usedBy.map((u) => <UsedByBadge key={u.workspace + u.key} u={u} />)}
        </Group>
      )}
    </Stack>
  )
}

function PortCell({ r }: { r: ServiceRow }) {
  const conflict = r.portState?.status === 'conflict' ? r.portState : undefined
  return (
    <Group gap={6} wrap="nowrap">
      <PortLink port={r.port} />
      {conflict && (
        <Tooltip label={conflict.holder?.kind !== 'porlocal' ? conflict.holder?.cmd : undefined} disabled={!conflict.holder}>
          <Badge color="red" variant="light" size="sm" tt="none">taken by {holderName(conflict.holder)}</Badge>
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

/** The command line it was launched with, under its name: the full one on hover. */
function Command({ cmd }: { cmd: string }) {
  return (
    <Tooltip label={cmd} multiline maw={700} openDelay={300}>
      <Text size="xs" c="dimmed" ff="monospace" truncate maw={340}>{cmd}</Text>
    </Tooltip>
  )
}

function ServiceRowView({ workspace, r, now, onLogs }: { workspace: string; r: ServiceRow; now: number; onLogs: (id: string) => void }) {
  const lit = useIsHighlighted(workspace, r.service)
  return (
    <Table.Tr bg={lit ? HIGHLIGHT_BG : undefined} style={{ transition: 'background-color 120ms' }}>
      <Table.Td>
        <Text fw={600} size="sm">{r.service}</Text>
        {r.process && <Command cmd={r.process.cmd} />}
      </Table.Td>
      <Table.Td><PortCell r={r} /></Table.Td>
      <Table.Td><ServiceStatus r={r} /></Table.Td>
      <Table.Td>{r.process && <Owner p={r.process} now={now} />}</Table.Td>
      <Table.Td><Text size="sm">{r.process && isRunning(r.process.status) ? ago(r.process.startedAt, now) : ''}</Text></Table.Td>
      <Table.Td>{r.process && <ProcessActions p={r.process} onLogs={onLogs} />}</Table.Td>
    </Table.Tr>
  )
}

function CheckoutRows({ v, ctx, now, onLogs }: { v: CheckoutView; ctx: Ctx; now: number; onLogs: (id: string) => void }) {
  const headerLit = useIsHighlighted(v.checkout.path)
  return (
    <>
      <Table.Tr bg={headerLit ? HIGHLIGHT_BG : 'var(--mantine-color-default-hover)'}>
        <Table.Td colSpan={COLUMNS.length}><CheckoutHeader v={v} ctx={ctx} /></Table.Td>
      </Table.Tr>
      {!v.services.length && !v.hand.length && (
        <Table.Tr>
          <Table.Td colSpan={COLUMNS.length}><Text size="sm" c="dimmed">Nothing running here.</Text></Table.Td>
        </Table.Tr>
      )}
      {v.services.map((r) => <ServiceRowView key={r.service} workspace={v.checkout.path} r={r} now={now} onLogs={onLogs} />)}
      {v.hand.map((z) => (
        <Table.Tr key={z.pid}>
          <Table.Td>
            <Text size="sm">{z.name}</Text>
            <Command cmd={z.cmd} />
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
    </>
  )
}

/** A group of linked checkouts (a project's main checkouts, a ticket's slots): one table, a header row per checkout. */
export function GroupCard({ group, all, onLogs }: { group: GroupView; all: GroupView[]; onLogs: (id: string) => void }) {
  const now = useNow()
  const ctx: Ctx = { all, views: all.flatMap((g) => g.checkouts), group }
  const g = group.group
  return (
    <Card withBorder radius="md" padding="md">
      <Group gap="sm" mb="xs">
        <Title order={2} size="h4">{g.label}</Title>
        {g.workspace && (
          <Tooltip label={`Umbrella project: its repos live in the workspace repo ${g.workspace}`} multiline maw={420}>
            <Badge variant="outline" color="gray" size="sm">workspace</Badge>
          </Tooltip>
        )}
        {g.branch && <Branch name={g.branch} issueUrl={g.issueUrl} />}
      </Group>
      <Table.ScrollContainer minWidth={800}>
        <Table verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>{COLUMNS.map((h) => <Table.Th key={h}>{h}</Table.Th>)}</Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {group.checkouts.map((v) => <CheckoutRows key={v.checkout.path} v={v} ctx={ctx} now={now} onLogs={onLogs} />)}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  )
}
