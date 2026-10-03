import { createServer, type Server } from 'node:http'
import type { RawComment, RawIssue } from '../src/github.js'

interface Stored extends RawIssue {
  assignees: { login: string }[]
}

/** Just enough of the GitHub REST API for the Action, kept in memory. Also records webhook calls. */
export class FakeGitHub {
  issues = new Map<number, Stored>()
  comments = new Map<number, RawComment[]>()
  labels = new Set<string>()
  files = new Map<string, string>()
  branches = new Map<string, string>([['main', 'sha-main']])
  pulls: { title: string; head: string; base: string; body: string; html_url: string }[] = []
  hooks: { url: string; body: unknown }[] = []
  log: string[] = []
  clock = () => new Date().toISOString()
  denyPulls = false
  private nextComment = 1000

  constructor(readonly repo = 'acme/status') {}

  openIssue(
    i: Partial<Omit<RawIssue, 'user'>> & { number: number; body: string; user?: string; association?: string },
  ): Stored {
    const issue: Stored = {
      title: '[Incident] Checkout errors',
      labels: [],
      state: 'open',
      created_at: this.clock(),
      closed_at: null,
      html_url: `https://github.com/${this.repo}/issues/${i.number}`,
      ...i,
      user: { login: i.user ?? 'alice', type: 'User' },
      author_association: i.association ?? 'MEMBER',
      assignees: [],
    }
    this.issues.set(i.number, issue)
    this.comments.set(i.number, [])
    return issue
  }

  addComment(number: number, user: string, body: string, association = 'MEMBER', bot = false): RawComment {
    const c: RawComment = {
      id: this.nextComment++,
      body,
      user: { login: user, type: bot ? 'Bot' : 'User' },
      author_association: association,
      created_at: this.clock(),
    }
    this.comments.get(number)!.push(c)
    return c
  }

  handle(method: string, url: URL, body: Record<string, unknown> | undefined): { status: number; json?: unknown } {
    const path = url.pathname
    this.log.push(`${method} ${path}`)
    const repo = `/repos/${this.repo}`
    const page = Number(url.searchParams.get('page') ?? 1)
    const paged = <T>(list: T[]) => ({ status: 200, json: list.slice((page - 1) * 100, page * 100) })
    let m: RegExpExecArray | null

    if (method === 'GET' && path === repo) return { status: 200, json: { default_branch: 'main' } }
    if (method === 'GET' && path === `${repo}/labels`) return paged([...this.labels].map((name) => ({ name })))
    if (method === 'POST' && path === `${repo}/labels`) {
      this.labels.add(String(body!.name))
      return { status: 201, json: {} }
    }
    if (method === 'GET' && path === `${repo}/issues`) {
      const label = url.searchParams.get('labels')
      const state = url.searchParams.get('state')
      const list = [...this.issues.values()].filter(
        (i) =>
          (!label || i.labels.some((l) => (typeof l === 'string' ? l : l.name) === label)) &&
          (state === 'all' || i.state === (state ?? 'open')),
      )
      return paged(list)
    }
    if ((m = new RegExp(`^${repo}/issues/(\\d+)$`).exec(path))) {
      const issue = this.issues.get(Number(m[1]))
      if (!issue) return { status: 404 }
      if (method === 'GET') return { status: 200, json: issue }
      if (method === 'PATCH') {
        if (typeof body!.body === 'string') issue.body = body!.body
        if (body!.state === 'closed' && issue.state === 'open') {
          issue.state = 'closed'
          issue.closed_at = this.clock()
        }
        if (body!.state === 'open') {
          issue.state = 'open'
          issue.closed_at = null
        }
        return { status: 200, json: issue }
      }
    }
    if ((m = new RegExp(`^${repo}/issues/(\\d+)/comments$`).exec(path))) {
      const n = Number(m[1])
      if (method === 'GET') return paged(this.comments.get(n) ?? [])
      if (method === 'POST')
        return { status: 201, json: this.addComment(n, 'github-actions[bot]', String(body!.body), 'NONE', true) }
    }
    if ((m = new RegExp(`^${repo}/issues/(\\d+)/labels$`).exec(path)) && method === 'PUT') {
      this.issues.get(Number(m[1]))!.labels = (body!.labels as string[]).map((name) => ({ name }))
      return { status: 200, json: [] }
    }
    if ((m = new RegExp(`^${repo}/issues/(\\d+)/assignees$`).exec(path))) {
      const issue = this.issues.get(Number(m[1]))!
      const users = body!.assignees as string[]
      if (method === 'POST') issue.assignees.push(...users.map((login) => ({ login })))
      if (method === 'DELETE') issue.assignees = issue.assignees.filter((a) => !users.includes(a.login))
      return { status: 201, json: issue }
    }
    if (method === 'GET' && path === `${repo}/pulls`) {
      const head = url.searchParams.get('head')?.split(':')[1]
      return { status: 200, json: this.pulls.filter((p) => p.head === head) }
    }
    if (method === 'POST' && path === `${repo}/pulls`) {
      if (this.denyPulls)
        return { status: 403, json: { message: 'GitHub Actions is not permitted to create or approve pull requests.' } }
      const pr = {
        ...(body as { title: string; head: string; base: string; body: string }),
        html_url: `https://github.com/${this.repo}/pull/${50 + this.pulls.length}`,
      }
      this.pulls.push(pr)
      return { status: 201, json: pr }
    }
    if ((m = new RegExp(`^${repo}/git/ref/heads/(.+)$`).exec(path))) {
      const sha = this.branches.get(m[1]!)
      return sha ? { status: 200, json: { object: { sha } } } : { status: 404 }
    }
    if (method === 'POST' && path === `${repo}/git/refs`) {
      const ref = String(body!.ref).replace('refs/heads/', '')
      if (this.branches.has(ref)) return { status: 422, json: { message: 'Reference already exists' } }
      this.branches.set(ref, String(body!.sha))
      return { status: 201, json: {} }
    }
    if ((m = new RegExp(`^${repo}/contents/(.+)$`).exec(path)) && method === 'PUT') {
      this.files.set(
        `${body!.branch}:${decodeURIComponent(m[1]!)}`,
        Buffer.from(String(body!.content), 'base64').toString('utf8'),
      )
      return { status: 201, json: {} }
    }
    return { status: 404, json: { message: `fake GitHub has no ${method} ${path}` } }
  }

  /** A fetch that answers API calls and records everything else as a webhook. */
  fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    if (url.hostname !== 'api.github.com') {
      this.hooks.push({ url: String(input), body })
      return new Response('ok', { status: 200 })
    }
    const r = this.handle(init?.method ?? 'GET', url, body)
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status })
  }) as typeof fetch

  /** The same API over HTTP, for running the bundled Action in a child process. */
  listen(): Promise<{ url: string; server: Server }> {
    const server = createServer((req, res) => {
      let data = ''
      req.on('data', (c) => (data += c))
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const r = this.handle(req.method ?? 'GET', url, data ? JSON.parse(data) : undefined)
        res.writeHead(r.status, { 'content-type': 'application/json' })
        res.end(r.json === undefined ? '' : JSON.stringify(r.json))
      })
    })
    return new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve({ url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`, server })
      }),
    )
  }
}
