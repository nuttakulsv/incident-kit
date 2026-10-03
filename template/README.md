# Status and incidents

This repository runs [incident-kit](https://github.com/nuttakulsv/incident-kit): incidents are issues, updates are
slash commands in the comments, and the status page is published to GitHub Pages.

## Finish the setup

1. Edit `incident-kit.yml`: your services, the on-call rotation and notifications.
2. If you changed the services, run `npx incident-kit init` to refresh the issue form.
3. Settings > Pages > Source: **GitHub Actions**.
4. Settings > Actions > General > Workflow permissions: allow GitHub Actions to create pull requests, so resolved
   incidents get a postmortem pull request.
5. Add the secrets your notifications use (Settings > Secrets and variables > Actions).

## During an incident

Open a new issue with the **Declare an incident** form, then comment:

```text
/status identified
/update We found the cause and are rolling back the last deploy.
```

`/help` in any incident lists every command. Postmortems land in `docs/postmortems/`.
