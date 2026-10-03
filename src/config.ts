import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

export type Lang = 'en' | 'th'
export type State = 'investigating' | 'identified' | 'monitoring' | 'resolved'
export type Level = 1 | 2 | 3 | 4
export type EventKind = 'declared' | 'severity' | 'status' | 'update' | 'resolved'

export const STATES: State[] = ['investigating', 'identified', 'monitoring', 'resolved']
export const EVENTS: EventKind[] = ['declared', 'severity', 'status', 'update', 'resolved']

export interface Service {
  id: string
  name: string
  description?: string
}

export interface Override {
  user: string
  from: string
  to: string
}

export interface OnCall {
  rotation: string[]
  start: string
  handoff: string
  overrides: Override[]
}

export interface Notification {
  type: 'slack' | 'discord' | 'teams' | 'line' | 'webhook'
  /** Name of the environment variable that holds the webhook URL (slack, discord, teams, webhook). */
  webhook?: string
  /** LINE: environment variable names for the channel access token and the user, group or room id. */
  token?: string
  to?: string
  severities: Level[]
  events: EventKind[]
}

export interface Config {
  title: string
  description?: string
  url?: string
  lang: Lang
  timezone: string
  label: string
  services: Service[]
  reminders: Partial<Record<Level, number>>
  public: Level[]
  postmortem: Level[]
  postmortemDir: string
  oncall?: OnCall
  notifications: Notification[]
}

export const CONFIG_FILE = 'incident-kit.yml'

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid ${CONFIG_FILE}:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  }
}

export function loadConfig(root: string, file = CONFIG_FILE): Config {
  const path = join(root, file)
  if (!existsSync(path)) throw new ConfigError([`${file} not found in ${root}`])
  return parseConfig(readFileSync(path, 'utf8'))
}

export function parseConfig(text: string): Config {
  const raw = (parse(text) ?? {}) as Record<string, unknown>
  const problems: string[] = []
  const str = (v: unknown, path: string, required = false): string | undefined => {
    if (v === undefined || v === null || v === '') {
      if (required) problems.push(`${path} is required`)
      return undefined
    }
    if (typeof v !== 'string' && typeof v !== 'number') {
      problems.push(`${path} must be a string`)
      return undefined
    }
    return String(v)
  }
  const levels = (v: unknown, path: string, fallback: Level[]): Level[] => {
    if (v === undefined) return fallback
    if (!Array.isArray(v) || v.some((n) => ![1, 2, 3, 4].includes(Number(n)))) {
      problems.push(`${path} must be a list of severities between 1 and 4`)
      return fallback
    }
    return v.map(Number) as Level[]
  }

  const lang = str(raw.lang, 'lang') ?? 'en'
  if (lang !== 'en' && lang !== 'th') problems.push('lang must be en or th')

  const timezone = str(raw.timezone, 'timezone') ?? 'Asia/Bangkok'
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    problems.push(`timezone "${timezone}" is not a known IANA time zone`)
  }

  const services: Service[] = []
  if (!Array.isArray(raw.services) || raw.services.length === 0) problems.push('services needs at least one service')
  for (const [i, s] of (Array.isArray(raw.services) ? raw.services : []).entries()) {
    const item = (s ?? {}) as Record<string, unknown>
    const id = str(item.id, `services[${i}].id`, true)
    const name = str(item.name, `services[${i}].name`) ?? id
    if (id && !/^[a-z0-9][a-z0-9-]*$/.test(id)) problems.push(`services[${i}].id "${id}" may only use a-z, 0-9 and -`)
    if (id && services.some((x) => x.id === id)) problems.push(`services[${i}].id "${id}" is used twice`)
    if (id && name) services.push({ id, name, description: str(item.description, `services[${i}].description`) })
  }

  const severity = (raw.severity ?? {}) as Record<string, unknown>
  const reminders: Partial<Record<Level, number>> = {}
  for (const [k, v] of Object.entries((severity.reminders ?? { 1: 15, 2: 30 }) as Record<string, unknown>)) {
    const level = Number(k)
    if (![1, 2, 3, 4].includes(level) || !(Number(v) > 0)) {
      problems.push(`severity.reminders.${k} must map a severity (1-4) to minutes`)
      continue
    }
    reminders[level as Level] = Number(v)
  }

  let oncall: OnCall | undefined
  if (raw.oncall) {
    const o = raw.oncall as Record<string, unknown>
    const rotation = Array.isArray(o.rotation) ? o.rotation.map((u) => String(u).replace(/^@/, '')) : []
    if (rotation.length === 0) problems.push('oncall.rotation needs at least one GitHub username')
    const start = str(o.start, 'oncall.start', true) ?? ''
    if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) problems.push('oncall.start must be a date like 2026-01-05')
    const handoff = str(o.handoff, 'oncall.handoff') ?? '10:00'
    if (!/^\d{1,2}:\d{2}$/.test(handoff)) problems.push('oncall.handoff must be a time like 10:00')
    const overrides: Override[] = []
    for (const [i, ov] of (Array.isArray(o.overrides) ? o.overrides : []).entries()) {
      const item = (ov ?? {}) as Record<string, unknown>
      const user = str(item.user, `oncall.overrides[${i}].user`, true)
      const from = str(item.from, `oncall.overrides[${i}].from`, true)
      const to = str(item.to, `oncall.overrides[${i}].to`, true)
      if (user && from && to) overrides.push({ user: user.replace(/^@/, ''), from, to })
    }
    oncall = { rotation, start, handoff, overrides }
  }

  const notifications: Notification[] = []
  for (const [i, n] of (Array.isArray(raw.notifications) ? raw.notifications : []).entries()) {
    const item = (n ?? {}) as Record<string, unknown>
    const type = str(item.type, `notifications[${i}].type`, true) as Notification['type'] | undefined
    if (type && !['slack', 'discord', 'teams', 'line', 'webhook'].includes(type)) {
      problems.push(`notifications[${i}].type must be slack, discord, teams, line or webhook`)
      continue
    }
    const events = Array.isArray(item.events) ? (item.events.map(String) as EventKind[]) : EVENTS
    if (events.some((e) => !EVENTS.includes(e)))
      problems.push(`notifications[${i}].events can only use ${EVENTS.join(', ')}`)
    const entry: Notification = {
      type: type ?? 'webhook',
      webhook: str(item.webhook, `notifications[${i}].webhook`),
      token: str(item.token, `notifications[${i}].token`),
      to: str(item.to, `notifications[${i}].to`),
      severities: levels(item.severities, `notifications[${i}].severities`, [1, 2, 3, 4]),
      events,
    }
    if (entry.type === 'line' ? !entry.token || !entry.to : !entry.webhook) {
      problems.push(
        entry.type === 'line'
          ? `notifications[${i}] (line) needs token and to: the names of environment variables`
          : `notifications[${i}] (${entry.type}) needs webhook: the name of an environment variable`,
      )
    }
    notifications.push(entry)
  }

  const config: Config = {
    title: str(raw.title, 'title') ?? 'Status',
    description: str(raw.description, 'description'),
    url: str(raw.url, 'url')?.replace(/\/$/, ''),
    lang: lang === 'th' ? 'th' : 'en',
    timezone,
    label: str(raw.label, 'label') ?? 'incident',
    services,
    reminders,
    public: levels(severity.public, 'severity.public', [1, 2, 3]),
    postmortem: levels(severity.postmortem, 'severity.postmortem', [1, 2]),
    postmortemDir: str(raw.postmortems, 'postmortems') ?? 'docs/postmortems',
    oncall,
    notifications,
  }
  if (problems.length) throw new ConfigError(problems)
  return config
}
