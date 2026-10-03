import { run } from './action.js'

run(process.env).then(
  (r) => {
    console.log(
      `incident-kit ${r.command}: ${r.incident ? `#${r.incident} ${r.state}` : 'done'}${r.changes.length ? ` (${r.changes.join(', ')})` : ''}`,
    )
  },
  (err: unknown) => {
    console.log(`::error::${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  },
)
