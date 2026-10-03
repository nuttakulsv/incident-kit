import { readFileSync } from 'node:fs'
import type { IssueData } from './incident.js'

interface DemoComment {
  user: string
  at: string
  body: string
  association?: string
}

interface DemoIncident {
  number: number
  title: string
  user: string
  created: string
  closed?: string | null
  body: string
  association?: string
  comments: DemoComment[]
}

/** "-2h30m" or "-21d" relative to `now`, or an ISO timestamp. Keeps the demo status page fresh on every build. */
export function relative(text: string, now: Date): string {
  const m = /^-(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/.exec(text)
  if (!m) return new Date(text).toISOString()
  const minutes = +(m[1] ?? 0) * 1440 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0)
  return new Date(now.getTime() - minutes * 60000).toISOString()
}

export function loadDemo(path: string, now: Date, label = 'incident'): IssueData[] {
  const data = JSON.parse(readFileSync(path, 'utf8')) as { incidents: DemoIncident[] }
  let id = 1
  return data.incidents.map((i) => ({
    number: i.number,
    title: i.title,
    body: i.body,
    user: i.user,
    association: i.association ?? 'MEMBER',
    createdAt: relative(i.created, now),
    closedAt: i.closed ? relative(i.closed, now) : null,
    state: i.closed ? 'closed' : 'open',
    labels: [label],
    comments: i.comments.map((c) => ({
      id: id++,
      body: c.body,
      user: c.user,
      association: c.association ?? 'MEMBER',
      createdAt: relative(c.at, now),
    })),
  }))
}
