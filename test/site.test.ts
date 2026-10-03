import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ConfigError, loadConfig, parseConfig } from '../src/config.js'
import { loadDemo } from '../src/demo.js'
import { buildIncident } from '../src/incident.js'
import { postmortemPath, renderPostmortem } from '../src/postmortem.js'
import { buildReport, reportMarkdown } from '../src/report.js'
import { buildSite, siteModel } from '../src/site.js'
import { issueForm, sampleConfig, WORKFLOW } from '../src/templates.js'
import { comment, config, issue } from './helpers.js'

const demoDir = new URL('../examples/demo/', import.meta.url).pathname
const now = new Date('2026-10-03T08:30:00Z')
const demoConfig = loadConfig(demoDir)
const demo = loadDemo(`${demoDir}incidents.json`, now).map((i) => buildIncident(i, demoConfig))

describe('status page', () => {
  test('summarises health per service from active incidents', () => {
    const m = siteModel(demo, demoConfig, now)
    expect(m.health).toBe('monitoring')
    expect(m.active.map((i) => i.number)).toEqual([42])
    expect(m.past.map((i) => i.number)).toEqual([37, 31, 24])
    expect(Object.fromEntries(m.services.map((s) => [s.id, s.health]))).toEqual({
      website: 'operational',
      api: 'monitoring',
      payments: 'monitoring',
      line: 'operational',
    })
    const website = m.services.find((s) => s.id === 'website')!
    expect(website.days).toHaveLength(90)
    expect(website.days.filter((d) => d.level).map((d) => [d.day, d.level])).toEqual([
      ['2026-07-24', 2],
      ['2026-09-21', 1],
    ])
    // 65 + 50 minutes of SEV1/2 in 90 days.
    expect(website.majorFree).toBeCloseTo(1 - 115 / (90 * 1440), 6)
  })

  test('writes both languages, the feed and status.json, and escapes HTML', () => {
    const tricky = buildIncident(
      issue({ comments: [comment('carol', '2026-10-03T03:10:00Z', '/update <script>alert(1)</script> & "quotes"')] }),
      config(),
    )
    const files = buildSite([tricky], config(), new Date('2026-10-03T04:00:00Z'))
    expect(Object.keys(files).sort()).toEqual([
      'feed.xml',
      'incidents/7.html',
      'index.html',
      'status.json',
      'style.css',
      'th/feed.xml',
      'th/incidents/7.html',
      'th/index.html',
    ])
    expect(files['index.html']).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;')
    expect(files['index.html']).not.toContain('<script>')
    expect(files['th/index.html']).toContain('<html lang="th">')
    expect(files['th/index.html']).toContain('ขัดข้องบางส่วน')
    expect(files['th/incidents/7.html']).toContain('href="../../style.css"')
    expect(files['incidents/7.html']).toContain('href="../th/incidents/7.html"')
    expect(files['feed.xml']).toContain('<title>[Investigating] Checkout errors</title>')
    expect(JSON.parse(files['status.json']!).status).toEqual({ health: 'partial', description: 'Partial outage' })
  })

  test('hides unconfirmed reports and severities that are not public', () => {
    const sev4 = buildIncident(issue({ body: issue().body.replace('SEV2', 'SEV4') }), config())
    const outside = buildIncident(issue({ number: 8, association: 'NONE' }), config())
    expect(siteModel([sev4, outside], config(), now).active).toEqual([])
  })
})

describe('postmortem', () => {
  test('is prefilled from the incident', () => {
    const inc = demo.find((i) => i.number === 37)!
    expect(postmortemPath(inc, demoConfig)).toBe(
      'docs/postmortems/2026-09-21-37-website-down-after-cdn-certificate-expired.md',
    )
    const md = renderPostmortem(inc, demoConfig)
    expect(md).toContain('# Postmortem: Website down after CDN certificate expired (#37)')
    expect(md).toContain('| Severity | SEV1 Critical |')
    expect(md).toMatch(/\| People involved \| @mint, @aek(, @\w+)? \|/)
    expect(md).toContain('noted: Auto-renew was disabled during the DNS migration in March.')
    expect(renderPostmortem(inc, { ...demoConfig, lang: 'th' })).toContain('## สิ่งที่ต้องทำต่อ')
  })
})

describe('report', () => {
  test('MTTA, MTTR and counts', () => {
    const r = buildReport(demo, demoConfig, new Date(now.getTime() - 90 * 86400000), now)
    expect(r).toMatchObject({ total: 4, open: 1, bySeverity: { 1: 1, 2: 2, 3: 1, 4: 0 } })
    // #24 50 min, #31 90 min, #37 65 min from declaration to resolution.
    expect(r.mttrMinutes).toBeCloseTo((50 + 90 + 65) / 3)
    expect(r.medianTtrMinutes).toBe(65)
    // #42 was declared by ploy while mint was on call; nont acknowledged after 6 minutes.
    expect(r.incidents.find((i) => i.number === 42)).toMatchObject({ ttrMinutes: undefined })
    expect(reportMarkdown(r, demoConfig)).toContain('| Incidents | 4 (1 still open) |')
  })
})

describe('config', () => {
  test('lists every problem at once', () => {
    let error: unknown
    try {
      parseConfig(
        'lang: fr\ntimezone: Mars/Base\nservices:\n  - id: Web Site\n  - id: api\n  - id: api\nnotifications:\n  - type: email\n  - type: slack\n',
      )
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ConfigError)
    expect((error as ConfigError).problems).toEqual([
      'lang must be en or th',
      'timezone "Mars/Base" is not a known IANA time zone',
      'services[0].id "Web Site" may only use a-z, 0-9 and -',
      'services[2].id "api" is used twice',
      'notifications[0].type must be slack, discord, teams, line or webhook',
      'notifications[1] (slack) needs webhook: the name of an environment variable',
    ])
  })

  test('the shipped template matches what init generates', () => {
    const root = new URL('../template/', import.meta.url).pathname
    const read = (p: string) => readFileSync(root + p, 'utf8')
    expect(read('incident-kit.yml')).toBe(sampleConfig('en'))
    expect(read('.github/ISSUE_TEMPLATE/incident.yml')).toBe(issueForm(parseConfig(read('incident-kit.yml'))))
    expect(read('.github/workflows/incident-kit.yml')).toBe(WORKFLOW)
  })
})
