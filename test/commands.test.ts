import { describe, expect, test } from 'vitest'
import { parseCommands } from '../src/commands.js'

describe('parseCommands', () => {
  test('reads several commands from one comment', () => {
    const { commands, errors } = parseCommands(
      '/status identified\n/sev 1\n/assign @bob\n/link https://grafana.example.com/d/x Error rate\n/ack',
    )
    expect(errors).toEqual([])
    expect(commands).toEqual([
      { kind: 'status', state: 'identified' },
      { kind: 'sev', level: 1 },
      { kind: 'assign', user: 'bob' },
      { kind: 'link', url: 'https://grafana.example.com/d/x', title: 'Error rate' },
      { kind: 'ack' },
    ])
  })

  test('update and note text runs until the next command and keeps line breaks', () => {
    const { commands } = parseCommands(
      '/update Rolling back.\nPayments made in the last hour were not charged.\n/note internal\n/status monitoring',
    )
    expect(commands).toEqual([
      { kind: 'update', text: 'Rolling back.\nPayments made in the last hour were not charged.' },
      { kind: 'note', text: 'internal' },
      { kind: 'status', state: 'monitoring' },
    ])
  })

  test('accepts the text on the next line', () => {
    expect(parseCommands('/update\nWe are investigating.').commands).toEqual([
      { kind: 'update', text: 'We are investigating.' },
    ])
  })

  test('ignores chat, paths, quotes and code blocks', () => {
    const body = [
      'Looks like /var/log is full',
      '> /status resolved',
      '```',
      '/sev 1',
      '```',
      'what about /status resolved mid-sentence',
    ].join('\n')
    expect(parseCommands(body)).toEqual({ commands: [], errors: [] })
  })

  test('is case insensitive and accepts SEV2, sev 2, /severity and /resolve', () => {
    expect(parseCommands('/SEV SEV2\n/severity 3\n/Status Monitoring\n/resolve').commands).toEqual([
      { kind: 'sev', level: 2 },
      { kind: 'sev', level: 3 },
      { kind: 'status', state: 'monitoring' },
      { kind: 'status', state: 'resolved' },
    ])
  })

  test('title and services', () => {
    expect(parseCommands('/title Some payments are failing\n/services api, Payments').commands).toEqual([
      { kind: 'title', text: 'Some payments are failing' },
      { kind: 'services', ids: ['api', 'payments'] },
    ])
  })

  test('explains mistakes', () => {
    const { commands, errors } = parseCommands('/status fixed\n/sev 5\n/assign\n/link not-a-url\n/update\n/title')
    expect(commands).toEqual([])
    expect(errors).toHaveLength(6)
    expect(errors[0]).toContain('investigating, identified, monitoring, resolved')
  })

  test('handles Windows line endings', () => {
    expect(parseCommands('/status identified\r\n/update Fix deployed\r\n').commands).toEqual([
      { kind: 'status', state: 'identified' },
      { kind: 'update', text: 'Fix deployed' },
    ])
  })
})
