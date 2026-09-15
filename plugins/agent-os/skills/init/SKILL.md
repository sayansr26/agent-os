---
name: init
description: Set up or repair this project's Claude Code context layer. Audits what is already there — CLAUDE.md size, whether .claude/rules/ files are path-scoped, dangling hooks, legacy memory-bank or serena stores, auto-memory state, and machine-level problems like user-scope agents shadowing plugin ones — then creates or migrates what is missing. Use for "set up agent-os", "agent-os init", "initialise this project", "bootstrap my context setup", "migrate off memory-bank", "my CLAUDE.md is too big", or when starting work in a repo with no setup.
---

# Memory bootstrap

Bring any repository up to the standard context layout, without inventing facts
and without ballooning what loads every session.

The layout this skill converges on:

| Tier | Lives in | Startup cost | Holds |
|---|---|---|---|
| Always-loaded | `CLAUDE.md`, ≤200 lines | small, fixed | Only what is true in *every* session |
| On-demand | `.claude/rules/*.md` with `paths:` frontmatter | **zero** | Durable facts scoped to some files |
| Self-writing | auto memory (`~/.claude/projects/<repo>/memory/`) | index only | Corrections, preferences, decisions |
| Explored | `.claude/agent-memory/feature-cartographer/` | **zero** (subagent context) | How each feature is actually built |
| Task state | the project's own vault / handoff file | zero (read selectively) | What is in flight right now |

The principle the whole layout serves: **storing a fact and loading a fact are
different acts.** Anything that makes them the same act — a handbook CLAUDE.md,
a memory-bank read at every startup, a rules file with no `paths:` — is the bug.

## `$ARGUMENTS`

| Argument | Do |
|---|---|
| *(none)* | The full pass: audit, then route by MODE |
| `audit` | Run the audit and report. Change nothing. |
| `settings` | The settings and permissions pass only — read `~/.claude/settings.json` and the project's, report what is set, and propose changes. See below. |

Related skills: `/agent-os:map` builds the architecture map, `/agent-os:memory`
inspects and repairs what the project remembers.

## Step 1 — Run the audit

One call. Do not rediscover this with a dozen Read and Grep round trips — the
checks are deterministic and the script does all of them at once:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/init/scripts/audit.mjs"
```

Pass a path as the first argument to audit a project other than the working
directory. It is read-only and exits 0 even when checks fail, so a partial audit
still reaches you.

It reports: always-loaded files and their line counts, whether every
`.claude/rules/` file is path-scoped, whether each hook's target exists, legacy
stores (`memory-bank/`, `.serena/memories/`, cursor and windsurf rules, memory-ish
MCP servers), per-agent memory health, the machine layer (`~/.claude` CLAUDE.md,
shadowing agents or skills, a duplicate session-resume hook, permissions
posture), the startup byte and token cost, and a ranked finding list.

**Show the output to the user before you change anything.** Do not restructure a
repo you have only just opened.

## Step 2 — Route by MODE

The audit ends with a `MODE` line. It decides what this run is for:

| MODE | What it means | Do |
|---|---|---|
| `TOO-EARLY` | Barely any source | **Build nothing.** Tell the user to write code, run Claude Code's `/init`, and come back. A layer over an empty project is invented conventions. |
| `ESTABLISH` | Real code, no context layer | `references/establishing.md` — build the layer *from the code* |
| `MAP` | Layer healthy, never mapped | `references/establishing.md`, "Map the architecture" |
| `MIGRATE` | Layer exists, has problems | fix the findings; `references/migrating.md` for legacy stores |
| `MAINTAIN` | Healthy and mapped | report and stop |

`ESTABLISH` and `MAP` are the modes that make a later request like *"change the
login flow from email to OTP"* execute from known structure instead of
rediscovering the codebase. `references/changing-a-feature.md` is that workflow —
point the user at it once the layer exists.

## Step 3 — Act on the findings

Each finding routes to one place. Load only what the audit actually surfaced:

| Finding | Read |
|---|---|
| `MODE ESTABLISH` or `MODE MAP` | `references/establishing.md` |
| user asks how to change an existing feature | `references/changing-a-feature.md` |
| legacy store found; CLAUDE.md over budget | `references/migrating.md` |
| rule without `paths:`; no rules layer yet; CLAUDE.md to trim | `references/writing-rules.md` |
| `defaultMode` auto-approves with an empty `deny` | `references/git-permissions.md` |
| LSP plugin recommended; checked-in generated dirs | `references/establishing.md`, "Stop Claude reading what it should not" |
| hook target missing | delete the hook entry, or restore the script — say which |
| shadowing agent or skill in `~/.claude` or `.claude/agents/` | the user removes the standalone copy; a plugin cannot |
| unindexed or near-duplicate agent memory topic files | merge into the best-named file, delete the rest, rebuild `MEMORY.md` as one line per file |
| project CLAUDE.md refers to a `~/.claude/CLAUDE.md` that is absent | the user creates it or drops the reference |

Findings on the machine layer are the user's to fix — a plugin cannot write
`~/.claude`. Hand over the exact change rather than attempting it.

## Step 4 — Verify by re-running

Run the audit again and show the before and after: finding count, startup bytes,
token estimate. Do not declare success on vibes — the script already produces the
numbers, so quote them.

## The settings pass

The audit already reads both settings files and reports `defaultMode`, the deny
list, hook registrations and shadowing. To act on it:

1. **Show what is set** — project `.claude/settings.json` and `~/.claude/settings.json`,
   side by side, so the user can see which rules exist only in this project and
   therefore vanish in every other one.
2. **Propose, do not apply.** Write out the exact JSON block and ask. This is the
   one place where acting first is wrong: `permissions.deny` is the guardrail on
   your own behaviour, and a skill that edits its own guardrails without being
   asked is exactly the thing the setting exists to prevent. Apply only after an
   explicit yes, and never widen an existing deny list without pointing out what
   it would stop blocking.
3. **What to propose**, when the audit flagged it:
   - git write protection — `references/git-permissions.md` has the rule set
   - `Read` deny rules for checked-in generated or vendored paths
   - a code intelligence plugin for the detected language
   - `claudeMdExcludes` in a monorepo where other teams' files load

Anything under `~/.claude/` affects every project on the machine. Say so before
proposing it, and prefer the project's own settings file when the rule is really
about this project.

## What this skill will not do

- It will not write facts it has not verified in the repo. An invented rule is
  worse than a missing one, because it will be trusted.
- It will not delete a legacy store before its content has landed.
- It will not add a memory MCP server. A knowledge graph solves retrieval over
  unstructured memory; the common failure is that nothing was *written*, which a
  graph does not fix and which the cartographer's memory does — with no database,
  no embedding step, and no tokens in the main window.
