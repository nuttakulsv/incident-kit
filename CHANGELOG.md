# Changelog

## 0.1.0 - 2026-10-03

First release.

- Issue form for declaring incidents, generated from `incident-kit.yml`.
- Slash commands in issue comments: `/status`, `/sev`, `/update`, `/note`, `/title`, `/services`, `/assign`, `/link`,
  `/ack`, `/help`. Only people with write access can run them.
- Weekly on-call rotation with overrides, in any IANA time zone.
- Status block pinned to the top of every incident issue, with labels and the commander assigned.
- Notifications to Slack, Discord, Microsoft Teams, LINE Messaging API and plain webhooks.
- Reminders when a SEV1 or SEV2 incident has had no public update for a while.
- Postmortem pull request, in English or Thai, when a serious incident is resolved.
- Static status page on GitHub Pages: per-service status, 90-day history, Atom feed, `status.json`, English and Thai.
- `incident-kit report` for MTTA, MTTR and incident counts.
