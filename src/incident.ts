import { parseCommands } from './commands.js'
import type { Config, Level, State } from './config.js'
import { parseForm, type FormFields } from './form.js'
import { onCallAt } from './oncall.js'
import { strings } from './i18n.js'
import { parseLocal } from './time.js'

export interface CommentData {
  id: number
  body: string
  user: string
  association: string
  createdAt: string
  bot?: boolean
}

export interface IssueData {
  number: number
  title: string
  body: string
  user: string
  association: string
  createdAt: string
  closedAt?: string | null
  state: 'open' | 'closed'
  labels: string[]
  url?: string
  bot?: boolean
  comments: CommentData[]
}

export type TimelineKind =
  'declared' | 'status' | 'severity' | 'update' | 'note' | 'title' | 'services' | 'assign' | 'link' | 'ack'

export interface TimelineEntry {
  at: string
  actor: string
  kind: TimelineKind
  text?: string
  state?: State
  level?: Level
}

export interface PublicUpdate {
  at: string
  state: State
  text?: string
}

export interface Incident {
  number: number
  title: string
  publicTitle: string
  url?: string
  severity: Level
  services: string[]
  state: State
  /** Declared by someone outside the team and nobody on the team has responded yet. */
  unconfirmed: boolean
  commander?: string
  declaredBy: string
  declaredAt: string
  impactStart?: string
  acknowledgedAt?: string
  resolvedAt?: string
  summary?: string
  updates: PublicUpdate[]
  timeline: TimelineEntry[]
  links: { url: string; title?: string }[]
  participants: string[]
  lastPublicUpdateAt: string
}

const TEAM = ['OWNER', 'MEMBER', 'COLLABORATOR']
export const EVENT_MARKER = /<!-- incident-kit:event (closed|reopened) -->/

/** Can this person run commands? Bots and automation are trusted to declare, but only people acknowledge. */
export const isTeam = (association: string) => TEAM.includes(association)

/**
 * Builds the current state of an incident from the issue and its comments. Everything is derived, nothing is stored,
 * so re-running is always safe.
 */
export function buildIncident(issue: IssueData, config: Config): Incident {
  const declaredAt = issue.createdAt
  const trustedDeclarer = isTeam(issue.association) || Boolean(issue.bot)
  // Whoever opened the issue can keep editing it, so an outside report's form fields never reach the status page.
  const form: FormFields = trustedDeclarer ? parseForm(issue.body, config.services) : { services: [] }
  const humanDeclarer = isTeam(issue.association) && !issue.bot
  const labelLevel = Number(issue.labels.find((l) => /^sev[1-4]$/i.test(l))?.slice(3))
  const title = issue.title.replace(/^\[[^\]]*\]\s*/, '') || issue.title
  const inc: Incident = {
    number: issue.number,
    title,
    publicTitle: trustedDeclarer ? (form.publicTitle ?? title) : strings(config.lang).defaultTitle,
    url: issue.url,
    severity: (form.severity ?? (trustedDeclarer && labelLevel ? labelLevel : 3)) as Level,
    services: form.services,
    state: 'investigating',
    unconfirmed: !trustedDeclarer,
    commander: config.oncall ? onCallAt(config.oncall, new Date(declaredAt), config.timezone) : undefined,
    declaredBy: issue.user,
    declaredAt,
    impactStart: form.impactStart ? parseLocal(form.impactStart, config.timezone)?.toISOString() : undefined,
    acknowledgedAt: undefined,
    summary: form.summary,
    updates: [],
    timeline: [{ at: declaredAt, actor: issue.user, kind: 'declared', level: undefined }],
    links: [],
    participants: [issue.user],
    lastPublicUpdateAt: declaredAt,
  }
  inc.timeline[0]!.level = inc.severity
  if (!inc.commander && humanDeclarer) inc.commander = issue.user
  // The person on call declaring it themselves has acknowledged it. Anyone else's report waits for a team response.
  if (humanDeclarer && inc.commander === issue.user) inc.acknowledgedAt = declaredAt
  if (!inc.unconfirmed) inc.updates.push({ at: declaredAt, state: 'investigating' })

  const comments = [...issue.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
  for (const c of comments) {
    if (c.bot) {
      const event = EVENT_MARKER.exec(c.body)?.[1]
      if (event) setState(inc, event === 'closed' ? 'resolved' : 'investigating', c.createdAt, 'GitHub', true)
      continue
    }
    if (!inc.participants.includes(c.user)) inc.participants.push(c.user)
    if (!isTeam(c.association)) continue
    const { commands } = parseCommands(c.body)
    // State and severity first, so "/update ..." above "/status identified" in one comment is published as identified.
    const rank = (k: string) => (k === 'status' || k === 'sev' ? 0 : 1)
    const acting = commands.filter((x) => x.kind !== 'help').sort((a, b) => rank(a.kind) - rank(b.kind))
    if (acting.length === 0) continue
    if (inc.unconfirmed) {
      inc.unconfirmed = false
      inc.updates.push({ at: c.createdAt, state: inc.state })
    }
    inc.acknowledgedAt ??= c.createdAt
    if (!inc.commander) inc.commander = c.user

    const hasUpdate = acting.some((x) => x.kind === 'update')
    for (const cmd of acting) {
      const at = c.createdAt
      switch (cmd.kind) {
        case 'status':
          setState(inc, cmd.state, at, c.user, !hasUpdate)
          break
        case 'sev':
          if (cmd.level !== inc.severity) {
            inc.severity = cmd.level
            inc.timeline.push({ at, actor: c.user, kind: 'severity', level: cmd.level })
          }
          break
        case 'update':
          inc.updates.push({ at, state: inc.state, text: cmd.text })
          inc.lastPublicUpdateAt = at
          inc.timeline.push({ at, actor: c.user, kind: 'update', text: cmd.text })
          break
        case 'note':
          inc.timeline.push({ at, actor: c.user, kind: 'note', text: cmd.text })
          break
        case 'title':
          inc.publicTitle = cmd.text
          inc.timeline.push({ at, actor: c.user, kind: 'title', text: cmd.text })
          break
        case 'services': {
          const known = cmd.ids.filter((id) => config.services.some((s) => s.id === id))
          if (known.length) {
            inc.services = known
            inc.timeline.push({ at, actor: c.user, kind: 'services', text: known.join(', ') })
          }
          break
        }
        case 'assign':
          inc.commander = cmd.user
          inc.timeline.push({ at, actor: c.user, kind: 'assign', text: cmd.user })
          break
        case 'link':
          inc.links.push({ url: cmd.url, title: cmd.title })
          inc.timeline.push({ at, actor: c.user, kind: 'link', text: cmd.title ? `${cmd.title} ${cmd.url}` : cmd.url })
          break
        case 'ack':
          inc.timeline.push({ at, actor: c.user, kind: 'ack' })
          break
      }
    }
  }

  // Closed on GitHub without /status resolved, before the Action got to it.
  if (issue.state === 'closed' && inc.state !== 'resolved' && issue.closedAt) {
    setState(inc, 'resolved', issue.closedAt, 'GitHub', true)
  }
  if (inc.commander && !inc.participants.includes(inc.commander)) inc.participants.push(inc.commander)
  return inc
}

function setState(inc: Incident, state: State, at: string, actor: string, publish: boolean) {
  if (state === inc.state) return
  inc.state = state
  inc.resolvedAt = state === 'resolved' ? at : undefined
  inc.timeline.push({ at, actor, kind: 'status', state })
  if (publish && !inc.unconfirmed) {
    inc.updates.push({ at, state })
    inc.lastPublicUpdateAt = at
  }
}

export const isPublic = (inc: Incident, config: Config) => !inc.unconfirmed && config.public.includes(inc.severity)

/** What the status block last published. Comparing against it makes every run idempotent, even after skipped runs. */
export interface Snapshot {
  state: State
  severity: Level
  updates: number
  unconfirmed: boolean
}

export const snapshot = (inc: Incident): Snapshot => ({
  state: inc.state,
  severity: inc.severity,
  updates: inc.updates.length,
  unconfirmed: inc.unconfirmed,
})

const SNAPSHOT = /<!-- incident-kit:state (\{.*?\}) -->/

export const snapshotComment = (s: Snapshot) => `<!-- incident-kit:state ${JSON.stringify(s)} -->`

export function readSnapshot(body: string): Snapshot | undefined {
  const m = SNAPSHOT.exec(body)
  if (!m) return undefined
  try {
    return JSON.parse(m[1]!) as Snapshot
  } catch {
    return undefined
  }
}
