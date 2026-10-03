import { describe, expect, test } from 'vitest'
import { diff } from '../src/action.js'
import { parseConfig } from '../src/config.js'
import { parseForm } from '../src/form.js'
import { buildIncident, isPublic, readSnapshot, snapshot } from '../src/incident.js'
import { statusBlock, withStatusBlock } from '../src/render.js'
import { comment, config, FORM, issue } from './helpers.js'

describe('parseForm', () => {
  test('reads the fields GitHub writes for the issue form', () => {
    const f = parseForm(
      FORM(2, 'Website, Payments', '\n\n### When did the impact start?\n\n2026-10-03 09:40'),
      config().services,
    )
    expect(f).toEqual({
      severity: 2,
      services: ['website', 'payments'],
      publicTitle: undefined,
      summary: 'Checkout returns 500',
      impactStart: '2026-10-03 09:40',
    })
  })

  test('reads the Thai form and ignores unknown services', () => {
    const body =
      '### ระดับความรุนแรง\n\nSEV1 - วิกฤต\n\n### บริการที่ได้รับผลกระทบ\n\nPublic API, Search\n\n### หัวข้อบนหน้าสถานะ\n\nเว็บใช้งานไม่ได้'
    expect(parseForm(body, config().services)).toMatchObject({
      severity: 1,
      services: ['api'],
      publicTitle: 'เว็บใช้งานไม่ได้',
    })
  })
})

describe('buildIncident', () => {
  test('a new incident from a team member', () => {
    const inc = buildIncident(issue(), config())
    expect(inc).toMatchObject({
      title: 'Checkout errors',
      publicTitle: 'Checkout errors',
      severity: 2,
      services: ['website', 'payments'],
      state: 'investigating',
      unconfirmed: false,
      // 2026-10-03 10:00 Bangkok is the 39th weekly handoff since 2026-01-05: carol
      commander: 'carol',
      acknowledgedAt: undefined,
    })
    expect(inc.updates).toEqual([{ at: '2026-10-03T03:00:00Z', state: 'investigating' }])
  })

  test('walks through the states and records the timeline', () => {
    const inc = buildIncident(
      issue({
        comments: [
          comment('carol', '2026-10-03T03:06:00Z', '/ack'),
          comment('carol', '2026-10-03T03:20:00Z', '/update We are rolling back the 09:30 deploy.\n/status identified'),
          comment('bob', '2026-10-03T03:30:00Z', 'just chatting, no commands'),
          comment('carol', '2026-10-03T03:40:00Z', '/sev 1\n/note DB pool exhausted'),
          comment('carol', '2026-10-03T04:10:00Z', '/status resolved'),
        ],
      }),
      config(),
    )
    expect(inc.state).toBe('resolved')
    expect(inc.severity).toBe(1)
    expect(inc.acknowledgedAt).toBe('2026-10-03T03:06:00Z')
    expect(inc.resolvedAt).toBe('2026-10-03T04:10:00Z')
    expect(inc.participants).toEqual(['alice', 'carol', 'bob'])
    // The status in the same comment applies before the update, so the update is published as "identified".
    expect(inc.updates).toEqual([
      { at: '2026-10-03T03:00:00Z', state: 'investigating' },
      { at: '2026-10-03T03:20:00Z', state: 'identified', text: 'We are rolling back the 09:30 deploy.' },
      { at: '2026-10-03T04:10:00Z', state: 'resolved' },
    ])
    expect(inc.timeline.map((e) => e.kind)).toEqual([
      'declared',
      'ack',
      'status',
      'update',
      'severity',
      'note',
      'status',
    ])
  })

  test('ignores commands from people without write access', () => {
    const inc = buildIncident(
      issue({ comments: [comment('stranger', '2026-10-03T03:10:00Z', '/status resolved', 'NONE')] }),
      config(),
    )
    expect(inc.state).toBe('investigating')
    expect(inc.participants).toContain('stranger')
  })

  test('an outside report stays unconfirmed and private until the team acts', () => {
    const outside = issue({
      user: 'customer',
      association: 'NONE',
      body: FORM(1, 'Website').replace('### Public title\n\n_No response_', '### Public title\n\nYOU HAVE BEEN HACKED'),
    })
    const before = buildIncident(outside, config())
    expect(before).toMatchObject({ unconfirmed: true, severity: 3, services: [], publicTitle: 'Service disruption' })
    expect(isPublic(before, config())).toBe(false)
    expect(before.updates).toEqual([])

    const after = buildIncident(
      {
        ...outside,
        comments: [comment('bob', '2026-10-03T03:15:00Z', '/sev 2\n/services website\n/title Website errors')],
      },
      config(),
    )
    expect(after).toMatchObject({
      unconfirmed: false,
      severity: 2,
      services: ['website'],
      publicTitle: 'Website errors',
    })
    expect(after.acknowledgedAt).toBe('2026-10-03T03:15:00Z')
    expect(isPublic(after, config())).toBe(true)
  })

  test('closing the issue resolves it, and the bot markers keep that in history', () => {
    const closed = buildIncident(issue({ state: 'closed', closedAt: '2026-10-03T05:00:00Z' }), config())
    expect(closed).toMatchObject({ state: 'resolved', resolvedAt: '2026-10-03T05:00:00Z' })

    const bot = (at: string, event: string) => ({
      ...comment('github-actions[bot]', at, `<!-- incident-kit:event ${event} -->\nx`),
      bot: true,
    })
    const reopened = buildIncident(
      issue({ comments: [bot('2026-10-03T05:00:00Z', 'closed'), bot('2026-10-03T05:30:00Z', 'reopened')] }),
      config(),
    )
    expect(reopened.state).toBe('investigating')
    expect(reopened.resolvedAt).toBeUndefined()
    expect(reopened.timeline.filter((e) => e.kind === 'status').map((e) => e.state)).toEqual([
      'resolved',
      'investigating',
    ])
  })

  test('the on-call person declaring it counts as acknowledged', () => {
    expect(buildIncident(issue({ user: 'carol' }), config()).acknowledgedAt).toBe('2026-10-03T03:00:00Z')
  })

  test('without on-call the declarer becomes commander', () => {
    const noOncall = parseConfig('services:\n  - id: website\n')
    expect(buildIncident(issue(), noOncall)).toMatchObject({
      commander: 'alice',
      acknowledgedAt: '2026-10-03T03:00:00Z',
    })
  })

  test('/assign hands over the commander role', () => {
    const inc = buildIncident(issue({ comments: [comment('carol', '2026-10-03T03:05:00Z', '/assign @bob')] }), config())
    expect(inc.commander).toBe('bob')
  })
})

describe('snapshot and diff', () => {
  test('the status block carries the snapshot, and the body survives a round trip', () => {
    const inc = buildIncident(issue(), config())
    const body = withStatusBlock(issue().body, statusBlock(inc, config(), new Date('2026-10-03T03:30:00Z')))
    expect(readSnapshot(body)).toEqual(snapshot(inc))
    const again = withStatusBlock(body, statusBlock(inc, config(), new Date('2026-10-03T03:30:00Z')))
    expect(again).toBe(body)
    expect(body.endsWith(issue().body + '\n')).toBe(true)
  })

  test('diff turns the changes since the last run into notifications', () => {
    const fresh = { state: 'investigating', severity: 3, updates: 0, unconfirmed: true } as const
    const start = buildIncident(issue(), config())
    expect(diff(fresh, start)).toEqual([{ kind: 'declared', text: undefined }])

    const later = buildIncident(
      issue({
        comments: [
          comment('carol', '2026-10-03T03:10:00Z', '/sev 1'),
          comment('carol', '2026-10-03T03:20:00Z', '/update First'),
          comment('carol', '2026-10-03T03:25:00Z', '/status monitoring\n/update Second'),
        ],
      }),
      config(),
    )
    // Two runs were skipped; everything since the published snapshot is still reported once.
    expect(diff(snapshot(start), later)).toEqual([{ kind: 'severity' }, { kind: 'status', text: 'First\n\nSecond' }])
    expect(diff(snapshot(later), later)).toEqual([])
  })
})
