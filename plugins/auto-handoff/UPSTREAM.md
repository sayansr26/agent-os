# Upstream

This plugin is a vendored copy of [alexknowshtml/claude-auto-handoff](https://github.com/alexknowshtml/claude-auto-handoff)
by Alex Hillman, MIT licensed (see [LICENSE](LICENSE)); the copyright and author stay his.

- Source commit: `8d762ce726c962268e2dbe24c1c60f0889a2fcde` (upstream version 0.8.6), taken 2026-10-22.
- Left out: `docs/demo.gif` and `docs/demo.mp4` (1.5 MB); the README links to them upstream.

## Local changes

- `viewer` defaults to blank (no server) in `.claude-plugin/plugin.json` and `hooks/config.ts`.
  Upstream defaults to `tailscale:3846`, which starts a detached HTTP server that outlives the
  session. `agent-os init` installs this plugin into projects by default, so it must not start a
  network listener nobody asked for. Set `viewer` in `/config` to turn it on.
- Tests that exercise the server name `viewer: 'tailscale:3846'` explicitly.
- README: provenance note, install from `sayan-plugins`, viewer default.

## Syncing from upstream

Fetch the new commit into a scratch folder, diff it against this folder, re-apply the local
changes above, update the commit here, and bump `version` in `.claude-plugin/plugin.json` so
installs update. Run `claude plugin validate` and `claude plugin test` on this folder after.
