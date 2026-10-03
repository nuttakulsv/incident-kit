import type { Level, Service } from './config.js'

export interface FormFields {
  severity?: Level
  services: string[]
  publicTitle?: string
  summary?: string
  impactStart?: string
}

export const BLOCK_START = '<!-- incident-kit:status -->'
export const BLOCK_END = '<!-- /incident-kit:status -->'

export function stripStatusBlock(body: string): string {
  const start = body.indexOf(BLOCK_START)
  const end = body.indexOf(BLOCK_END)
  if (start === -1 || end === -1 || end < start) return body
  return (body.slice(0, start) + body.slice(end + BLOCK_END.length)).replace(/^\s*---\s*\n/, '').trim()
}

// Headings written by the issue forms in template/, in English and Thai.
const FIELDS: Record<keyof Omit<FormFields, 'services'> | 'services', RegExp> = {
  severity: /^(severity|ระดับความรุนแรง)/i,
  services: /^(affected services|services|บริการที่ได้รับผลกระทบ)/i,
  publicTitle: /^(public title|หัวข้อบนหน้าสถานะ)/i,
  summary: /^(what is happening|what's happening|summary|เกิดอะไรขึ้น)/i,
  impactStart: /^(when did the impact start|impact start|ผลกระทบเริ่มเมื่อไหร่)/i,
}

/** Reads the fields GitHub writes for an issue form ("### Label" followed by the answer). */
export function parseForm(body: string, services: Service[]): FormFields {
  const sections = new Map<string, string>()
  let current: string | undefined
  for (const line of stripStatusBlock(body).replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line)
    if (heading) {
      current = heading[1]!
      sections.set(current, '')
    } else if (current) {
      sections.set(current, `${sections.get(current)}${line}\n`)
    }
  }
  const value = (field: keyof typeof FIELDS) => {
    for (const [heading, text] of sections) {
      if (!FIELDS[field].test(heading)) continue
      const v = text.trim()
      return v && v !== '_No response_' && v !== 'None' ? v : undefined
    }
    return undefined
  }

  const level = Number(/sev\s*([1-4])/i.exec(value('severity') ?? '')?.[1])
  const picked = (value('services') ?? '')
    .split(/[,\n]/)
    .map((s) =>
      s
        .replace(/^-\s*\[[ x]\]\s*/i, '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
  return {
    severity: level ? (level as Level) : undefined,
    services: services
      .filter((s) => picked.includes(s.name.toLowerCase()) || picked.includes(s.id.toLowerCase()))
      .map((s) => s.id),
    publicTitle: value('publicTitle'),
    summary: value('summary'),
    impactStart: value('impactStart'),
  }
}
