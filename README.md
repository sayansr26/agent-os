# agent-os

**One source of truth for AI coding agent config.** Write your rules once in `.agent-os/`; compile them to Claude Code, Cursor, Cline, Windsurf, Antigravity, Gemini CLI, OpenCode and Kilo — each in the schema that tool actually wants.

[![npm](https://img.shields.io/npm/v/%40sayansr26%2Fagent-os.svg)](https://www.npmjs.com/package/@sayansr26/agent-os)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

```bash
npx @sayansr26/agent-os init
```

---

## The problem

Every agent tool invented its own rules format for the same idea.

| Tool | Path | Frontmatter |
|---|---|---|
| Claude Code | `.claude/rules/*.md` | `paths: [globs]` |
| Cline | `.clinerules/*.md` | `paths: [globs]` |
| Cursor | `.cursor/rules/*.mdc` | `description`, `globs`, `alwaysApply` |
| Windsurf | `.windsurf/rules/*.md` | `trigger: glob\|always_on`, `globs` |
| Antigravity | `.agents/rules/*.md` | glob activation is set in the UI — no documented file syntax |
| Gemini CLI · OpenCode · Kilo | varies | **no conditional loading at all** |

Keep four copies in sync by hand and they drift. Keep one and three tools are wrong.

`agent-os` keeps one, and generates the rest.

---

## How it works

```
.agent-os/
├── config.json       which tools to compile for
├── AGENTS.md         instructions that apply everywhere
├── rules/
│   └── api.md        --- description: ... / paths: ["src/api/**"] ---
└── skills/
    └── release/SKILL.md
```

One rule, compiled:

```markdown
# .agent-os/rules/api.md
---
description: API layer conventions
paths:
  - "src/api/**"
---
One exported function per endpoint. Validate at the boundary.
```

becomes `.cursor/rules/api.mdc` with `globs:` + `alwaysApply: false`, `.windsurf/rules/api.md` with `trigger: glob`, `.claude/rules/api.md` and `.clinerules/api.md` with `paths:` verbatim, an entry in OpenCode's and Kilo's `instructions` array, and a line under **Path-scoped rules** in a root `AGENTS.md` for everything else.

Skills are simpler: `.agents/skills/` is read by **Cursor, Windsurf, Antigravity and Gemini CLI alike**, so one directory serves four vendors. Claude Code and Cline get their own copies.

---

## Commands

Every command below is `npx @sayansr26/agent-os <command>`. Install it once —
`npm i -g @sayansr26/agent-os` — and it is just `agent-os <command>`.

| | |
|---|---|
| `init` | Detect installed tools, scaffold `.agent-os/`, compile |
| `sync` | Recompile after editing the source |
| `check` | Verify nothing drifted. Exits 1 if it has — put this in CI |
| `detect` | Show which tools this project is set up for |
| `audit` | Inspect the context layer and report findings |
| `memory` | Inspect and health-check every memory store |
| `settings` | Git write protection + task tools for Claude Code (`--scope project\|user\|both`, `--apply`) |

`--root <dir>` to target another directory, `--dry-run` to preview.

**`init` is safe to re-run.** It first reports the setup as `FRESH`,
`REPAIR` (with each missing item) or `HEALTHY`, fixes only what is missing, and
brings the Claude Code plugin to the latest version — installing it, enabling
it, or refreshing the marketplace and running `claude plugin update`.
`/agent-os:init` inside Claude Code reads the same state.

**`init` sets up Claude Code completely.** Beyond the rules it installs the
plugin — agents, skills, per-agent memory, hooks — with
`claude plugin marketplace add` and `claude plugin install --yes`, and writes
the settings: git write-protection deny rules and the task tools in
`.claude/settings.json`, plus the task-tracking rule in `CLAUDE.md`. It then
asks once whether to apply the same to `~/.claude/` so every project on the
machine is protected (`--global` / `--no-global` answer in advance). Every
write merges into what is there; changed `~/.claude` files are backed up to
`*.agent-os.bak`. `--no-plugin` skips the plugin step. Every other detected tool gets its rules in its own
schema; the plugin layer is Claude Code only because no other tool has anywhere
to put it.

**On an existing project, `init` adopts rather than scaffolds.** It takes your
current `AGENTS.md` and the first rules directory it recognises as the source,
so the first `sync` regenerates what you already had. **`sync` never overwrites
a file it did not generate** — generated files carry a banner, anything else at
that path is yours. It names those files, leaves them alone and exits 1; pass
`--force` if you really mean to replace them.

Generated files carry a banner. Edit `.agent-os/`, run `sync`, never edit the output.

---

## What does not port, and why

Being straight about this matters more than the feature list.

**Hooks don't port.** Every tool differs in events *and* control protocol — Cursor returns JSON `permission`, Windsurf uses exit codes, Claude Code uses JSON. There is no honest common denominator, so `agent-os` doesn't invent one.

**Memory doesn't port.** Only Claude Code (auto memory) and Windsurf have native per-session memory. Kilo deprecated its Memory Bank in favour of `AGENTS.md`; Cline's is a community methodology, not a feature. So the architecture map — the thing that makes *"change the login flow from email to OTP"* run off known structure — works in Claude Code and nowhere else yet.

**Antigravity's rules target is best effort.** Its docs state a rule is "simply a Markdown file" and never show frontmatter; glob activation is configured in the Customizations panel. So `agent-os` writes valid Markdown and states the intended scope in a comment, rather than inventing a `globs:` key that may silently do nothing.

---

## The Claude Code plugin

The deeper context-engineering work — the architecture map, seven coordinated agents, per-agent memory, and the hooks that make Claude use them — ships as a Claude Code plugin in this repo:

```
/plugin marketplace add sayansr26/agent-os
/plugin install agent-os@sayan-plugins
```

That's where the memory layer lives, because Claude Code is currently the only tool with somewhere to put it. The CLI is the cross-tool layer beneath it.

Two hooks make the agents part of every session rather than something you have to ask for:

- **SessionStart** (startup, resume, clear, compact) — prints where you left off, then which agent to use for what, which features the cartographer has mapped, and the plan-mode rule.
- **PreToolUse on Edit/Write** — blocks edits to files generated from `.agent-os/` (the next sync would revert them) and names the source to edit; the first edit to an unmapped feature adds a one-time note to ask the cartographer first.

Feature directories default to the first of `src/features`, `src/modules`, `app/features`, `features`, `modules`. Override in `.agent-os/config.json`:

```json
{ "targets": ["claude-code"], "claude": { "features": ["src/features/*", "apps/*"], "cartographerReminder": true } }
```

### auto-route

A second, independent plugin in the same marketplace: a Claude Code mod (a TypeScript hooks module) that picks the model and effort for each turn from what the prompt asks for — lookups go to Haiku, regular coding to Sonnet, design and debugging to Opus, "ultrathink" and security work to Opus at max effort. Subagents keep their own model.

```
/plugin install auto-route@sayan-plugins
```

`agent-os init` installs and updates it alongside agent-os, at project scope; `--no-auto-route` leaves it out.

`/route` shows the current route; `/route light|standard|deep|max` pins a tier, `/route off` hands control back to the session's own model, `/route auto` resumes routing. The tier table and the prompt rules sit at the top of `plugins/auto-route/hooks/register.ts`.

Working on it:

```sh
claude --plugin-dir plugins/auto-route     # run a session with the working copy, hot-reloaded
claude plugin validate plugins/auto-route  # what the engine would refuse
claude plugin test plugins/auto-route      # tests/route.test.ts
```

Once the engine loads it, it writes `.claude-plugin/types/` (git-ignored) for the editor; `tsc -p plugins/auto-route` type-checks it after that. Bump `version` in its `plugin.json` when shipping a change so installs update.

### auto-handoff

A third plugin, vendored from [alexknowshtml/claude-auto-handoff](https://github.com/alexknowshtml/claude-auto-handoff) by Alex Hillman (MIT). Instead of auto-compacting at the context limit, it has Haiku write a structured brief, runs `/clear`, and seeds the fresh session with a pointer to the brief, so work carries on with a clean context. Settings (threshold, templates, ignored files) are rows in `/config`.

```
/plugin install auto-handoff@sayan-plugins
```

`agent-os init` installs it too; `--no-auto-handoff` leaves it out. One change from upstream: the brief viewer server is **off** by default here (upstream serves pages on your Tailscale IP); set `viewer` in `/config` to turn it on. `plugins/auto-handoff/UPSTREAM.md` records the upstream commit, the local changes and how to sync. Develop it the same way as auto-route: `claude --plugin-dir plugins/auto-handoff`, `claude plugin validate|test plugins/auto-handoff`.

---

## Design rules

Worth stealing even if you never install this.

1. **A rules file without path scoping is an always-on file in disguise.** Scope it or accept the cost.
2. **Never write down what the code already says.** Directory tours and architecture narration read as valuable, go stale first, and mislead hardest.
3. **A gotcha is worth ten descriptions.** "X is at Y" is derivable. "X looks like it is at Y but is actually at Z" is not.
4. **Verbose work belongs in a subagent.** Search results and file dumps should never enter the conversation you are trying to keep.
5. **Agent memory is project-scoped, not user.** User scope leaks one repo's knowledge into every other repo you open.
6. **An honest "I could not verify this" beats a confident summary.**
7. **A rule in an instructions file is context, not enforcement.** If you would be upset when it is broken, it belongs in a permission deny list or a hook as well.
8. **A deterministic check should be a script, not a conversation.** Line counts and file existence don't need a model to discover them one read at a time.
9. **Generate, don't duplicate.** Four hand-maintained copies of one convention is four chances to drift.

---

## Requirements

Node 18+. No database, no embeddings, no MCP server, no network calls.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `node scripts/validate-plugin.mjs` before any PR.

## License

MIT © [Sayan Choudhury](https://github.com/sayansr26)
