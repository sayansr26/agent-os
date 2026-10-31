---
name: agent-os-init
description: Set up or repair this project's agent-os context layer in Cursor. Checks the generated rules, subagents and hooks against .agent-os/, inspects agent memory, then establishes, maps, migrates or maintains the layer. Use for "set up agent-os", "agent-os init", "initialise this project", "bootstrap my context setup", "migrate off memory-bank or .cursorrules", "my AGENTS.md is too big", or when starting work in a repo with no setup.
---

# agent-os for Cursor — set up or repair

The Cursor counterpart of Claude Code's `/agent-os:init`. Same layout, same
agents, same memory — only the file names differ.

| Tier | Lives in | Startup cost | Holds |
|---|---|---|---|
| Always-loaded | `AGENTS.md` (from `.agent-os/AGENTS.md`), ≤200 lines | small, fixed | Only what is true in *every* session |
| On-demand | `.cursor/rules/*.mdc` with `globs:` (from `.agent-os/rules/*.md` with `paths:`) | **zero** | Durable facts scoped to some files |
| Explored | `.claude/agent-memory/agent-os-feature-cartographer/` | **zero** (subagent context) | How each feature is actually built |
| Task state | the project's own vault / handoff file | zero (read selectively) | What is in flight right now |

Agent memory stays under `.claude/agent-memory/` on purpose: Claude Code's
agent-os agents use the same directories, so a team on both tools shares one map.

**Storing a fact and loading a fact are different acts.** Anything that makes
them the same act — a handbook `AGENTS.md`, a memory bank read at every startup,
an always-apply rule that only matters for one directory — is the bug.

## Arguments

| Argument | Do |
|---|---|
| *(none)* | The full pass below |
| `audit` | Steps 1 and 3 only. Change nothing. |

`/agent-os-map` builds the architecture map; `/agent-os-memory` inspects and
repairs what the project remembers.

## Step 1 — Read the state

Three commands. Do not rediscover this with a dozen file reads — they are
deterministic:

```bash
npx -y @sayansr26/agent-os detect
npx -y @sayansr26/agent-os check
npx -y @sayansr26/agent-os memory
```

`check` lists every generated file — rules, `AGENTS.md`, the `agent-os-*`
subagents and skills, the hook scripts and `.cursor/hooks.json` — as `ok`,
`MISSING` or `DRIFTED`. `memory` lists every agent's memory, which features are
mapped, and a health list.

**Show the output to the user before you change anything.**

## Step 2 — Fresh setup or repair?

| State | Do |
|---|---|
| no `.agent-os/` | `npx -y @sayansr26/agent-os init`, then carry on with Step 3 |
| `check` reports `MISSING` or `DRIFTED` | `npx -y @sayansr26/agent-os sync` — it rewrites only what it generated |
| `sync` names files it did not generate | stop and ask: move their content into `.agent-os/` (preferred), or `--force` after a commit |
| everything `ok` | nothing to repair |

Never edit a generated file by hand. They carry a banner, the pre-edit hook
blocks the edit, and the next `sync` would revert it. Edit `.agent-os/` and sync.

## Step 3 — Decide what this run is for

Judge from what Step 1 printed and a look at the source tree:

| Mode | Evidence | Do |
|---|---|---|
| `TOO-EARLY` | Barely any source (under ~5 files) | **Build nothing.** A layer over an empty project is invented conventions. |
| `ESTABLISH` | `.agent-os/AGENTS.md` is still the placeholder, or the only rule is `example.md` | `references/establishing.md` — build the layer *from the code* |
| `MAP` | Layer real, but `memory` shows no `_architecture.md` | `references/establishing.md`, "Map the architecture" — or `/agent-os-map` |
| `MIGRATE` | `.cursorrules`, `memory-bank/`, `.serena/memories/`, or an always-apply rule that only concerns part of the tree | fix it; `references/migrating.md` for legacy stores |
| `MAINTAIN` | Real layer, architecture mapped | report and stop |

`references/changing-a-feature.md` is the workflow that pays all this back —
point the user at it once the layer exists.

The references were written for Claude Code. Read them through this table:

| They say | In Cursor |
|---|---|
| `CLAUDE.md` | `.agent-os/AGENTS.md` (compiled to `AGENTS.md`). Draft it yourself from the code — there is no `/init` to run first. |
| `.claude/rules/*.md` | `.agent-os/rules/*.md`, then `sync` (compiled to `.cursor/rules/*.mdc`) |
| `agent-os:<name>` | the `agent-os-<name>` subagent |
| `/agent-os:init`, `/agent-os:map`, `/agent-os:memory` | `/agent-os-init`, `/agent-os-map`, `/agent-os-memory` |
| `node "${CLAUDE_PLUGIN_ROOT}/…/<script>.mjs"` | `npx -y @sayansr26/agent-os <script>` |
| "Wire the agents into CLAUDE.md" (Step 4b) | already done: `.cursor/rules/agent-os-agents.mdc` is always applied — skip it |
| the settings pass, `permissions.deny`, task tools | see "Git write protection" below; Cursor has its own to-do list |

## Step 4 — Verify by re-running

Run `check` and `memory` again and show before and after: generated files all
`ok`, features mapped, health findings. Do not declare success on vibes — the
commands produce the numbers, so quote them.

## Git write protection

Claude Code gets git write protection as `permissions.deny` rules. Cursor has no
deny list, so `sync` registers a `beforeShellExecution` hook in
`.cursor/hooks.json` (`.cursor/hooks/agent-os/hooks/git-guard.mjs`) that refuses
the same commands: every git command that changes the repository. Read-only git
stays available. `references/git-permissions.md` explains each rule.

If the user wants it off: `{ "cursor": { "gitProtection": false } }` in
`.agent-os/config.json`, then `sync`. Say what that gives up.

## What this skill will not do

- It will not write facts it has not verified in the repo. An invented rule is
  worse than a missing one, because it will be trusted.
- It will not delete a legacy store before its content has landed in `.agent-os/`.
- It will not hand-edit generated files, or another agent's memory.
- It will not add a memory MCP server. The common failure is that nothing was
  *written*, which a graph does not fix and the cartographer's memory does.
