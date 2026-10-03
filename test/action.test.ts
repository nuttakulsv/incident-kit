import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'
import { run } from '../src/action.js'
import { readSnapshot } from '../src/incident.js'
import { FakeGitHub } from './fake-github.js'
import { CONFIG_YAML, FORM, tempDir } from './helpers.js'

function setup(extraConfig = '') {
  const gh = new FakeGitHub()
  let now = new Date('2026-10-03T03:00:00Z')
  gh.clock = () => now.toISOString()
  const root = tempDir({ 'incident-kit.yml': CONFIG_YAML + extraConfig, 'summary.md': '', 'output.txt': '' })
  const env = (event: string, payload: unknown) => {
    writeFileSync(join(root, 'event.json'), JSON.stringify(payload))
    return {
      GITHUB_EVENT_NAME: event,
      GITHUB_EVENT_PATH: join(root, 'event.json'),
      GITHUB_REPOSITORY: gh.repo,
      GITHUB_WORKSPACE: root,
      GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
      GITHUB_OUTPUT: join(root, 'output.txt'),
      'INPUT_GITHUB-TOKEN': 'token',
      SLACK_URL: 'https://hooks.slack.com/services/T/B/x',
    }
  }
  const at = (iso: string) => (now = new Date(iso))
  const say = (n: number, user: string, body: string, association = 'MEMBER') => {
    const comment = gh.addComment(n, user, body, association)
    return run(env('issue_comment', { action: 'created', issue: gh.issues.get(n), comment }), gh.fetch, now)
  }
  return { gh, root, env, at, say, now: () => now }
}

describe('action', () => {
  test('declare, update, resolve: labels, status block, notifications and postmortem PR', async () => {
    const s = setup()
    const issue = s.gh.openIssue({ number: 7, body: FORM(2, 'Website, Payments') })

    const opened = await run(s.env('issues', { action: 'opened', issue }), s.gh.fetch, s.now())
    expect(opened).toMatchObject({ incident: 7, state: 'investigating', changes: ['declared'], siteChanged: true })
    expect(s.gh.labels).toContain('sev2')
    expect(s.gh.labels).toContain('service/payments')
    const names = () => s.gh.issues.get(7)!.labels.map((l) => (typeof l === 'string' ? l : l.name))
    expect(names()).toEqual(['incident', 'sev2', 'status/investigating', 'service/website', 'service/payments'])
    expect(s.gh.issues.get(7)!.assignees).toEqual([{ login: 'carol' }])
    expect(s.gh.issues.get(7)!.body).toContain('**SEV2 Major · Investigating** · Commander @carol')
    expect(s.gh.hooks).toHaveLength(1)
    expect(JSON.stringify(s.gh.hooks[0]!.body)).toContain('New SEV2 Major incident: Checkout errors (#7)')
    expect(readFileSync(join(s.root, 'output.txt'), 'utf8')).toContain('changes=declared')

    // Editing the issue later does not notify again.
    const edited = await run(s.env('issues', { action: 'edited', issue: s.gh.issues.get(7) }), s.gh.fetch, s.now())
    expect(edited.changes).toEqual([])
    expect(s.gh.hooks).toHaveLength(1)

    s.at('2026-10-03T03:20:00Z')
    const r1 = await s.say(
      7,
      'carol',
      '/status identified\n/update We found a bad config change and are rolling it back.',
    )
    expect(r1.changes).toEqual(['status'])
    expect(names()).toContain('status/identified')
    expect(JSON.stringify(s.gh.hooks.at(-1)!.body)).toContain('rolling it back')

    s.at('2026-10-03T03:25:00Z')
    const chat = await s.say(7, 'bob', 'I can help with the rollback')
    expect(chat.changes).toEqual([])

    const stranger = await s.say(7, 'mallory', '/status resolved', 'NONE')
    expect(stranger.changes).toEqual([])
    expect(s.gh.issues.get(7)!.state).toBe('open')

    s.at('2026-10-03T03:30:00Z')
    const bad = await s.say(7, 'carol', '/status fixed')
    expect(bad.replies).toBe(1)
    expect(s.gh.comments.get(7)!.at(-1)!.body).toContain('is not a state')

    s.at('2026-10-03T04:05:00Z')
    const done = await s.say(7, 'carol', '/status resolved\n/update Payments are back to normal.')
    expect(done).toMatchObject({ state: 'resolved', changes: ['resolved'] })
    expect(s.gh.issues.get(7)!.state).toBe('closed')
    expect(s.gh.pulls).toHaveLength(1)
    expect(s.gh.pulls[0]).toMatchObject({
      head: 'incident-kit/postmortem-7',
      base: 'main',
      title: 'Postmortem: Checkout errors (#7)',
    })
    const file = s.gh.files.get('incident-kit/postmortem-7:docs/postmortems/2026-10-03-7-checkout-errors.md')
    expect(file).toContain('| 3 Oct 2026, 10:20 | @carol | changed the status to Identified |')
    const summary = s.gh.comments.get(7)!.at(-1)!.body
    expect(summary).toContain('**Resolved.** Duration 1 h 5 min, acknowledged after 20 min.')
    expect(summary).toContain('https://github.com/acme/status/pull/50')
    expect(readSnapshot(s.gh.issues.get(7)!.body ?? '')).toEqual({
      state: 'resolved',
      severity: 2,
      updates: 3,
      unconfirmed: false,
    })
  })

  test('closing the issue by hand resolves it; reopening starts it again', async () => {
    const s = setup()
    const issue = s.gh.openIssue({ number: 8, body: FORM(3, 'Website') })
    await run(s.env('issues', { action: 'opened', issue }), s.gh.fetch, s.now())

    s.at('2026-10-03T03:40:00Z')
    s.gh.issues.get(8)!.state = 'closed'
    s.gh.issues.get(8)!.closed_at = s.now().toISOString()
    const closed = await run(s.env('issues', { action: 'closed', issue: s.gh.issues.get(8) }), s.gh.fetch, s.now())
    expect(closed).toMatchObject({ state: 'resolved', changes: ['resolved'] })
    // SEV3 is not in the postmortem list.
    expect(s.gh.pulls).toHaveLength(0)

    s.at('2026-10-03T04:00:00Z')
    s.gh.issues.get(8)!.state = 'open'
    s.gh.issues.get(8)!.closed_at = null
    const reopened = await run(s.env('issues', { action: 'reopened', issue: s.gh.issues.get(8) }), s.gh.fetch, s.now())
    expect(reopened).toMatchObject({ state: 'investigating', changes: ['status'] })
  })

  test('an outside report stays quiet until the team confirms it', async () => {
    const s = setup()
    const issue = s.gh.openIssue({ number: 9, body: FORM(1, 'Website'), user: 'customer', association: 'NONE' })
    const opened = await run(s.env('issues', { action: 'opened', issue }), s.gh.fetch, s.now())
    expect(opened).toMatchObject({ changes: [], siteChanged: false })
    expect(s.gh.hooks).toHaveLength(0)
    expect(s.gh.issues.get(9)!.body).toContain('Reported by someone outside the team')

    s.at('2026-10-03T03:10:00Z')
    const confirmed = await s.say(9, 'bob', '/sev 2\n/services website')
    expect(confirmed.changes).toEqual(['declared'])
    expect(s.gh.hooks).toHaveLength(1)
  })

  test('the postmortem draft lands in a comment when PRs are not allowed', async () => {
    const s = setup()
    s.gh.denyPulls = true
    const issue = s.gh.openIssue({ number: 10, body: FORM(1, 'Public API') })
    await run(s.env('issues', { action: 'opened', issue }), s.gh.fetch, s.now())
    s.at('2026-10-03T03:30:00Z')
    await s.say(10, 'carol', '/resolve')
    const last = s.gh.comments.get(10)!.at(-1)!.body
    expect(last).toContain('Allow GitHub Actions to create pull requests')
    expect(last).toContain('# Postmortem: Checkout errors (#10)')
  })

  test('/help answers with the command list', async () => {
    const s = setup()
    const issue = s.gh.openIssue({ number: 11, body: FORM(2, 'Website') })
    await run(s.env('issues', { action: 'opened', issue }), s.gh.fetch, s.now())
    await s.say(11, 'alice', '/help')
    expect(s.gh.comments.get(11)!.at(-1)!.body).toContain('| `/update <message>` |')
  })

  test('scheduled run reminds a quiet SEV1/2 commander once per interval', async () => {
    const s = setup()
    const issue = s.gh.openIssue({ number: 12, body: FORM(1, 'Website') })
    await run(s.env('issues', { action: 'opened', issue }), s.gh.fetch, s.now())

    s.at('2026-10-03T03:10:00Z')
    const early = await run(s.env('schedule', { schedule: '*/30 * * * *' }), s.gh.fetch, s.now())
    expect(early.replies).toBe(0)

    s.at('2026-10-03T03:16:00Z')
    const late = await run(s.env('schedule', {}), s.gh.fetch, s.now())
    expect(late.replies).toBe(1)
    expect(s.gh.comments.get(12)!.at(-1)!.body).toContain(
      '@carol this SEV1 Critical incident has had no public update for 16 minutes',
    )

    s.at('2026-10-03T03:20:00Z')
    expect((await run(s.env('schedule', {}), s.gh.fetch, s.now())).replies).toBe(0)
    s.at('2026-10-03T03:32:00Z')
    expect((await run(s.env('schedule', {}), s.gh.fetch, s.now())).replies).toBe(1)
  })

  test('build-site writes the status page from incident issues plus demo data', async () => {
    const s = setup()
    const issue = s.gh.openIssue({ number: 13, body: FORM(2, 'Payments') })
    await run(s.env('issues', { action: 'opened', issue }), s.gh.fetch, s.now())
    writeFileSync(join(s.root, 'demo.json'), JSON.stringify({ incidents: [] }))
    const env = { ...s.env('workflow_dispatch', {}), INPUT_COMMAND: 'build-site', 'INPUT_DEMO-DATA': 'demo.json' }
    await run(env, s.gh.fetch, s.now())
    const html = readFileSync(join(s.root, '_site/index.html'), 'utf8')
    expect(html).toContain('Partial outage')
    expect(existsSync(join(s.root, '_site/th/index.html'))).toBe(true)
    const status = JSON.parse(readFileSync(join(s.root, '_site/status.json'), 'utf8'))
    expect(status.page.url).toBe('https://acme.github.io/status')
    expect(status.active[0].number).toBe(13)
  })
})

describe('bundled action', () => {
  test('action/index.cjs runs against an HTTP GitHub API', async () => {
    const bundle = new URL('../action/index.cjs', import.meta.url).pathname
    if (!existsSync(bundle)) return
    const s = setup()
    const issue = s.gh.openIssue({ number: 20, body: FORM(2, 'Website') })
    const { url, server } = await s.gh.listen()
    try {
      const env = {
        ...process.env,
        ...s.env('issues', { action: 'opened', issue }),
        GITHUB_API_URL: url,
        SLACK_URL: '',
      }
      const { stdout } = await promisify(execFile)(process.execPath, [bundle], { env })
      expect(stdout).toContain('incident-kit handle: #20 investigating (declared)')
      expect(s.gh.issues.get(20)!.body).toContain('<!-- incident-kit:status -->')
      expect(stdout).toContain('slack: skipped, SLACK_URL is not set')
    } finally {
      server.close()
    }
  })
})
