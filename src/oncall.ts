import type { OnCall } from './config.js'
import { fromWallClock, parseLocal, wallClock, wallMinutes } from './time.js'

const WEEK = 7 * 24 * 60

function firstHandoff(oncall: OnCall) {
  const [year, month, day] = oncall.start.split('-').map(Number) as [number, number, number]
  const [hour, minute] = oncall.handoff.split(':').map(Number) as [number, number]
  return { year, month, day, hour, minute }
}

/** Who is on call at `at`. Overrides win; otherwise the rotation moves one person every week at the handoff time. */
export function onCallAt(oncall: OnCall, at: Date, timeZone: string): string | undefined {
  for (const o of oncall.overrides) {
    const from = parseLocal(o.from, timeZone)
    const to = parseLocal(o.to, timeZone)
    if (from && to && at >= from && at < to) return o.user
  }
  if (oncall.rotation.length === 0) return undefined
  const minutes = wallMinutes(wallClock(at, timeZone)) - wallMinutes(firstHandoff(oncall))
  const week = Math.floor(minutes / WEEK)
  const n = oncall.rotation.length
  return oncall.rotation[((week % n) + n) % n]
}

export interface Shift {
  user: string
  from: Date
  to: Date
}

/** The next `weeks` weekly shifts starting with the one that contains `from`, with overrides applied on top. */
export function schedule(oncall: OnCall, from: Date, weeks: number, timeZone: string): Shift[] {
  const start = firstHandoff(oncall)
  const offset = Math.floor((wallMinutes(wallClock(from, timeZone)) - wallMinutes(start)) / WEEK)
  const at = (week: number) => {
    const d = new Date(Date.UTC(start.year, start.month - 1, start.day + week * 7, start.hour, start.minute))
    return fromWallClock(
      {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: start.hour,
        minute: start.minute,
      },
      timeZone,
    )
  }
  const shifts: Shift[] = []
  for (let w = offset; w < offset + weeks; w++) {
    const n = oncall.rotation.length
    shifts.push({ user: oncall.rotation[((w % n) + n) % n]!, from: at(w), to: at(w + 1) })
  }

  // Cut each override into the weekly shifts it overlaps.
  const result: Shift[] = []
  const overrides = oncall.overrides
    .map((o) => ({ user: o.user, from: parseLocal(o.from, timeZone), to: parseLocal(o.to, timeZone) }))
    .filter((o): o is Shift => Boolean(o.from && o.to))
  for (const s of shifts) {
    let pieces: Shift[] = [s]
    for (const o of overrides) {
      pieces = pieces.flatMap((p) => {
        if (o.to <= p.from || o.from >= p.to) return [p]
        const out: Shift[] = []
        if (o.from > p.from) out.push({ ...p, to: o.from })
        out.push({ user: o.user, from: o.from > p.from ? o.from : p.from, to: o.to < p.to ? o.to : p.to })
        if (o.to < p.to) out.push({ ...p, from: o.to })
        return out
      })
    }
    for (const p of pieces) {
      const last = result.at(-1)
      if (last && last.user === p.user && last.to.getTime() === p.from.getTime()) last.to = p.to
      else result.push(p)
    }
  }
  return result
}
