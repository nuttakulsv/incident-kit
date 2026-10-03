import type { CommentData, IssueData } from './incident.js'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface GitHub {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>
  all<T>(path: string): Promise<T[]>
}

export function github(token: string, api = 'https://api.github.com', fetchImpl: typeof fetch = fetch): GitHub {
  const base = api.replace(/\/$/, '')
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new ApiError(res.status, `${method} ${path}: ${res.status} ${await res.text()}`)
    return (res.status === 204 ? undefined : await res.json()) as T
  }
  return {
    request,
    async all<T>(path: string) {
      const items: T[] = []
      for (let page = 1; page <= 50; page++) {
        const batch = await request<T[]>('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
        items.push(...batch)
        if (batch.length < 100) break
      }
      return items
    },
  }
}

export interface RawUser {
  login: string
  type?: string
}

export interface RawIssue {
  number: number
  title: string
  body?: string | null
  user: RawUser
  author_association: string
  created_at: string
  closed_at?: string | null
  state: 'open' | 'closed'
  labels: (string | { name?: string })[]
  html_url?: string
  pull_request?: unknown
  assignees?: RawUser[]
}

export interface RawComment {
  id: number
  body?: string | null
  user: RawUser
  author_association: string
  created_at: string
}

export const toComment = (c: RawComment): CommentData => ({
  id: c.id,
  body: c.body ?? '',
  user: c.user.login,
  association: c.author_association,
  createdAt: c.created_at,
  bot: c.user.type === 'Bot',
})

export const toIssue = (i: RawIssue, comments: RawComment[]): IssueData => ({
  number: i.number,
  title: i.title,
  body: i.body ?? '',
  user: i.user.login,
  association: i.author_association,
  createdAt: i.created_at,
  closedAt: i.closed_at,
  state: i.state,
  labels: i.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
  url: i.html_url,
  bot: i.user.type === 'Bot',
  comments: comments.map(toComment),
})

/** Incident issues changed since `since` (or all of them), with their comments. */
export async function fetchIncidents(gh: GitHub, repo: string, label: string, since?: Date): Promise<IssueData[]> {
  const query = `labels=${encodeURIComponent(label)}&state=all${since ? `&since=${since.toISOString()}` : ''}`
  const issues = (await gh.all<RawIssue>(`/repos/${repo}/issues?${query}`)).filter((i) => !i.pull_request)
  return Promise.all(
    issues.map(async (i) => toIssue(i, await gh.all<RawComment>(`/repos/${repo}/issues/${i.number}/comments`))),
  )
}
