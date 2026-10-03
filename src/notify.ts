import type { Config, EventKind, Notification } from './config.js'
import { sevLabel, strings } from './i18n.js'
import type { Incident } from './incident.js'
import { serviceNames } from './render.js'

export interface Change {
  kind: EventKind
  /** Public text for update events. */
  text?: string
}

export interface Message {
  title: string
  text: string
  url?: string
  color: string
  fields: [string, string][]
}

const COLORS = { 1: '#d1242f', 2: '#e16f24', 3: '#bf8700', 4: '#0969da' } as const

export function message(change: Change, inc: Incident, config: Config): Message {
  const t = strings(config.lang)
  const sev = sevLabel(inc.severity, config.lang)
  const title = {
    declared: t.notify.declared(sev),
    severity: t.notify.severity(sev),
    status: t.notify.status(t.state[inc.state]),
    update: `${t.notify.update} · ${t.state[inc.state]}`,
    resolved: t.notify.resolved,
  }[change.kind]
  const text = change.text ?? (change.kind === 'declared' ? (inc.summary ?? '') : '')
  return {
    title: `${title}: ${inc.publicTitle} (#${inc.number})`,
    text,
    url: inc.url,
    color: inc.state === 'resolved' ? '#1a7f37' : COLORS[inc.severity],
    fields: [
      [t.notify.services, serviceNames(inc, config).join(', ') || '-'],
      [t.notify.commander, inc.commander ? `@${inc.commander}` : '-'],
    ],
  }
}

// Slack treats <!channel>, <@U123> and links specially. Escaping keeps incident text from pinging anyone.
const slack = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function payload(n: Notification, m: Message, change: Change, inc: Incident): unknown {
  const lines = [m.title, m.text, ...m.fields.map(([k, v]) => `${k}: ${v}`), m.url ?? ''].filter(Boolean)
  switch (n.type) {
    case 'slack':
      return {
        text: slack(m.title),
        attachments: [
          {
            color: m.color,
            title: slack(m.title),
            title_link: m.url,
            text: slack(m.text),
            fields: m.fields.map(([title, value]) => ({ title, value: slack(value), short: true })),
          },
        ],
      }
    case 'discord':
      return {
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: m.title.slice(0, 256),
            url: m.url,
            description: m.text.slice(0, 4000) || undefined,
            color: parseInt(m.color.slice(1), 16),
            fields: m.fields.map(([name, value]) => ({ name, value, inline: true })),
          },
        ],
      }
    case 'teams':
      return {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                { type: 'TextBlock', text: m.title, weight: 'Bolder', size: 'Medium', wrap: true },
                ...(m.text ? [{ type: 'TextBlock', text: m.text, wrap: true }] : []),
                { type: 'FactSet', facts: m.fields.map(([title, value]) => ({ title, value })) },
              ],
              actions: m.url ? [{ type: 'Action.OpenUrl', title: 'GitHub', url: m.url }] : [],
            },
          },
        ],
      }
    case 'line':
      return { messages: [{ type: 'text', text: lines.join('\n').slice(0, 5000) }] }
    case 'webhook':
      return { event: change.kind, text: change.text, message: m, incident: inc }
  }
}

export interface Sent {
  type: Notification['type']
  ok: boolean
  skipped?: string
  status?: number
}

/** Sends one change to every matching target. Missing secrets skip a target instead of failing the run. */
export async function notify(
  changes: Change[],
  inc: Incident,
  config: Config,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<Sent[]> {
  const sent: Sent[] = []
  if (inc.unconfirmed) return sent
  for (const change of changes) {
    const m = message(change, inc, config)
    for (const n of config.notifications) {
      if (!n.events.includes(change.kind) || !n.severities.includes(inc.severity)) continue
      const secret = n.type === 'line' ? env[n.token ?? ''] : env[n.webhook ?? '']
      const to = n.type === 'line' ? env[n.to ?? ''] : undefined
      if (!secret || (n.type === 'line' && !to)) {
        sent.push({
          type: n.type,
          ok: false,
          skipped: `${n.type === 'line' ? `${n.token} or ${n.to}` : n.webhook} is not set`,
        })
        continue
      }
      const body = payload(n, m, change, inc) as Record<string, unknown>
      const res = await fetchImpl(n.type === 'line' ? 'https://api.line.me/v2/bot/message/push' : secret, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(n.type === 'line' ? { authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify(n.type === 'line' ? { to, ...body } : body),
      }).catch(() => undefined)
      sent.push({ type: n.type, ok: Boolean(res?.ok), status: res?.status })
    }
  }
  return sent
}
