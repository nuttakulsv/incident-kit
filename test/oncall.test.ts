import { describe, expect, test } from 'vitest'
import type { OnCall } from '../src/config.js'
import { onCallAt, schedule } from '../src/oncall.js'
import { fromWallClock, parseLocal } from '../src/time.js'

const bkk = 'Asia/Bangkok'
const rotation: OnCall = { rotation: ['alice', 'bob', 'carol'], start: '2026-01-05', handoff: '10:00', overrides: [] }

describe('onCallAt', () => {
  test('hands over at the configured local time, once a week', () => {
    expect(onCallAt(rotation, parseLocal('2026-01-05 09:59', bkk)!, bkk)).toBe('carol')
    expect(onCallAt(rotation, parseLocal('2026-01-05 10:00', bkk)!, bkk)).toBe('alice')
    expect(onCallAt(rotation, parseLocal('2026-01-12 09:59', bkk)!, bkk)).toBe('alice')
    expect(onCallAt(rotation, parseLocal('2026-01-12 10:00', bkk)!, bkk)).toBe('bob')
    expect(onCallAt(rotation, parseLocal('2026-01-26 10:00', bkk)!, bkk)).toBe('alice')
  })

  test('uses the wall clock of the configured time zone, not UTC', () => {
    // 10:00 in Bangkok is 03:00 UTC.
    expect(onCallAt(rotation, new Date('2026-01-12T02:59:00Z'), bkk)).toBe('alice')
    expect(onCallAt(rotation, new Date('2026-01-12T03:00:00Z'), bkk)).toBe('bob')
  })

  test('keeps the local handoff time across daylight saving changes', () => {
    const ny = 'America/New_York'
    const r: OnCall = { ...rotation, start: '2026-03-02' }
    // Clocks moved forward on 2026-03-08, the handoff is still at 10:00 local.
    expect(onCallAt(r, parseLocal('2026-03-09 09:59', ny)!, ny)).toBe('alice')
    expect(onCallAt(r, parseLocal('2026-03-09 10:00', ny)!, ny)).toBe('bob')
    expect(fromWallClock({ year: 2026, month: 3, day: 9, hour: 10, minute: 0 }, ny).toISOString()).toBe(
      '2026-03-09T14:00:00.000Z',
    )
  })

  test('overrides win', () => {
    const r: OnCall = { ...rotation, overrides: [{ user: 'dave', from: '2026-01-07', to: '2026-01-08 12:00' }] }
    expect(onCallAt(r, parseLocal('2026-01-07 03:00', bkk)!, bkk)).toBe('dave')
    expect(onCallAt(r, parseLocal('2026-01-08 12:00', bkk)!, bkk)).toBe('alice')
  })
})

describe('schedule', () => {
  test('lists weekly shifts with overrides cut in, merging neighbours', () => {
    const r: OnCall = { ...rotation, overrides: [{ user: 'dave', from: '2026-01-10', to: '2026-01-13' }] }
    const shifts = schedule(r, parseLocal('2026-01-06', bkk)!, 2, bkk).map((s) => ({
      user: s.user,
      from: s.from.toISOString(),
      to: s.to.toISOString(),
    }))
    expect(shifts).toEqual([
      { user: 'alice', from: '2026-01-05T03:00:00.000Z', to: '2026-01-09T17:00:00.000Z' },
      { user: 'dave', from: '2026-01-09T17:00:00.000Z', to: '2026-01-12T17:00:00.000Z' },
      { user: 'bob', from: '2026-01-12T17:00:00.000Z', to: '2026-01-19T03:00:00.000Z' },
    ])
  })
})
