# Privacy

agent-os collects nothing about you or your code: no telemetry, no analytics, no account.

- The CLI reads and writes files in the project you run it in, and, when you ask it to,
  Claude Code's settings in `~/.claude/`.
- The Claude Code plugins run on your machine. agent-os's hooks read the project and git and
  make no network calls. auto-route only chooses which Claude model a turn uses. auto-handoff
  asks Claude Code's own model to write its handoff brief — the same model your session already
  talks to — and can serve that brief on a local web page, which is off unless you set `viewer`.
- `agent-os init` runs the `claude` CLI to install the plugins, which downloads them from
  GitHub. That is Claude Code's own plugin download, made only when you run `init`.

Questions: open an issue at https://github.com/sayansr26/agent-os/issues.
