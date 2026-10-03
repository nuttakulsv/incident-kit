import { describe, expect, test } from 'vitest'
import { buildIncident } from '../src/incident.js'
import { notify, payload, message } from '../src/notify.js'
import { config, issue } from './helpers.js'

const extra = `  - type: discord
    webhook: DISCORD_URL
  - type: teams
    webhook: TEAMS_URL
    events: [declared, resolved]
  - type: line
    token: LINE_TOKEN
    to: LINE_TO
  - type: webhook
    webhook: HOOK_URL
    severities: [1]
`

function capture() {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return new Response('ok', { status: url.includes('discord') ? 500 : 200 })
  }) as typeof fetch
  return { calls, fetchImpl }
}

describe('notify', () => {
  const cfg = config(extra)
  const inc = {
    ...buildIncident(issue(), cfg),
    url: 'https://github.com/o/r/issues/7',
    summary: 'Checkout <!channel> returns 500',
  }
  const env = {
    SLACK_URL: 'https://hooks.slack.com/services/x',
    DISCORD_URL: 'https://discord.com/api/webhooks/x',
    TEAMS_URL: 'https://example.webhook.office.com/x',
    LINE_TOKEN: 'line-secret',
    LINE_TO: 'C123',
  }

  test('sends to every matching target and reports failures and missing secrets', async () => {
    const { calls, fetchImpl } = capture()
    const sent = await notify([{ kind: 'declared' }], inc, cfg, env, fetchImpl)
    expect(sent).toEqual([
      { type: 'slack', ok: true, status: 200 },
      { type: 'discord', ok: false, status: 500 },
      { type: 'teams', ok: true, status: 200 },
      { type: 'line', ok: true, status: 200 },
    ])
    expect(calls.map((c) => c.url)).toEqual([
      env.SLACK_URL,
      env.DISCORD_URL,
      env.TEAMS_URL,
      'https://api.line.me/v2/bot/message/push',
    ])
    const line = calls[3]!
    expect(line.headers.authorization).toBe('Bearer line-secret')
    expect(line.body.to).toBe('C123')
    expect((line.body.messages as { text: string }[])[0]!.text).toContain(
      'New SEV2 Major incident: Checkout errors (#7)',
    )
  })

  test('filters by event and severity, and skips targets without secrets', async () => {
    const { calls, fetchImpl } = capture()
    const sev3 = { ...inc, severity: 3 as const }
    const sent = await notify(
      [{ kind: 'update', text: 'Still looking' }],
      sev3,
      cfg,
      { DISCORD_URL: 'https://discord.com/x' },
      fetchImpl,
    )
    expect(sent).toEqual([
      { type: 'discord', ok: false, status: 500 },
      { type: 'line', ok: false, skipped: 'LINE_TOKEN or LINE_TO is not set' },
    ])
    expect(calls).toHaveLength(1)
  })

  test('nobody is notified about an unconfirmed report', async () => {
    const { calls, fetchImpl } = capture()
    expect(await notify([{ kind: 'declared' }], { ...inc, unconfirmed: true }, cfg, env, fetchImpl)).toEqual([])
    expect(calls).toHaveLength(0)
  })

  test('payloads keep incident text from pinging people', () => {
    const m = message({ kind: 'declared' }, inc, cfg)
    const slack = payload(cfg.notifications[0]!, m, { kind: 'declared' }, inc) as { attachments: { text: string }[] }
    expect(slack.attachments[0]!.text).toBe('Checkout &lt;!channel&gt; returns 500')
    const discord = payload(cfg.notifications[1]!, m, { kind: 'declared' }, inc) as Record<string, unknown>
    expect(discord.allowed_mentions).toEqual({ parse: [] })
    const teams = payload(cfg.notifications[2]!, m, { kind: 'declared' }, inc) as {
      attachments: { contentType: string }[]
    }
    expect(teams.attachments[0]!.contentType).toBe('application/vnd.microsoft.card.adaptive')
  })

  test('resolved messages are green, Thai config gives Thai text', () => {
    const thai = { ...config(), lang: 'th' as const }
    const m = message({ kind: 'resolved' }, { ...inc, state: 'resolved' }, thai)
    expect(m.color).toBe('#1a7f37')
    expect(m.title).toBe('แก้ไขแล้ว: Checkout errors (#7)')
  })
})
