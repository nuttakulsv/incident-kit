import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseConfig, type Config } from '../src/config.js'
import type { CommentData, IssueData } from '../src/incident.js'

export const CONFIG_YAML = `title: Acme status
lang: en
timezone: Asia/Bangkok
services:
  - id: website
    name: Website
  - id: api
    name: Public API
  - id: payments
    name: Payments
oncall:
  rotation: [alice, bob, carol]
  start: 2026-01-05
  handoff: "10:00"
notifications:
  - type: slack
    webhook: SLACK_URL
    severities: [1, 2]
`

export const config = (extra = ''): Config => parseConfig(CONFIG_YAML + extra)

export const FORM = (sev: number, services: string, extra = '') =>
  `### Severity\n\nSEV${sev} - Major: something\n\n### Affected services\n\n${services}\n\n### Public title\n\n_No response_\n\n### What is happening?\n\nCheckout returns 500${extra}`

let id = 100
export function comment(user: string, at: string, body: string, association = 'MEMBER'): CommentData {
  return { id: id++, user, createdAt: at, body, association }
}

export function issue(over: Partial<IssueData> = {}): IssueData {
  return {
    number: 7,
    title: '[Incident] Checkout errors',
    body: FORM(2, 'Website, Payments'),
    user: 'alice',
    association: 'MEMBER',
    createdAt: '2026-10-03T03:00:00Z',
    state: 'open',
    labels: ['incident'],
    comments: [],
    ...over,
  }
}

export function tempDir(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'incident-kit-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}
