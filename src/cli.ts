#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pagesUrl } from './action.js'
import { CONFIG_FILE, ConfigError, loadConfig, parseConfig, type Config, type Lang } from './config.js'
import { loadDemo } from './demo.js'
import { fetchIncidents, github } from './github.js'
import { buildIncident, type IssueData } from './incident.js'
import { schedule } from './oncall.js'
import { buildReport, reportMarkdown } from './report.js'
import { buildSite } from './site.js'
import { issueForm, postmortemReadme, sampleConfig, WORKFLOW } from './templates.js'
import { formatDateTime } from './time.js'
import { VERSION } from './version.js'

const HELP = `incident-kit ${VERSION}

Usage
  incident-kit init [--lang en|th]          add the config, issue form, workflow and postmortem folder to this repo
  incident-kit validate                     check incident-kit.yml and that the issue form matches it
  incident-kit oncall [--weeks 8]           print the on-call schedule
  incident-kit build-site [--out _site]     build the status page
  incident-kit report [--days 30] [--json]  MTTA, MTTR and incident counts

Data for build-site and report
  --repo owner/name   read incident issues from GitHub (token from GITHUB_TOKEN, GH_TOKEN or the gh CLI)
  --demo file.json    use demo incidents instead (see examples/demo)

Common options
  --config path       config file (default incident-kit.yml)
  -C, --cwd dir       run as if started in dir
  --now iso           pretend the current time is iso
  -h, --help          show this help
  -v, --version       print the version
`

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      cwd: { type: 'string', short: 'C' },
      lang: { type: 'string' },
      weeks: { type: 'string' },
      out: { type: 'string' },
      repo: { type: 'string' },
      demo: { type: 'string' },
      days: { type: 'string' },
      json: { type: 'boolean' },
      now: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  const cmd = positionals[0]
  if (values.version) return print(VERSION)
  if (values.help || !cmd) return print(HELP)
  const root = resolve(values.cwd ?? '.')
  const now = values.now ? new Date(values.now) : new Date()
  if (Number.isNaN(now.getTime())) throw new Error(`--now "${values.now}" is not a date`)

  if (cmd === 'init') return init(root, values.lang === 'th' ? 'th' : 'en')

  const config = loadConfig(root, values.config)
  config.url ??= values.repo ? pagesUrl(values.repo) : undefined

  switch (cmd) {
    case 'validate': {
      const formPath = join(root, '.github/ISSUE_TEMPLATE/incident.yml')
      if (!existsSync(formPath)) return fail(`${formPath} is missing. Run \`incident-kit init\`.`)
      if (readFileSync(formPath, 'utf8') !== issueForm(config)) {
        return fail(
          '.github/ISSUE_TEMPLATE/incident.yml does not match incident-kit.yml. Run `incident-kit init` to regenerate it.',
        )
      }
      return print(
        `ok: ${config.services.length} services${config.oncall ? `, ${config.oncall.rotation.length} on the rotation` : ''}, ${config.notifications.length} notification targets`,
      )
    }
    case 'oncall': {
      if (!config.oncall) return fail('no oncall section in incident-kit.yml')
      const shifts = schedule(config.oncall, now, Number(values.weeks ?? 8), config.timezone)
      const when = (d: Date) => formatDateTime(d, config.lang, config.timezone)
      return print(shifts.map((s) => `${when(s.from).padEnd(22)} → ${when(s.to).padEnd(22)}  @${s.user}`).join('\n'))
    }
    case 'build-site': {
      const issues = await data(values.repo, values.demo, root, config, now, 100)
      const files = buildSite(
        issues.map((i) => buildIncident(i, config)),
        config,
        now,
      )
      const out = resolve(root, values.out ?? '_site')
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(out, path)), { recursive: true })
        writeFileSync(join(out, path), content)
      }
      return print(`${Object.keys(files).length} files written to ${out}`)
    }
    case 'report': {
      const days = Number(values.days ?? 30)
      const from = new Date(now.getTime() - days * 86400000)
      const issues = await data(values.repo, values.demo, root, config, now, days)
      const report = buildReport(
        issues.map((i) => buildIncident(i, config)),
        config,
        from,
        now,
      )
      return print(values.json ? JSON.stringify(report, null, 2) : reportMarkdown(report, config))
    }
    default:
      return fail(`unknown command "${cmd}"\n\n${HELP}`)
  }
}

async function data(
  repo: string | undefined,
  demo: string | undefined,
  root: string,
  config: Config,
  now: Date,
  days: number,
): Promise<IssueData[]> {
  if (demo) return loadDemo(resolve(root, demo), now, config.label)
  if (!repo) throw new Error('pass --repo owner/name to read incidents from GitHub, or --demo file.json')
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ghToken()
  if (!token) throw new Error('no GitHub token: set GITHUB_TOKEN or log in with `gh auth login`')
  return fetchIncidents(github(token), repo, config.label, new Date(now.getTime() - days * 86400000))
}

function ghToken(): string | undefined {
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

function init(root: string, lang: Lang): number {
  const configPath = join(root, CONFIG_FILE)
  const wrote: string[] = []
  const write = (path: string, content: string, overwrite = false) => {
    const full = join(root, path)
    if (existsSync(full) && (!overwrite || readFileSync(full, 'utf8') === content)) return
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
    wrote.push(path)
  }
  if (!existsSync(configPath)) write(CONFIG_FILE, sampleConfig(lang))
  const config: Config = parseConfig(readFileSync(configPath, 'utf8'))
  write('.github/ISSUE_TEMPLATE/incident.yml', issueForm(config), true)
  write('.github/workflows/incident-kit.yml', WORKFLOW)
  write(`${config.postmortemDir}/README.md`, postmortemReadme(config.lang))
  print(wrote.length ? wrote.map((p) => `wrote ${p}`).join('\n') : 'everything is up to date')
  if (wrote.includes(CONFIG_FILE)) {
    print(`\nNext: edit ${CONFIG_FILE} (services, oncall), run \`incident-kit init\` again to refresh the issue form,
then enable GitHub Pages with "GitHub Actions" as the source and commit.`)
  }
  return 0
}

function print(text: string): number {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
  return 0
}

function fail(text: string): number {
  process.stderr.write(`${text}\n`)
  return 1
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof ConfigError || err instanceof Error ? err.message : String(err)}\n`)
    process.exit(2)
  },
)
