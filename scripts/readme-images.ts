// Draws docs/images/hero(.th).png: the incident issue next to the status page, from the demo data at a fixed time.
import { mkdirSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { loadConfig, type Config, type Lang } from '../src/config.js'
import { loadDemo } from '../src/demo.js'
import { sevLabel, strings } from '../src/i18n.js'
import { buildIncident } from '../src/incident.js'
import { describe, serviceNames } from '../src/render.js'
import { siteModel, type Health } from '../src/site.js'
import { formatDateTime, formatDuration, formatTime } from '../src/time.js'

const root = new URL('../', import.meta.url).pathname
const demoFile = (lang: Lang) => `${root}examples/demo/incidents${lang === 'th' ? '.th' : ''}.json`
const now = new Date('2026-10-03T08:30:00Z')

const C = {
  text: '#1f2328',
  muted: '#59636e',
  line: '#d1d9e0',
  soft: '#f6f8fa',
  green: '#1a7f37',
  blue: '#0969da',
  yellow: '#9a6700',
  orange: '#e16f24',
  red: '#d1242f',
}
const HEALTH: Record<Health, string> = {
  operational: C.green,
  monitoring: C.blue,
  degraded: '#bf8700',
  partial: C.orange,
  major: C.red,
}
const SANS = `font-family="Helvetica Neue, Helvetica, Sukhumvit Set, Thonburi, sans-serif"`
const MONO = `font-family="Menlo, SF Mono, monospace"`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Rough advance widths, good enough to wrap and truncate. Thai marks above and below take no space.
const width = (s: string, size: number) =>
  Array.from(s).reduce((w, ch) => {
    if (/[ัิ-ฺ็-๎]/.test(ch)) return w
    if (/[ilj.,:'|!]/.test(ch)) return w + size * 0.28
    if (/[A-Z@#%MW]/.test(ch)) return w + size * 0.66
    return w + size * 0.53
  }, 0)

function wrap(s: string, size: number, max: number, mono = false): string[] {
  const measure = (x: string) => (mono ? Array.from(x).length * size * 0.61 : width(x, size))
  const lines: string[] = []
  let line = ''
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (measure(next) > max && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function fit(s: string, size: number, max: number): string {
  if (width(s, size) <= max) return s
  let out = s
  while (out.length && width(out + '…', size) > max) out = out.slice(0, -1)
  return out.trimEnd() + '…'
}

const text = (
  x: number,
  y: number,
  s: string,
  o: { size?: number; fill?: string; weight?: number; mono?: boolean; anchor?: string } = {},
) =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 15}" fill="${o.fill ?? C.text}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''} ${o.mono ? MONO : SANS}>${esc(s)}</text>`
const rect = (x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; r?: number } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r ?? 0}" fill="${o.fill ?? 'none'}"${o.stroke ? ` stroke="${o.stroke}"` : ''}/>`

function pill(x: number, y: number, label: string, color: string): [string, number] {
  const w = width(label, 12) + 18
  return [
    `${rect(x, y, w, 22, { fill: color + '22', stroke: color + '66', r: 11 })}${text(x + 9, y + 15.5, label, { size: 12, fill: color, weight: 600 })}`,
    w,
  ]
}

function issuePanel(config: Config, lang: Lang, x0: number, W: number): [string, number] {
  const t = strings(lang)
  const cfg = { ...config, lang }
  const demo = loadDemo(demoFile(lang), now)
  const raw = demo.find((i) => i.number === 42)!
  const inc = buildIncident(raw, cfg)
  const out: string[] = []
  let y = 40

  out.push(
    text(x0, y + 8, fit(raw.title, 24, W - 70), { size: 24 }),
    text(x0 + Math.min(width(raw.title, 24), W - 70) + 10, y + 8, '#42', { size: 24, fill: C.muted }),
  )
  y += 30
  const [open, ow] = pill(x0, y, 'Open', C.green)
  out.push(open)
  let lx = x0 + ow + 10
  for (const [label, color] of [
    ['incident', C.red],
    [`sev${inc.severity}`, C.orange],
    [`status/${inc.state}`, C.muted],
    ...inc.services.map((s) => [`service/${s}`, C.blue]),
  ] as [string, string][]) {
    const [p, w] = pill(lx, y, label, color)
    out.push(p)
    lx += w + 6
  }
  y += 44

  // The issue body with the status block.
  const bodyTop = y
  const pad = 20
  const inner = W - pad * 2
  const rows: [string, string][] = [
    [t.block.services, serviceNames(inc, cfg).join(', ')],
    [t.block.declared, formatDateTime(inc.declaredAt, lang, cfg.timezone)],
    [
      t.block.acknowledged,
      `${formatTime(inc.acknowledgedAt!, lang, cfg.timezone)} (${t.block.after} ${formatDuration(new Date(inc.acknowledgedAt!).getTime() - new Date(inc.declaredAt).getTime(), lang)})`,
    ],
    [
      t.block.duration,
      `${formatDuration(now.getTime() - new Date(inc.declaredAt).getTime(), lang)} (${t.block.ongoing})`,
    ],
    [t.block.lastUpdate, formatTime(inc.lastPublicUpdateAt, lang, cfg.timezone)],
  ]
  const entries = inc.timeline.slice(-7)
  let by = bodyTop + 44
  const body: string[] = []
  body.push(
    text(x0 + pad, bodyTop + 28, `${inc.declaredBy}`, { size: 14, weight: 600 }),
    text(
      x0 + pad + width(inc.declaredBy, 14) + 6,
      bodyTop + 28,
      lang === 'th' ? 'เปิด issue นี้' : 'opened this issue',
      { size: 14, fill: C.muted },
    ),
  )
  // Alert box
  const alertH = 58
  body.push(rect(x0 + pad, by, 4, alertH, { fill: C.yellow }))
  body.push(
    text(x0 + pad + 16, by + 22, lang === 'th' ? 'คำเตือน' : 'Warning', { size: 14, fill: C.yellow, weight: 600 }),
  )
  body.push(
    text(
      x0 + pad + 16,
      by + 46,
      `${sevLabel(inc.severity, lang)} · ${t.state[inc.state]} · ${t.block.commander} @${inc.commander}`,
      { size: 15, weight: 700 },
    ),
  )
  by += alertH + 18
  const keyW = 190
  for (const [i, [k, v]] of rows.entries()) {
    body.push(rect(x0 + pad, by, inner, 34, { fill: i % 2 ? C.soft : '#fff', stroke: C.line }))
    body.push(
      text(x0 + pad + 12, by + 22, k, { size: 14, weight: 600 }),
      text(x0 + pad + keyW, by + 22, fit(v, 14, inner - keyW - 12), { size: 14 }),
    )
    by += 34
  }
  by += 26
  body.push(text(x0 + pad, by, t.block.timeline, { size: 15, weight: 700 }))
  by += 14
  for (const e of entries) {
    const line = describe(e, cfg, inc)
    body.push(text(x0 + pad, by + 22, formatTime(e.at, lang, cfg.timezone), { size: 13, fill: C.muted, mono: true }))
    body.push(text(x0 + pad + 64, by + 22, `@${e.actor}`, { size: 14, weight: 600 }))
    body.push(text(x0 + pad + 140, by + 22, fit(line, 14, inner - 140), { size: 14 }))
    body.push(`<line x1="${x0 + pad}" x2="${x0 + pad + inner}" y1="${by + 32}" y2="${by + 32}" stroke="${C.line}"/>`)
    by += 32
  }
  by += 18
  out.push(
    rect(x0, bodyTop, W, by - bodyTop, { fill: '#fff', stroke: C.line, r: 8 }),
    rect(x0, bodyTop, W, 42, { fill: C.soft, stroke: C.line, r: 8 }),
    ...body,
  )
  y = by + 22

  // The comment that moved it to monitoring.
  const last = raw.comments.at(-1)!
  const lines = last.body.split('\n').flatMap((l) => wrap(l, 13.5, W - pad * 2, true))
  const ch = 52 + lines.length * 21 + 18
  out.push(
    rect(x0, y, W, ch, { fill: '#fff', stroke: C.line, r: 8 }),
    rect(x0, y, W, 42, { fill: C.soft, stroke: C.line, r: 8 }),
  )
  out.push(
    text(x0 + pad, y + 27, last.user, { size: 14, weight: 600 }),
    text(x0 + pad + width(last.user, 14) + 6, y + 27, lang === 'th' ? 'แสดงความคิดเห็น' : 'commented', {
      size: 14,
      fill: C.muted,
    }),
  )
  lines.forEach((l, i) =>
    out.push(text(x0 + pad, y + 70 + i * 21, l, { size: 13.5, mono: true, fill: l.startsWith('/') ? C.blue : C.text })),
  )
  y += ch
  return [out.join('\n'), y]
}

function statusPanel(config: Config, lang: Lang, x0: number, W: number): [string, number] {
  const t = strings(lang)
  const cfg = { ...config, lang }
  const incidents = loadDemo(demoFile(lang), now).map((i) => buildIncident(i, cfg))
  const m = siteModel(incidents, cfg, now)
  const out: string[] = []
  let y = 40
  out.push(text(x0 + 28, y + 26, lang === 'th' ? 'สถานะระบบ Acme Shop' : cfg.title, { size: 26, weight: 700 }))
  out.push(
    text(x0 + 28, y + 52, lang === 'th' ? 'สถานะการให้บริการของ Acme Shop' : (cfg.description ?? ''), {
      size: 14,
      fill: C.muted,
    }),
  )
  y += 76
  out.push(rect(x0 + 28, y, W - 56, 58, { fill: HEALTH[m.health], r: 10 }))
  out.push(text(x0 + 48, y + 36, t.overall[m.health], { size: 19, fill: '#fff', weight: 700 }))
  y += 84

  out.push(text(x0 + 28, y, t.page.active.toUpperCase(), { size: 12, fill: C.muted, weight: 700 }))
  y += 14
  const inc = m.active[0]!
  const updates = [...inc.updates].reverse().slice(0, 3)
  const cardTop = y
  const inner = W - 56 - 40
  let cy = y + 32
  const card: string[] = []
  card.push(text(x0 + 52, cy, fit(inc.publicTitle, 17, inner), { size: 17, weight: 700 }))
  cy += 22
  const span = formatDuration(now.getTime() - new Date(inc.declaredAt).getTime(), lang)
  card.push(
    text(
      x0 + 52,
      cy,
      fit(
        `${sevLabel(inc.severity, lang)} · ${t.page.affects} ${serviceNames(inc, cfg).join(', ')} · ${t.page.ongoingFor(span)}`,
        13,
        inner,
      ),
      { size: 13, fill: C.muted },
    ),
  )
  cy += 14
  for (const u of updates) {
    cy += 26
    card.push(
      text(x0 + 52, cy, t.state[u.state], { size: 14, weight: 700 }),
      text(x0 + 52 + width(t.state[u.state], 14) + 10, cy, formatTime(u.at, lang, cfg.timezone), {
        size: 13,
        fill: C.muted,
      }),
    )
    for (const l of wrap(u.text ?? t.defaultUpdate[u.state], 14, inner)) {
      cy += 20
      card.push(text(x0 + 52, cy, l, { size: 14 }))
    }
  }
  cy += 20
  out.push(
    rect(x0 + 28, cardTop, W - 56, cy - cardTop, { fill: '#fff', stroke: C.line, r: 10 }),
    rect(x0 + 28, cardTop, 5, cy - cardTop, { fill: C.orange, r: 2 }),
    ...card,
  )
  y = cy + 34

  out.push(text(x0 + 28, y, t.page.services.toUpperCase(), { size: 12, fill: C.muted, weight: 700 }))
  y += 14
  const svcTop = y
  const svc: string[] = []
  let sy = y + 8
  for (const s of m.services) {
    sy += 22
    svc.push(
      text(x0 + 48, sy, s.name, { size: 15, weight: 600 }),
      text(x0 + W - 48, sy, t.service[s.health], { size: 13, weight: 700, fill: HEALTH[s.health], anchor: 'end' }),
    )
    sy += 10
    const bw = (W - 96 - 89 * 2) / 90
    s.days.forEach((d, i) => {
      const color = d.level === 1 ? C.red : d.level === 2 ? C.orange : d.level ? '#bf8700' : C.green
      svc.push(rect(x0 + 48 + i * (bw + 2), sy, bw, 26, { fill: color, r: 1.5 }))
    })
    sy += 44
    svc.push(
      text(x0 + 48, sy, t.page.daysAgo, { size: 11.5, fill: C.muted }),
      text(x0 + W - 48, sy, t.page.today, { size: 11.5, fill: C.muted, anchor: 'end' }),
      text(x0 + W / 2, sy, t.page.incidentFree(`${(Math.floor(s.majorFree * 10000) / 100).toFixed(2)}%`), {
        size: 11.5,
        fill: C.muted,
        anchor: 'middle',
      }),
    )
    sy += 14
  }
  sy += 8
  out.push(rect(x0 + 28, svcTop, W - 56, sy - svcTop, { fill: '#fff', stroke: C.line, r: 10 }), ...svc)
  return [out.join('\n'), sy]
}

function hero(lang: Lang): string {
  const config = loadConfig(`${root}examples/demo`)
  const W = 1640
  const left = 760
  const [issue, ih] = issuePanel(config, lang, 40, left)
  const [status, sh] = statusPanel(config, lang, 840, 760)
  const H = Math.max(ih, sh) + 40
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${rect(0, 0, W, H, { fill: '#ffffff' })}
${rect(820, 0, W - 820, H, { fill: C.soft })}
<line x1="820" x2="820" y1="0" y2="${H}" stroke="${C.line}"/>
${issue}
${status}
</svg>`
}

mkdirSync(`${root}docs/images`, { recursive: true })
for (const lang of ['en', 'th'] as const) {
  const svg = hero(lang)
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1640 },
    font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica Neue' },
  })
    .render()
    .asPng()
  const name = lang === 'en' ? 'hero' : 'hero.th'
  writeFileSync(`${root}docs/images/${name}.png`, png)
  console.log(`docs/images/${name}.png ${(png.length / 1024).toFixed(0)} KB`)
}
