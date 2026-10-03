import type { Config, Level } from './config.js'
import { sevLabel, strings } from './i18n.js'
import type { Incident } from './incident.js'
import { serviceNames } from './render.js'
import { formatDate, formatDuration, localDay } from './time.js'

export interface Report {
  from: string
  to: string
  total: number
  open: number
  mttaMinutes?: number
  medianTtaMinutes?: number
  mttrMinutes?: number
  medianTtrMinutes?: number
  bySeverity: Record<Level, number>
  byService: Record<string, number>
  byMonth: Record<string, number>
  incidents: {
    number: number
    title: string
    severity: Level
    state: string
    declaredAt: string
    ttrMinutes?: number
  }[]
}

const minutes = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60000
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined)
const median = (xs: number[]) => {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1]! + s[mid]!) / 2
}

/** MTTA and MTTR are measured from the moment the incident was declared. Unconfirmed reports are left out. */
export function buildReport(all: Incident[], config: Config, from: Date, to: Date): Report {
  const list = all
    .filter((i) => !i.unconfirmed && new Date(i.declaredAt) >= from && new Date(i.declaredAt) < to)
    .sort((a, b) => a.declaredAt.localeCompare(b.declaredAt))
  const tta = list.filter((i) => i.acknowledgedAt).map((i) => minutes(i.declaredAt, i.acknowledgedAt!))
  const ttr = list.filter((i) => i.resolvedAt).map((i) => minutes(i.declaredAt, i.resolvedAt!))
  const count = <K extends string | number>(keys: K[]) =>
    keys.reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {} as Record<K, number>)
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    total: list.length,
    open: list.filter((i) => i.state !== 'resolved').length,
    mttaMinutes: mean(tta),
    medianTtaMinutes: median(tta),
    mttrMinutes: mean(ttr),
    medianTtrMinutes: median(ttr),
    bySeverity: Object.assign({ 1: 0, 2: 0, 3: 0, 4: 0 }, count(list.map((i) => i.severity))),
    byService: count(list.flatMap((i) => serviceNames(i, config))),
    byMonth: count(list.map((i) => localDay(i.declaredAt, config.timezone).slice(0, 7))),
    incidents: list.map((i) => ({
      number: i.number,
      title: i.title,
      severity: i.severity,
      state: i.state,
      declaredAt: i.declaredAt,
      ttrMinutes: i.resolvedAt ? minutes(i.declaredAt, i.resolvedAt) : undefined,
    })),
  }
}

export function reportMarkdown(r: Report, config: Config): string {
  const t = strings(config.lang)
  const R = t.report
  const d = (m?: number) => (m === undefined ? '-' : formatDuration(m * 60000, config.lang))
  const day = (iso: string) => formatDate(iso, config.lang, config.timezone)
  const table = (head: string, rows: [string, number][]) =>
    rows.length
      ? `| ${head} | ${R.total} |\n| --- | ---: |\n${rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n`
      : ''
  if (r.total === 0) return `## ${R.title}\n\n${R.period}: ${day(r.from)} – ${day(r.to)}\n\n${R.none}\n`
  return `## ${R.title}

${R.period}: ${day(r.from)} – ${day(r.to)}

| | |
| --- | --- |
| ${R.total} | ${r.total}${r.open ? ` (${r.open} ${R.open})` : ''} |
| ${R.mtta} | ${d(r.mttaMinutes)} (${R.median} ${d(r.medianTtaMinutes)}) |
| ${R.mttr} | ${d(r.mttrMinutes)} (${R.median} ${d(r.medianTtrMinutes)}) |

### ${R.bySeverity}

${table(
  'SEV',
  ([1, 2, 3, 4] as Level[]).map((l) => [sevLabel(l, config.lang), r.bySeverity[l]]),
)}
### ${R.byService}

${table(
  t.block.services,
  Object.entries(r.byService).sort((a, b) => b[1] - a[1]),
)}
### ${R.byMonth}

${table(R.month, Object.entries(r.byMonth).sort())}
### ${R.list}

| # | | SEV | ${t.block.declared} | ${t.block.duration} |
| --- | --- | --- | --- | --- |
${r.incidents.map((i) => `| #${i.number} | ${i.title.replace(/\|/g, '\\|')} | ${i.severity} | ${day(i.declaredAt)} | ${i.ttrMinutes === undefined ? R.open : d(i.ttrMinutes)} |`).join('\n')}
`
}
