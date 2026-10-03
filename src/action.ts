import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseCommands } from './commands.js'
import { loadConfig, STATES, type Config } from './config.js'
import { loadDemo } from './demo.js'
import { BLOCK_START, parseForm } from './form.js'
import {
  ApiError,
  fetchIncidents,
  github,
  toComment,
  toIssue,
  type GitHub,
  type RawComment,
  type RawIssue,
} from './github.js'
import { sevLabel, strings } from './i18n.js'
import {
  buildIncident,
  isPublic,
  isTeam,
  readSnapshot,
  type Incident,
  type IssueData,
  type Snapshot,
} from './incident.js'
import { notify, type Change, type Sent } from './notify.js'
import { postmortemPath, renderPostmortem } from './postmortem.js'
import { statusBlock, withStatusBlock } from './render.js'
import { buildReport, reportMarkdown } from './report.js'
import { buildSite } from './site.js'
import { formatDuration } from './time.js'

type Env = Record<string, string | undefined>

export interface ActionResult {
  command: string
  incident?: number
  state?: string
  changes: string[]
  replies: number
  siteChanged: boolean
  notified: Sent[]
}

const input = (env: Env, name: string) => env[`INPUT_${name.toUpperCase()}`]?.trim() ?? ''
const REMINDER = '<!-- incident-kit:reminder -->'

export async function run(env: Env, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<ActionResult> {
  const command = input(env, 'command') || 'handle'
  const root = env.GITHUB_WORKSPACE ?? process.cwd()
  const repo = env.GITHUB_REPOSITORY ?? ''
  const config = loadConfig(root, input(env, 'config') || undefined)
  config.url ??= pagesUrl(repo)
  const gh = github(input(env, 'github-token'), env.GITHUB_API_URL, fetchImpl)
  const result: ActionResult = { command, changes: [], replies: 0, siteChanged: false, notified: [] }

  if (command === 'build-site') {
    const out = join(root, input(env, 'output') || '_site')
    const issues = await recentIssues(gh, repo, config, now)
    const demo = input(env, 'demo-data')
    if (demo) issues.push(...loadDemo(join(root, demo), now, config.label))
    const files = buildSite(
      issues.map((i) => buildIncident(i, config)),
      config,
      now,
    )
    writeFiles(out, files)
    log(env, 'notice', `status page: ${Object.keys(files).length} files written to ${out}`)
    result.siteChanged = true
  } else if (command === 'report') {
    const days = Number(input(env, 'days') || 30)
    const from = new Date(now.getTime() - days * 86400000)
    const issues = await fetchIncidents(gh, repo, config.label, from)
    const md = reportMarkdown(
      buildReport(
        issues.map((i) => buildIncident(i, config)),
        config,
        from,
        now,
      ),
      config,
    )
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md)
    if (input(env, 'output')) writeFiles(root, { [input(env, 'output')]: md })
  } else if (command === 'handle') {
    await handle(env, gh, repo, config, now, result, fetchImpl)
  } else {
    throw new Error(`unknown command "${command}". Use handle, build-site or report.`)
  }

  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      [
        `incident=${result.incident ?? ''}`,
        `state=${result.state ?? ''}`,
        `site-changed=${result.siteChanged}`,
        `changes=${result.changes.join(',')}`,
      ].join('\n') + '\n',
    )
  }
  return result
}

async function handle(
  env: Env,
  gh: GitHub,
  repo: string,
  config: Config,
  now: Date,
  result: ActionResult,
  fetchImpl: typeof fetch,
) {
  const eventName = env.GITHUB_EVENT_NAME ?? ''
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? '', 'utf8')) as {
    action?: string
    issue?: RawIssue
    comment?: RawComment
  }

  if (eventName === 'schedule' || eventName === 'workflow_dispatch') {
    await reminders(env, gh, repo, config, now, result)
    return
  }
  if (!event.issue || event.issue.pull_request || !isIncidentIssue(event.issue, config)) {
    log(env, 'notice', 'not an incident issue, nothing to do')
    return
  }
  const number = event.issue.number
  result.incident = number
  // Read the issue again: another run may have changed it since this event was created.
  const raw = await gh.request<RawIssue>('GET', `/repos/${repo}/issues/${number}`)
  let issue = toIssue(raw, await gh.all<RawComment>(`/repos/${repo}/issues/${number}/comments`))
  const t = strings(config.lang)
  const reply = async (body: string) => {
    const c = await gh.request<RawComment>('POST', `/repos/${repo}/issues/${number}/comments`, { body })
    result.replies++
    issue = { ...issue, comments: [...issue.comments, toComment(c)] }
  }

  if (eventName === 'issue_comment' && event.comment) {
    const comment = toComment(event.comment)
    if (comment.bot) return
    const parsed = parseCommands(comment.body)
    if (!parsed.commands.length && !parsed.errors.length) return
    if (!isTeam(comment.association)) {
      log(env, 'notice', `@${comment.user} has no write access, commands ignored`)
      return
    }
    if (parsed.commands.some((c) => c.kind === 'help')) await reply(t.help)
    if (parsed.errors.length) await reply(t.errors(parsed.errors))
  } else if (eventName === 'issues' && (event.action === 'closed' || event.action === 'reopened')) {
    // Record the close or reopen in the thread, unless a command already did the same thing.
    const byCommands = buildIncident({ ...issue, state: 'open' }, config).state === 'resolved'
    if (event.action === 'closed' && !byCommands) await reply(`<!-- incident-kit:event closed -->\n${t.closedEvent}`)
    if (event.action === 'reopened' && byCommands)
      await reply(`<!-- incident-kit:event reopened -->\n${t.reopenedEvent}`)
  } else if (eventName !== 'issues') {
    return
  }

  const published = readSnapshot(issue.body)
  if (!published) await ensureLabels(env, gh, repo, config)
  const before: Snapshot = published ?? { state: 'investigating', severity: 3, updates: 0, unconfirmed: true }
  const after = buildIncident(issue, config)
  const changes = diff(before, after)
  result.state = after.state
  result.changes = changes.map((c) => c.kind)
  // Title edits and late form changes also show on the page, so rebuild whenever the incident is public.
  result.siteChanged = changes.length > 0 || isPublic(after, config)

  await sync(env, gh, repo, raw, issue, after, config, now)

  if (after.state === 'resolved' && before.state !== 'resolved') {
    if (issue.state === 'open') {
      await gh.request('PATCH', `/repos/${repo}/issues/${number}`, { state: 'closed', state_reason: 'completed' })
    }
    const pr = config.postmortem.includes(after.severity) ? await postmortem(env, gh, repo, after, config) : undefined
    const start = after.impactStart ?? after.declaredAt
    await reply(
      t.resolvedSummary({
        duration: formatDuration(new Date(after.resolvedAt!).getTime() - new Date(start).getTime(), config.lang),
        tta: after.acknowledgedAt
          ? formatDuration(new Date(after.acknowledgedAt).getTime() - new Date(after.declaredAt).getTime(), config.lang)
          : undefined,
        postmortem: pr === false ? undefined : pr,
      }) +
        (pr === false
          ? `\n\n${t.postmortemFailed}\n\n<details><summary>${postmortemPath(after, config)}</summary>\n\n\`\`\`markdown\n${renderPostmortem(after, config)}\`\`\`\n</details>`
          : ''),
    )
  } else if (after.state !== 'resolved' && issue.state === 'closed') {
    await gh.request('PATCH', `/repos/${repo}/issues/${number}`, { state: 'open' })
  }

  result.notified = await notify(changes, after, config, env, fetchImpl)
  for (const n of result.notified) {
    if (n.skipped) log(env, 'notice', `${n.type}: skipped, ${n.skipped}`)
    else if (!n.ok) log(env, 'warning', `${n.type}: notification failed (${n.status ?? 'network error'})`)
  }
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `#${after.number} ${sevLabel(after.severity, 'en')} · ${after.state}${changes.length ? ` · ${result.changes.join(', ')}` : ''}\n`,
    )
  }
}

/** What changed since the last published snapshot, in the shape notifications want. */
export function diff(before: Snapshot, after: Incident): Change[] {
  if (after.unconfirmed) return []
  const fresh = after.updates.slice(before.updates).filter((u) => u.text)
  const text = fresh.map((u) => u.text).join('\n\n') || undefined
  if (before.unconfirmed) return [{ kind: 'declared', text }]
  const changes: Change[] = []
  if (before.severity !== after.severity) changes.push({ kind: 'severity' })
  if (before.state !== after.state) {
    changes.push({ kind: after.state === 'resolved' ? 'resolved' : 'status', text })
  } else if (text) {
    changes.push({ kind: 'update', text })
  }
  return changes
}

const MANAGED = /^(sev[1-4]|status\/.+|service\/.+)$/

async function sync(
  env: Env,
  gh: GitHub,
  repo: string,
  raw: RawIssue,
  issue: IssueData,
  after: Incident,
  config: Config,
  now: Date,
) {
  const path = `/repos/${repo}/issues/${raw.number}`
  const labels = [
    ...new Set([
      ...issue.labels.filter((l) => !MANAGED.test(l)),
      config.label,
      `sev${after.severity}`,
      `status/${after.state}`,
      ...after.services.map((s) => `service/${s}`),
    ]),
  ]
  if ([...labels].sort().join() !== [...issue.labels].sort().join()) {
    await gh.request('PUT', `${path}/labels`, { labels })
  }

  const assignees = raw.assignees?.map((a) => a.login) ?? []
  if (after.commander && (assignees.length !== 1 || assignees[0] !== after.commander)) {
    try {
      const stale = assignees.filter((a) => a !== after.commander)
      if (stale.length) await gh.request('DELETE', `${path}/assignees`, { assignees: stale })
      await gh.request('POST', `${path}/assignees`, { assignees: [after.commander] })
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      log(
        env,
        'warning',
        `could not assign @${after.commander} (${err.status}). Commanders need access to the repository.`,
      )
    }
  }

  const body = withStatusBlock(issue.body, statusBlock(after, config, now))
  if (body !== issue.body) await gh.request('PATCH', path, { body })
}

async function reminders(env: Env, gh: GitHub, repo: string, config: Config, now: Date, result: ActionResult) {
  const open = (
    await gh.all<RawIssue>(`/repos/${repo}/issues?labels=${encodeURIComponent(config.label)}&state=open`)
  ).filter((i) => !i.pull_request)
  const t = strings(config.lang)
  for (const raw of open) {
    const comments = await gh.all<RawComment>(`/repos/${repo}/issues/${raw.number}/comments`)
    const issue = toIssue(raw, comments)
    const inc = buildIncident(issue, config)
    if (inc.state === 'resolved' || inc.unconfirmed) continue
    if (isPublic(inc, config)) result.siteChanged = true

    const limit = config.reminders[inc.severity]
    if (limit) {
      const lastReminder = issue.comments.filter((c) => c.bot && c.body.includes(REMINDER)).at(-1)?.createdAt
      const quietSince = [inc.lastPublicUpdateAt, lastReminder].filter(Boolean).sort().at(-1)!
      if (now.getTime() - new Date(quietSince).getTime() >= limit * 60000) {
        const who = inc.commander ? `@${inc.commander}` : `@${inc.declaredBy}`
        const minutes = Math.round((now.getTime() - new Date(inc.lastPublicUpdateAt).getTime()) / 60000)
        await gh.request('POST', `/repos/${repo}/issues/${raw.number}/comments`, {
          body: `${REMINDER}\n${t.reminder(who, minutes, sevLabel(inc.severity, config.lang))}`,
        })
        result.replies++
      }
    }
    // Keeps the duration in the status block current.
    const body = withStatusBlock(issue.body, statusBlock(inc, config, now))
    if (body !== issue.body) await gh.request('PATCH', `/repos/${repo}/issues/${raw.number}`, { body })
  }
  log(env, 'notice', `${open.length} open incidents checked, ${result.replies} reminders posted`)
}

/** Opens a pull request with the postmortem draft. Returns its URL, or false when the token is not allowed to. */
async function postmortem(env: Env, gh: GitHub, repo: string, inc: Incident, config: Config): Promise<string | false> {
  const t = strings(config.lang)
  const branch = `incident-kit/postmortem-${inc.number}`
  const path = postmortemPath(inc, config)
  try {
    const { default_branch: base } = await gh.request<{ default_branch: string }>('GET', `/repos/${repo}`)
    const existing = await gh.request<{ html_url: string }[]>(
      'GET',
      `/repos/${repo}/pulls?state=all&head=${encodeURIComponent(`${repo.split('/')[0]}:${branch}`)}`,
    )
    if (existing[0]) return existing[0].html_url
    const head = await gh.request<{ object: { sha: string } }>('GET', `/repos/${repo}/git/ref/heads/${base}`)
    await gh
      .request('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: head.object.sha })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 422)) throw err
      })
    await gh.request('PUT', `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      message: `Add postmortem draft for #${inc.number}`,
      content: Buffer.from(renderPostmortem(inc, config)).toString('base64'),
      branch,
    })
    const pr = await gh.request<{ html_url: string }>('POST', `/repos/${repo}/pulls`, {
      title: t.postmortem.title(inc.number, inc.title),
      head: branch,
      base,
      body: `${t.postmortem.pr(inc.number)}\n\nRefs #${inc.number}`,
    })
    return pr.html_url
  } catch (err) {
    if (!(err instanceof ApiError) || (err.status !== 403 && err.status !== 422)) throw err
    log(env, 'warning', `postmortem pull request failed: ${err.message}`)
    return false
  }
}

async function ensureLabels(env: Env, gh: GitHub, repo: string, config: Config) {
  const have = new Set((await gh.all<{ name: string }>(`/repos/${repo}/labels`)).map((l) => l.name))
  const t = strings(config.lang)
  const want: [string, string, string][] = [
    [config.label, 'b60205', 'Incident managed by incident-kit'],
    ['sev1', 'd1242f', sevLabel(1, config.lang)],
    ['sev2', 'e16f24', sevLabel(2, config.lang)],
    ['sev3', 'bf8700', sevLabel(3, config.lang)],
    ['sev4', '0969da', sevLabel(4, config.lang)],
    ...STATES.map((s): [string, string, string] => [`status/${s}`, 'ededed', t.state[s]]),
    ...config.services.map((s): [string, string, string] => [`service/${s.id}`, 'c5def5', s.name]),
  ]
  for (const [name, color, description] of want) {
    if (have.has(name)) continue
    await gh.request('POST', `/repos/${repo}/labels`, { name, color, description }).catch((err: unknown) => {
      if (!(err instanceof ApiError && err.status === 422)) throw err
    })
  }
  log(env, 'notice', 'labels checked')
}

async function recentIssues(gh: GitHub, repo: string, config: Config, now: Date): Promise<IssueData[]> {
  const recent = await fetchIncidents(gh, repo, config.label, new Date(now.getTime() - 100 * 86400000))
  const open = (
    await gh.all<RawIssue>(`/repos/${repo}/issues?labels=${encodeURIComponent(config.label)}&state=open`)
  ).filter((i) => !i.pull_request && !recent.some((r) => r.number === i.number))
  const old = await Promise.all(
    open.map(async (i) => toIssue(i, await gh.all<RawComment>(`/repos/${repo}/issues/${i.number}/comments`))),
  )
  return [...recent, ...old]
}

function isIncidentIssue(raw: RawIssue, config: Config): boolean {
  const labels = raw.labels.map((l) => (typeof l === 'string' ? l : l.name))
  if (labels.includes(config.label)) return true
  const body = raw.body ?? ''
  return body.includes(BLOCK_START) || parseForm(body, config.services).severity !== undefined
}

export function pagesUrl(repo: string): string | undefined {
  const [owner, name] = repo.split('/')
  if (!owner || !name) return undefined
  const host = `${owner.toLowerCase()}.github.io`
  return name.toLowerCase() === host ? `https://${host}` : `https://${host}/${name}`
}

function writeFiles(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

function log(env: Env, level: 'notice' | 'warning' | 'error', message: string) {
  console.log(env.GITHUB_ACTIONS === 'true' ? `::${level}::${message}` : `${level}: ${message}`)
}
