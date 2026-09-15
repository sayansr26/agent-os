# Security Policy

## Supported versions

Only the latest released version receives fixes. Update with
`/plugin marketplace update sayan-plugins` and then `/reload-plugins`.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through
[GitHub Security Advisories](https://github.com/sayansr26/agent-os/security/advisories/new),
or by email to sayan.choudhury.in@gmail.com.

Include what an attacker could achieve, the steps to reproduce, and the version
you are on. You can expect an acknowledgement within a few days.

## What this plugin can do on your machine

Worth knowing before you install anything that runs in your agent, this plugin
included. A Claude Code plugin executes with your user privileges.

`agent-os` ships:

- **One `SessionStart` hook** (`hooks/session-resume.mjs`). Runs `git` for
  reading only — branch, log, status — and reads a handoff note if the project
  has one. It never writes, and it fails silent on any error.
- **One audit script** (`skills/init/scripts/audit.mjs`), run only when you
  invoke `/agent-os:init`. Read-only. It reads project files and, for the
  machine-layer checks, `~/.claude/settings.json` and `~/.claude/CLAUDE.md`.
- **Seven agents**, which run with the tools Claude Code grants them. The
  read-only ones (`architect`, `reviewer`, `feature-cartographer`) declare
  restricted tool sets; `builder` and `documenter` write files, which is their
  purpose.

It ships **no MCP server**, makes **no network requests**, sends **no telemetry**,
and stores nothing outside your project and your `~/.claude` directory.

## A note on permissions

The `init` skill will recommend adding rules to `permissions.deny`. It does not
and cannot write them for you — a plugin cannot modify `~/.claude/settings.json`.
Read what it proposes before you paste it.

Be aware of the limit documented in
[`references/git-permissions.md`](plugins/agent-os/skills/init/references/git-permissions.md):
a per-subcommand deny list is a strong default, not a hard boundary. Quoting
defeats literal pattern matching. If you need a boundary rather than a guardrail,
use the broad form or a `PreToolUse` hook.
