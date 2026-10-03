import type { Config, Lang, Level } from './config.js'
import { sevLabel, strings } from './i18n.js'
import { isPublic, type Incident, type PublicUpdate } from './incident.js'
import { serviceNames } from './render.js'
import { formatDate, formatDateTime, formatDuration, localDay } from './time.js'

export type Health = 'operational' | 'degraded' | 'partial' | 'major' | 'monitoring'

const DAYS = 90
const HEALTH_BY_LEVEL: Record<Level, Health> = { 1: 'major', 2: 'partial', 3: 'degraded', 4: 'degraded' }
const RANK: Record<Health, number> = { operational: 0, monitoring: 1, degraded: 2, partial: 3, major: 4 }
const worst = (hs: Health[]) => hs.reduce<Health>((a, b) => (RANK[b] > RANK[a] ? b : a), 'operational')

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const paragraphs = (s: string) =>
  esc(s)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')

export function healthOf(active: Incident[]): Health {
  return worst(active.map((i) => (i.state === 'monitoring' ? 'monitoring' : HEALTH_BY_LEVEL[i.severity])))
}

const affects = (inc: Incident, serviceId: string) => inc.services.includes(serviceId)
const start = (inc: Incident) => new Date(inc.impactStart ?? inc.declaredAt).getTime()
const end = (inc: Incident, now: Date) => (inc.resolvedAt ? new Date(inc.resolvedAt) : now).getTime()

export interface ServiceView {
  id: string
  name: string
  description?: string
  health: Health
  days: { day: string; level?: Level; incidents: Incident[] }[]
  /** Share of the last 90 days without a SEV1 or SEV2 incident on this service. */
  majorFree: number
}

export interface SiteModel {
  health: Health
  active: Incident[]
  past: Incident[]
  services: ServiceView[]
  now: Date
}

export function siteModel(incidents: Incident[], config: Config, now: Date): SiteModel {
  const visible = incidents.filter((i) => isPublic(i, config) && new Date(i.declaredAt) <= now)
  const active = visible.filter((i) => i.state !== 'resolved').sort((a, b) => a.severity - b.severity)
  const windowStart = now.getTime() - DAYS * 86400000
  const recent = visible.filter((i) => end(i, now) >= windowStart)
  const past = recent.filter((i) => i.state === 'resolved').sort((a, b) => b.declaredAt.localeCompare(a.declaredAt))

  const dayList: string[] = []
  for (let d = DAYS - 1; d >= 0; d--) {
    const day = localDay(new Date(now.getTime() - d * 86400000), config.timezone)
    if (!dayList.includes(day)) dayList.push(day)
  }

  const services = config.services.map((s): ServiceView => {
    const mine = recent.filter((i) => affects(i, s.id))
    const days = dayList.map((day) => {
      const hits = mine.filter((i) => {
        const first = localDay(new Date(start(i)), config.timezone)
        const last = localDay(new Date(end(i, now)), config.timezone)
        return first <= day && day <= last
      })
      const level = hits.length ? (Math.min(...hits.map((i) => i.severity)) as Level) : undefined
      return { day, level, incidents: hits }
    })
    // Merge overlapping SEV1/2 windows so two incidents at the same time are not counted twice.
    const windows = mine
      .filter((i) => i.severity <= 2)
      .map((i) => [Math.max(start(i), windowStart), end(i, now)] as [number, number])
      .sort((a, b) => a[0] - b[0])
    let down = 0
    let cursor = windowStart
    for (const [a, b] of windows) {
      const from = Math.max(a, cursor)
      if (b > from) down += b - from
      cursor = Math.max(cursor, b)
    }
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      health: healthOf(active.filter((i) => affects(i, s.id))),
      days,
      majorFree: 1 - down / (now.getTime() - windowStart),
    }
  })

  return { health: healthOf(active), active, past, services, now }
}

const CSS = `:root{--bg:#f6f8fa;--card:#fff;--text:#1f2328;--muted:#59636e;--line:#d1d9e0;--operational:#1a7f37;--degraded:#bf8700;--partial:#e16f24;--major:#d1242f;--monitoring:#0969da;--empty:#d1d9e0;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#151b23;--text:#f0f6fc;--muted:#9198a1;--line:#3d444d;--empty:#3d444d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Thai","Noto Sans",Sukhumvit Set,Thonburi,"Leelawadee UI",Tahoma,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 20px 64px}a{color:inherit}header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:28px}
h1{font-size:28px;margin:0;line-height:1.25}h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:40px 0 12px}h3{margin:0;font-size:17px}
header p{margin:6px 0 0;color:var(--muted)}.lang{font-size:14px;color:var(--muted);white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:4px 12px;text-decoration:none}
.banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:18px 22px;border-radius:12px;color:#fff;font-size:19px}.banner span{font-size:14px;opacity:.9;margin-left:auto}
.h-operational{background:var(--operational)}.h-degraded{background:var(--degraded)}.h-partial{background:var(--partial)}.h-major{background:var(--major)}.h-monitoring{background:var(--monitoring)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px}.incident{padding:18px 22px;margin-bottom:12px;border-left:5px solid var(--line)}
.incident.l1{border-left-color:var(--major)}.incident.l2{border-left-color:var(--partial)}.incident.l3,.incident.l4{border-left-color:var(--degraded)}.incident.done{border-left-color:var(--operational)}
.meta{color:var(--muted);font-size:14px;margin:4px 0 0}.updates{list-style:none;margin:14px 0 0;padding:0}.updates li{padding:10px 0;border-top:1px solid var(--line)}.updates li:first-child{border-top:0;padding-top:0}
.updates b{margin-right:6px}.updates time{color:var(--muted);font-size:14px}.updates p{margin:4px 0 0}
.services{list-style:none;margin:0;padding:6px 22px}.service{padding:16px 0;border-top:1px solid var(--line)}.service:first-child{border-top:0}
.row{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.name{font-weight:600}.desc{color:var(--muted);font-size:14px;font-weight:400;margin-left:8px}
.state{font-size:14px;font-weight:600;white-space:nowrap}.s-operational{color:var(--operational)}.s-degraded{color:var(--degraded)}.s-partial{color:var(--partial)}.s-major{color:var(--major)}.s-monitoring{color:var(--monitoring)}
.bars{display:flex;gap:2px;height:34px;margin:10px 0 6px}.bars span{flex:1;border-radius:2px;background:var(--operational)}.bars .l1{background:var(--major)}.bars .l2{background:var(--partial)}.bars .l3,.bars .l4{background:var(--degraded)}
.bars span:hover{opacity:.7}.legend{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:13px}
.day{margin-bottom:22px}.day h3{font-size:15px;color:var(--muted);font-weight:600;margin-bottom:8px}.empty{color:var(--muted)}
footer{margin-top:48px;color:var(--muted);font-size:14px}.back{display:inline-block;margin-bottom:20px;color:var(--muted);font-size:14px}
@media (max-width:600px){main{padding:24px 14px 48px}.banner{font-size:17px}.banner span{margin-left:0;width:100%}.bars{gap:1px}.desc{display:none}}`

interface Ctx {
  config: Config
  lang: Lang
  /** Prefix that leads from the current page to the root of this language, e.g. "" or "../". */
  up: string
  /** Prefix from the current page to the root of the whole site. */
  root: string
}

function layout(ctx: Ctx, title: string, body: string, opts: { refresh?: boolean; alt: string }): string {
  const t = strings(ctx.lang)
  return `<!doctype html>
<html lang="${ctx.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${ctx.config.description ? `<meta name="description" content="${esc(ctx.config.description)}">\n` : ''}${opts.refresh ? '<meta http-equiv="refresh" content="300">\n' : ''}<link rel="stylesheet" href="${ctx.root}style.css">
<link rel="alternate" type="application/atom+xml" href="${ctx.up}feed.xml" title="${esc(ctx.config.title)}">
</head>
<body>
<main>
<header>
<div><h1>${esc(ctx.config.title)}</h1>${ctx.config.description ? `<p>${esc(ctx.config.description)}</p>` : ''}</div>
<a class="lang" href="${opts.alt}" hreflang="${ctx.lang === 'th' ? 'en' : 'th'}">${t.page.language}</a>
</header>
${body}
<footer>${t.page.subscribe}: <a href="${ctx.up}feed.xml">${t.page.feed}</a> · <a href="${ctx.root}status.json">${t.page.json}</a> · ${t.page.poweredBy} <a href="https://github.com/nuttakulsv/incident-kit">incident-kit</a></footer>
</main>
</body>
</html>
`
}

function updateText(u: PublicUpdate, lang: Lang) {
  return u.text ?? strings(lang).defaultUpdate[u.state]
}

function incidentCard(inc: Incident, ctx: Ctx, now: Date, link: boolean): string {
  const t = strings(ctx.lang)
  const tz = ctx.config.timezone
  const services = serviceNames(inc, ctx.config)
  const span = formatDuration(end(inc, now) - start(inc), ctx.lang)
  const meta = [
    sevLabel(inc.severity, ctx.lang),
    services.length ? `${t.page.affects} ${services.join(', ')}` : '',
    inc.state === 'resolved' ? t.page.resolvedIn(span) : t.page.ongoingFor(span),
  ].filter(Boolean)
  const updates = [...inc.updates].reverse()
  const title = esc(inc.publicTitle)
  return `<article class="card incident l${inc.severity}${inc.state === 'resolved' ? ' done' : ''}">
<h3>${link ? `<a href="${ctx.up}incidents/${inc.number}.html">${title}</a>` : title}</h3>
<p class="meta">${meta.map(esc).join(' · ')}</p>
<ol class="updates">${updates
    .map(
      (u) =>
        `<li><b>${t.state[u.state]}</b><time datetime="${u.at}">${esc(formatDateTime(u.at, ctx.lang, tz))}</time><p>${paragraphs(updateText(u, ctx.lang))}</p></li>`,
    )
    .join('')}</ol>
</article>`
}

function indexPage(m: SiteModel, ctx: Ctx, alt: string): string {
  const t = strings(ctx.lang)
  const tz = ctx.config.timezone
  const banner = `<section class="banner h-${m.health}"><strong>${t.overall[m.health]}</strong><span>${t.page.updated} ${esc(formatDateTime(m.now, ctx.lang, tz))}</span></section>`
  const active = m.active.length
    ? `<h2>${t.page.active}</h2>\n${m.active.map((i) => incidentCard(i, ctx, m.now, true)).join('\n')}`
    : ''
  const services = `<h2>${t.page.services}</h2>
<ul class="card services">${m.services
    .map((s) => {
      const bars = s.days
        .map((d) => {
          const label = `${formatDate(d.day + 'T12:00:00Z', ctx.lang, 'UTC')}: ${
            d.incidents.length
              ? d.incidents.map((i) => `${sevLabel(i.severity, ctx.lang)} ${i.publicTitle}`).join(', ')
              : t.page.noIncidentDay
          }`
          return `<span${d.level ? ` class="l${d.level}"` : ''} title="${esc(label)}"></span>`
        })
        .join('')
      const pct = `${(Math.floor(s.majorFree * 10000) / 100).toFixed(2)}%`
      return `<li class="service"><div class="row"><span class="name">${esc(s.name)}${
        s.description ? `<span class="desc">${esc(s.description)}</span>` : ''
      }</span><span class="state s-${s.health}">${t.service[s.health]}</span></div>
<div class="bars" role="img" aria-label="${esc(`${s.name}: ${t.page.incidentFree(pct)}`)}">${bars}</div>
<div class="legend"><span>${t.page.daysAgo}</span><span>${t.page.incidentFree(pct)}</span><span>${t.page.today}</span></div></li>`
    })
    .join('\n')}</ul>`

  const byDay = new Map<string, Incident[]>()
  for (const i of m.past) {
    const day = localDay(i.declaredAt, tz)
    byDay.set(day, [...(byDay.get(day) ?? []), i])
  }
  const past = `<h2>${t.page.history}</h2>\n${
    byDay.size
      ? [...byDay]
          .map(
            ([day, list]) =>
              `<div class="day"><h3>${esc(formatDate(day + 'T12:00:00Z', ctx.lang, 'UTC'))}</h3>${list.map((i) => incidentCard(i, ctx, m.now, true)).join('')}</div>`,
          )
          .join('\n')
      : `<p class="empty">${t.page.noHistory}</p>`
  }`
  return layout(ctx, ctx.config.title, `${banner}\n${active}\n${services}\n${past}`, { refresh: true, alt })
}

function incidentPage(inc: Incident, m: SiteModel, ctx: Ctx, alt: string): string {
  const t = strings(ctx.lang)
  return layout(
    ctx,
    `${inc.publicTitle} · ${ctx.config.title}`,
    `<a class="back" href="${ctx.up}">← ${t.page.back}</a>\n${incidentCard(inc, ctx, m.now, false)}`,
    { alt },
  )
}

function feed(m: SiteModel, ctx: Ctx, base: string): string {
  const t = strings(ctx.lang)
  const entries = [...m.active, ...m.past]
    .map((i) => {
      const updated = i.updates.at(-1)?.at ?? i.declaredAt
      const link = `${base}incidents/${i.number}.html`
      const body = [...i.updates]
        .reverse()
        .map(
          (u) =>
            `<p><b>${t.state[u.state]}</b> ${esc(formatDateTime(u.at, ctx.lang, ctx.config.timezone))}<br>${paragraphs(updateText(u, ctx.lang))}</p>`,
        )
        .join('')
      return `<entry>
<id>${esc(link)}</id>
<title>${esc(`[${t.state[i.state]}] ${i.publicTitle}`)}</title>
<link href="${esc(link)}"/>
<published>${i.declaredAt}</published>
<updated>${updated}</updated>
<content type="html">${esc(body)}</content>
</entry>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${ctx.lang}">
<id>${esc(base)}</id>
<title>${esc(ctx.config.title)}</title>
<link href="${esc(base)}"/>
<link rel="self" href="${esc(base)}feed.xml"/>
<updated>${m.now.toISOString()}</updated>
<author><name>${esc(ctx.config.title)}</name></author>
${entries}
</feed>
`
}

function statusJson(m: SiteModel, config: Config): string {
  const t = strings('en')
  const inc = (i: Incident) => ({
    number: i.number,
    title: i.publicTitle,
    severity: i.severity,
    state: i.state,
    services: i.services,
    declaredAt: i.declaredAt,
    impactStart: i.impactStart ?? null,
    resolvedAt: i.resolvedAt ?? null,
    updates: i.updates.map((u) => ({ at: u.at, state: u.state, text: u.text ?? t.defaultUpdate[u.state] })),
  })
  return (
    JSON.stringify(
      {
        page: {
          title: config.title,
          url: config.url ?? null,
          updatedAt: m.now.toISOString(),
          timezone: config.timezone,
        },
        status: { health: m.health, description: t.overall[m.health] },
        services: m.services.map((s) => ({ id: s.id, name: s.name, health: s.health, majorFree90d: s.majorFree })),
        active: m.active.map(inc),
        recent: m.past.map(inc),
      },
      null,
      2,
    ) + '\n'
  )
}

/** Every file of the status page, keyed by path. The default language sits at the root, the other one in /en or /th. */
export function buildSite(incidents: Incident[], config: Config, now = new Date()): Record<string, string> {
  const m = siteModel(incidents, config, now)
  const other: Lang = config.lang === 'th' ? 'en' : 'th'
  const base = config.url ? `${config.url}/` : ''
  const files: Record<string, string> = { 'style.css': CSS + '\n', 'status.json': statusJson(m, config) }
  for (const lang of [config.lang, other]) {
    const dir = lang === config.lang ? '' : `${lang}/`
    const otherDir = lang === config.lang ? `${other}/` : ''
    const ctx: Ctx = { config, lang, up: '', root: dir ? '../' : '' }
    files[`${dir}index.html`] = indexPage(m, ctx, dir ? `../${otherDir}` : otherDir)
    files[`${dir}feed.xml`] = feed(m, ctx, `${base}${dir}`)
    for (const inc of [...m.active, ...m.past]) {
      const page: Ctx = { config, lang, up: '../', root: dir ? '../../' : '../' }
      files[`${dir}incidents/${inc.number}.html`] = incidentPage(
        inc,
        m,
        page,
        dir ? `../../${otherDir}incidents/${inc.number}.html` : `../${otherDir}incidents/${inc.number}.html`,
      )
    }
  }
  return files
}
