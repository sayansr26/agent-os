# Contributing to claude-agent-os

Thanks for taking a look. Issues and pull requests are both welcome.

## Before you open a pull request

Run the validator. It takes a second, needs no auth, and catches the class of
mistake that has actually shipped here before:

```bash
node scripts/validate-plugin.mjs
```

If you have the Claude Code CLI, run its validator too — they check different
things:

```bash
claude plugin validate ./plugins/agent-os --strict
```

CI runs both on every push and pull request.

## Working on the plugin

Load your working copy without installing it:

```bash
claude --plugin-dir ./plugins/agent-os
```

Then `/reload-plugins` after each edit to pick up changes without restarting.
A `--plugin-dir` copy takes precedence over an installed one for that session,
so you can iterate against the working tree even if you have `agent-os`
installed from the marketplace.

## Repository layout

```
.claude-plugin/marketplace.json   the marketplace catalog (this repo is its own marketplace)
plugins/agent-os/
  .claude-plugin/plugin.json      the plugin manifest
  agents/                         seven subagent definitions
  skills/
    init/                         audit, establish or migrate the context layer
      SKILL.md                    routing only — kept small, loads on invoke
      references/                 loaded only when a finding calls for them
      scripts/audit.mjs           the deterministic audit
    map/                          architecture and per-feature maps
    memory/                       inspect and repair what a project remembers
      scripts/memory.mjs          deterministic store listing and health check
  hooks/                          hooks.json + session-resume.mjs
scripts/validate-plugin.mjs       structural validation, runs in CI
```

## What makes a change likely to be merged

**Agents.** They must stay generic. Anything specific to one stack, one
framework or one company belongs in that project's `.claude/rules/`, not in an
agent. The whole point is that the same agent set works in a Next.js monorepo
and a Django service because the project-specific part lives in the project.

Every agent needs `memory: project`. User scope leaks one repository's knowledge
into every other repository you open.

**Skills.** Keep `SKILL.md` to routing and put detail in `references/`, loaded
only when a finding calls for it. A skill body loads whole on invoke, so
everything you add there is paid for by every user on every run.

**Deterministic work belongs in a script.** Line counts, file existence and
JSON keys do not need a model to discover them one Read at a time. If you find
yourself writing "then check whether X exists" into a skill, write it into
`audit.mjs` instead.

**Context cost is a review criterion.** Agent *descriptions* load on every turn
in every project; agent *bodies* do not. Adding 400 bytes to a description is a
tax on everyone forever. Say in your PR what your change costs.

## Commit messages

Conventional commits: `feat:`, `fix:`, `docs:`, `perf:`, `chore:`, with an
optional scope — `fix(init):`, `perf(agents):`. Explain *why* in the body, not
just what; the what is in the diff.

## Releasing

Bump the version in **both** `plugins/agent-os/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` — the validator fails if they drift. Users
only receive an update when the version changes. Add a `CHANGELOG.md` entry.

## Reporting bugs

Use the issue templates. The most useful bug report includes the output of:

```bash
node "$(dirname "$(which claude)")/../plugins/agent-os/skills/init/scripts/audit.mjs"
```

or, more simply, whatever `/agent-os:init` printed. It is read-only and shows
the state that matters.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
