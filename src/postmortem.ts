import type { Config } from './config.js'
import { sevLabel, strings } from './i18n.js'
import type { Incident } from './incident.js'
import { describe, serviceNames } from './render.js'
import { formatDateTime, formatDuration, localDay } from './time.js'

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'incident'

export function postmortemPath(inc: Incident, config: Config): string {
  return `${config.postmortemDir}/${localDay(inc.declaredAt, config.timezone)}-${inc.number}-${slug(inc.title)}.md`
}

export function renderPostmortem(inc: Incident, config: Config): string {
  const t = strings(config.lang)
  const p = t.postmortem
  const tz = config.timezone
  const when = (iso?: string) => (iso ? formatDateTime(iso, config.lang, tz) : '-')
  const start = inc.impactStart ?? inc.declaredAt
  const duration = inc.resolvedAt
    ? formatDuration(new Date(inc.resolvedAt).getTime() - new Date(start).getTime(), config.lang)
    : '-'
  const timeline = inc.timeline
    .map(
      (e) =>
        `| ${when(e.at)} | ${e.actor === 'GitHub' ? 'GitHub' : `@${e.actor}`} | ${describe(e, config, inc)
          .replace(/\s*\n\s*/g, ' ')
          .replace(/\|/g, '\\|')} |`,
    )
    .join('\n')

  return `# ${p.title(inc.number, inc.title)}

> ${p.intro}

| | |
| --- | --- |
| ${p.severity} | ${sevLabel(inc.severity, config.lang)} |
| ${p.services} | ${serviceNames(inc, config).join(', ') || '-'} |
| ${p.window} | ${when(start)} – ${when(inc.resolvedAt)} (${duration}) |
| ${p.detected} | ${when(inc.declaredAt)} |
| ${p.acknowledged} | ${when(inc.acknowledgedAt)} |
| ${p.resolved} | ${when(inc.resolvedAt)} |
| ${p.commander} | ${inc.commander ? `@${inc.commander}` : '-'} |
| ${p.participants} | ${inc.participants.map((u) => `@${u}`).join(', ')} |
| Issue | ${inc.url ?? `#${inc.number}`} |

## ${p.summary}

${inc.summary ?? 'TODO'}

## ${p.impact}

${p.todoImpact}

## ${p.timeline}

| ${p.time} (${tz}) | ${p.who} | ${p.what} |
| --- | --- | --- |
${timeline}

## ${p.rootCause}

${p.todoCause}

## ${p.wentWell}

- TODO

## ${p.wentWrong}

- TODO

## ${p.lucky}

- TODO

## ${p.actions}

${p.actionHead}
| --- | --- | --- | --- |
| TODO | @ | | |
`
}
