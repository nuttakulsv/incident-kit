import type { Lang } from './config.js'

export interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

export function wallClock(date: Date, timeZone: string): WallClock {
  let fmt = partsCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
    partsCache.set(timeZone, fmt)
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]))
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour!, minute: +p.minute! }
}

/** Minutes since the epoch as if the wall clock were UTC. Good for counting local days and weeks across DST. */
export const wallMinutes = (w: WallClock) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) / 60000

/** The instant at which the clock in `timeZone` shows the given wall time. */
export function fromWallClock(w: WallClock, timeZone: string): Date {
  const target = wallMinutes(w)
  let guess = target * 60000
  for (let i = 0; i < 3; i++) {
    const diff = target - wallMinutes(wallClock(new Date(guess), timeZone))
    if (diff === 0) break
    guess += diff * 60000
  }
  return new Date(guess)
}

/** Parses `YYYY-MM-DD`, `YYYY-MM-DD HH:MM` or an ISO timestamp. Local forms are read in `timeZone`. */
export function parseLocal(text: string, timeZone: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text.trim())
  if (m)
    return fromWallClock(
      { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +(m[4] ?? 0), minute: +(m[5] ?? 0) },
      timeZone,
    )
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? undefined : d
}

const locale = (lang: Lang) => (lang === 'th' ? 'th-TH' : 'en-GB')

export function formatDateTime(date: Date | string, lang: Lang, timeZone: string): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(date))
}

export function formatDate(date: Date | string, lang: Lang, timeZone: string): string {
  return new Intl.DateTimeFormat(locale(lang), { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(date),
  )
}

export function formatTime(date: Date | string, lang: Lang, timeZone: string): string {
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(date))
}

export function formatDuration(ms: number, lang: Lang): string {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  const u = lang === 'th' ? { d: 'วัน', h: 'ชม.', m: 'นาที' } : { d: 'd', h: 'h', m: 'min' }
  if (d) return `${d} ${u.d}${h ? ` ${h} ${u.h}` : ''}`
  if (h) return `${h} ${u.h}${m ? ` ${m} ${u.m}` : ''}`
  return `${m} ${u.m}`
}

/** The local calendar day (YYYY-MM-DD) of an instant. */
export function localDay(date: Date | string, timeZone: string): string {
  const w = wallClock(new Date(date), timeZone)
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`
}
