import { STATES, type Level, type State } from './config.js'

export type Command =
  | { kind: 'status'; state: State }
  | { kind: 'sev'; level: Level }
  | { kind: 'update'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'assign'; user: string }
  | { kind: 'link'; url: string; title?: string }
  | { kind: 'title'; text: string }
  | { kind: 'services'; ids: string[] }
  | { kind: 'ack' }
  | { kind: 'help' }

export interface Parsed {
  commands: Command[]
  errors: string[]
}

const NAMES = [
  'status',
  'sev',
  'severity',
  'update',
  'note',
  'title',
  'services',
  'assign',
  'link',
  'ack',
  'resolve',
  'help',
]
const LINE = /^\/([a-z]+)\b[ \t]*(.*)$/i

/**
 * Reads slash commands from a comment. A command has to start a line. Text after /update and /note runs until the
 * next command. Code blocks, quoted replies and unknown words like /var/log are left alone.
 */
export function parseCommands(body: string): Parsed {
  const commands: Command[] = []
  const errors: string[] = []
  let text: { kind: 'update' | 'note'; lines: string[] } | undefined
  let fenced = false

  const flush = () => {
    if (!text) return
    const value = text.lines.join('\n').trim()
    if (value) commands.push({ kind: text.kind, text: value })
    else errors.push(`/${text.kind} needs a message, for example: /${text.kind} Rolling back the last deploy`)
    text = undefined
  }

  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      fenced = !fenced
      if (text) text.lines.push(raw)
      continue
    }
    const m = fenced || line.startsWith('>') ? null : LINE.exec(line)
    const name = m?.[1]?.toLowerCase()
    if (!m || !name || !NAMES.includes(name)) {
      if (text) text.lines.push(raw)
      continue
    }
    flush()
    const arg = m[2]!.trim()
    switch (name) {
      case 'status': {
        const state = STATES.find((s) => s === arg.toLowerCase())
        if (state) commands.push({ kind: 'status', state })
        else errors.push(`/status "${arg}" is not a state. Use one of: ${STATES.join(', ')}`)
        break
      }
      case 'resolve':
        commands.push({ kind: 'status', state: 'resolved' })
        break
      case 'sev':
      case 'severity': {
        const level = Number(/^(?:sev)?\s*([1-4])$/i.exec(arg)?.[1])
        if (level) commands.push({ kind: 'sev', level: level as Level })
        else errors.push(`/sev "${arg}" is not a severity. Use 1, 2, 3 or 4`)
        break
      }
      case 'update':
      case 'note':
        text = { kind: name, lines: arg ? [arg] : [] }
        break
      case 'assign': {
        const user = /^@?([a-z\d](?:[a-z\d-]{0,38}))$/i.exec(arg)?.[1]
        if (user) commands.push({ kind: 'assign', user })
        else errors.push('/assign needs one GitHub user, for example: /assign @octocat')
        break
      }
      case 'link': {
        const [url, ...title] = arg.split(/\s+/)
        if (url && /^https?:\/\/\S+$/.test(url))
          commands.push({ kind: 'link', url, title: title.join(' ') || undefined })
        else errors.push('/link needs a URL, for example: /link https://grafana.example.com/d/api Error rate')
        break
      }
      case 'title':
        if (arg) commands.push({ kind: 'title', text: arg })
        else errors.push('/title needs the public title, for example: /title Some payments are failing')
        break
      case 'services': {
        const ids = arg
          .split(/[\s,]+/)
          .map((x) => x.toLowerCase())
          .filter(Boolean)
        if (ids.length) commands.push({ kind: 'services', ids })
        else errors.push('/services needs one or more service ids, for example: /services api payments')
        break
      }
      case 'ack':
        commands.push({ kind: 'ack' })
        break
      case 'help':
        commands.push({ kind: 'help' })
        break
    }
  }
  flush()
  return { commands, errors }
}
