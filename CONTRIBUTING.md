# Contributing

Thanks for taking the time. Issues and pull requests are welcome in English or Thai.

## Setup

```bash
npm install
npm test
npm run demo        # builds the demo status page into site/
```

Before you open a pull request:

```bash
npm run lint && npm run format:check && npm run typecheck && npm test
npm run build       # updates action/index.cjs, which is committed
```

CI fails if `action/index.cjs` does not match the source, so commit it together with your change.

## Where things are

| File                  | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| `src/incident.ts`     | Builds the incident state from the issue and its comments |
| `src/commands.ts`     | Parses slash commands                                     |
| `src/action.ts`       | The GitHub Action: reacts to events, talks to the API     |
| `src/site.ts`         | The status page                                           |
| `src/templates.ts`    | Issue form, workflow and sample config that `init` writes |
| `test/fake-github.ts` | In-memory GitHub API used by the end-to-end tests         |

The state of an incident is always rebuilt from the whole issue thread. Please keep it that way: no state in files,
caches or hidden comments other than the snapshot in the status block.

## Translations

All user-facing text lives in `src/i18n.ts`. A new language needs every key of the English object. Thai is the
reference for how much to adapt rather than translate word for word.

## Bug reports

The incident-kit step output from the Actions tab helps most. Remove tokens, webhook URLs and anything private first.
