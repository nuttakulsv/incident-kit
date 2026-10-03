import type { Config } from './config.js'
import { BLOCK_END, BLOCK_START, stripStatusBlock } from './form.js'
import { sevLabel, strings } from './i18n.js'
import { snapshot, snapshotComment, type Incident, type TimelineEntry } from './incident.js'
import { formatDateTime, formatDuration, formatTime, localDay } from './time.js'

const ALERT = { 1: 'CAUTION', 2: 'WARNING', 3: 'IMPORTANT', 4: 'NOTE' } as const

export const serviceNames = (inc: Incident, config: Config) =>
  inc.services.map((id) => config.services.find((s) => s.id === id)?.name ?? id)

/** One line per timeline entry, e.g. "14:05 @alice changed the status to Identified". */
export function describe(e: TimelineEntry, config: Config, inc?: Incident): string {
  const t = strings(config.lang)
  switch (e.kind) {
    case 'declared':
      return t.timeline.declared(sevLabel(e.level ?? inc?.severity ?? 3, config.lang))
    case 'status':
      return t.timeline.status(t.state[e.state!])
    case 'severity':
      return t.timeline.severity(sevLabel(e.level!, config.lang))
    case 'update':
      return `${t.timeline.update}: ${e.text}`
    case 'note':
      return `${t.timeline.note}: ${e.text}`
    case 'title':
      return `${t.timeline.title}: ${e.text}`
    case 'services':
      return `${t.timeline.services}: ${e.text}`
    case 'assign':
      return t.timeline.assign(e.text!)
    case 'link':
      return `${t.timeline.link}: ${e.text}`
    case 'ack':
      return t.timeline.ack
  }
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')

/** The block the Action keeps at the top of the incident issue. */
export function statusBlock(inc: Incident, config: Config, now: Date): string {
  const t = strings(config.lang)
  const b = t.block
  const tz = config.timezone
  const when = (iso: string) => formatDateTime(iso, config.lang, tz)
  const since = (iso: string) =>
    formatDuration(new Date(iso).getTime() - new Date(inc.declaredAt).getTime(), config.lang)
  const end = inc.resolvedAt ? new Date(inc.resolvedAt) : now
  const duration = formatDuration(end.getTime() - new Date(inc.impactStart ?? inc.declaredAt).getTime(), config.lang)

  const head = `**${sevLabel(inc.severity, config.lang)} · ${t.state[inc.state]}**${inc.commander ? ` · ${b.commander} @${inc.commander}` : ''}`
  const rows: [string, string][] = [
    [b.services, serviceNames(inc, config).join(', ') || b.none],
    [b.declared, `${when(inc.declaredAt)} (${tz})`],
  ]
  if (inc.impactStart) rows.push([b.impact, when(inc.impactStart)])
  rows.push([
    b.acknowledged,
    inc.acknowledgedAt ? `${when(inc.acknowledgedAt)} (${b.after} ${since(inc.acknowledgedAt)})` : b.notYet,
  ])
  rows.push([b.resolved, inc.resolvedAt ? when(inc.resolvedAt) : b.notYet])
  rows.push([
    b.duration,
    inc.resolvedAt ? duration : `${duration} (${b.ongoing}, ${b.asOf} ${formatTime(now, config.lang, tz)})`,
  ])
  rows.push([b.lastUpdate, when(inc.lastPublicUpdateAt)])

  const sameDay = inc.timeline.every((e) => localDay(e.at, tz) === localDay(inc.declaredAt, tz))
  const stamp = (iso: string) => (sameDay ? formatTime(iso, config.lang, tz) : when(iso))
  const timeline = inc.timeline
    .map(
      (e) =>
        `| ${stamp(e.at)} | ${e.actor === 'GitHub' ? 'GitHub' : `@${e.actor}`} | ${oneLine(describe(e, config, inc))} |`,
    )
    .join('\n')

  return [
    BLOCK_START,
    snapshotComment(snapshot(inc)),
    `> [!${inc.state === 'resolved' ? 'TIP' : ALERT[inc.severity]}]`,
    `> ${head}`,
    ...(inc.unconfirmed ? ['>', `> ${b.unconfirmed}`] : []),
    '',
    '| | |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    ...(inc.links.length
      ? [`| ${b.links} | ${inc.links.map((l) => `[${l.title ?? l.url}](${l.url})`).join(' · ')} |`]
      : []),
    '',
    `**${b.timeline}**`,
    '',
    `| | | |`,
    `| --- | --- | --- |`,
    timeline,
    '',
    `<sub>${b.commands}</sub>`,
    BLOCK_END,
  ].join('\n')
}

export function withStatusBlock(body: string, block: string): string {
  const rest = stripStatusBlock(body)
  return `${block}\n\n---\n\n${rest}`.trimEnd() + '\n'
}
