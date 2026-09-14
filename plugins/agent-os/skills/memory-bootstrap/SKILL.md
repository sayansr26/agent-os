---
name: memory-bootstrap
description: Audit this project's context/memory setup and create or migrate whatever is missing — CLAUDE.md sizing, path-scoped .claude/rules/, auto memory, the feature-cartographer agent, and the session-resume hook. Use when starting work in a repo that has no setup, when a CLAUDE.md has grown past its budget, or when migrating off a memory-bank / serena-memories / knowledge-graph arrangement.
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

## Step 1 — Audit before changing anything

Report these, with numbers, before you touch a file.

### The project

1. `wc -l CLAUDE.md` and every other always-loaded file. Over 200 lines is over budget.
2. `ls .claude/rules/` — do the files exist, and does **every one** have `paths:`
   frontmatter? A rule without `paths:` loads every session, same as CLAUDE.md.
3. Any `SessionStart` hook in `.claude/settings.json` — what does it inject, and
   how big is that injection? This is a startup cost that does not show in `wc -l`.
4. Legacy stores: `memory-bank/`, `.serena/memories/`, `.cursorrules`,
   `.windsurfrules`, `docs/architecture.md`-style handbooks, a knowledge-graph MCP
   in `.mcp.json`. Note what each holds.
5. Every hook command in `.claude/settings.json` — does the file it points at
   still exist? A dangling hook fires a command at a missing path every session,
   silently, forever. Check this even when nothing looks wrong.
6. Whether auto memory is on, and whether `MEMORY.md` exists and is under 200 lines.

### The machine

These are outside the project but they change how it behaves, and a project audit
that ignores them misses the failures that are hardest to notice.

7. **Shadowing.** Does `~/.claude/agents/` or `~/.claude/skills/` contain
   something with the same name as a plugin component? User-scope definitions
   **override** same-named plugin agents, so plugin updates silently stop
   arriving. A standalone copy installed before the plugin is the usual cause.
   Same question for `.claude/agents/` in this project.
8. **Duplicate hooks.** Is the same script registered both in
   `~/.claude/settings.json` and by a plugin? Symptom: the session-start block
   prints twice. Compare the two hook lists, do not assume.
9. **Permissions posture.** Read `permissions` in `~/.claude/settings.json`.
   If `defaultMode` is `"auto"` (or anything that auto-approves) check what is in
   `deny`. Instructions in a CLAUDE.md are context, not enforcement — a rule like
   "never run git on your own initiative" holds only until a model decides
   otherwise. Anything the user treats as a hard rule belongs in `permissions.deny`
   as well, e.g. `"deny": ["Bash(git:*)"]`. Report the gap; the user decides.
   Note that a project can set its own `deny` — check whether this one does, and
   whether the protection therefore disappears in their *other* projects.
10. **The personal layer.** Does `~/.claude/CLAUDE.md` exist? A project CLAUDE.md
    that says "my working agreement applies here" while no such file exists is a
    dangling reference. Conversely, preferences repeated in every project
    CLAUDE.md belong there once instead.

Show the audit to the user and say what you propose to move where. **Do not
restructure a repo you have only just opened without showing this first.**

Findings 7–10 are almost always the user's to fix: a plugin cannot write
`~/.claude/CLAUDE.md` or `~/.claude/settings.json` permissions. Hand over the
exact change rather than attempting it.

## Step 2 — Preserve before you delete

Content in a legacy store is usually real, hard-won knowledge. It is the
*loading* that was wrong, not the writing. Never delete a legacy store until its
content has landed somewhere. For each fact in it, ask:

- **True in every session, for every file?** → `CLAUDE.md`. Rare — build commands,
  the hard rules, the definition of done, how to verify.
- **Durable but scoped to some files?** → a `.claude/rules/` file with `paths:`.
  This is where most of it goes.
- **Derivable from the code?** → delete it. Directory tours, dependency lists,
  architecture overviews, file inventories. The cartographer regenerates these on
  demand and cannot go stale the way a written copy does.
- **About the user, or a correction, or a decision?** → leave it; auto memory takes it.
- **About work in flight?** → the task vault.

Back up what you replace (`CLAUDE.md.pre-migration.bak`) and tell the user where
the backup is.

## Step 3 — Write the rules files

Group by **what the reader is touching**, not by topic. A rule earns its keep
when its `paths:` are narrow enough that it is absent most of the time.

```markdown
---
paths:
  - "src/features/**"
  - "src/pages/**"
---

# Working inside a feature
...
```

Rules of thumb:

- Every rule file gets `paths:`. No exceptions — an unscoped rule belongs in
  CLAUDE.md or nowhere.
- If two rules would always match together, they are one rule.
- If a rule matches all of `src/**`, it had better be the single most important
  convention in the repo. One such rule is defensible; three is a handbook.
- Dense agent notes, not prose docs: invariants, terse bullets, the non-obvious.
  Skip rationale and examples unless they prevent a likely mistake.
- A gotcha is worth more than a description. "X is at Y" is derivable; "X looks
  like it is at Y but is actually at Z, and docs/12 says otherwise" is not.

## Step 4 — Trim CLAUDE.md

Target ≤200 lines; aim for ~150. Keep:

- How to run, build and verify — and whatever the user does *not* want run
  automatically.
- The hard rules, one line each, with a pointer to the rule file for detail.
- The definition of done.
- What automations exist (hooks, subagents, skills, MCP), briefly.
- A table of the rule files and what each covers, so the layout is discoverable.

Cut: directory tours, dependency lists, architecture narration, anything a
`ls`/`Grep` answers, anything a rule file now owns, and any instruction that is
really a personal preference (that belongs in `~/.claude/CLAUDE.md`, once,
globally — not re-typed per project).

## Step 5 — Confirm the shared pieces are active

These ship with the `agent-os` plugin, so normally there is nothing to install —
just confirm they are working and wire up anything project-specific:

- **`feature-cartographer`** answers "how is X built" and accumulates a per-repo
  map under `.claude/agent-memory/feature-cartographer/`. Decide with the user
  whether that map is committed (useful shared knowledge for a team) or ignored
  (add `.claude/agent-memory/` to `.gitignore`). Check it appears in `/context`
  under Custom Agents.
- **The session-resume hook** prints the where-you-left-off block at every
  session start. If this project keeps a handoff note at a path the hook does not
  already check, say so — the candidate paths are listed in the hook source, and
  changing them is a plugin change, not a project one.

If an agent or the hook is missing, the plugin is not loaded. Say so and point
the user at `/plugin` rather than writing a project-local copy — a per-project
fork of a shared tool is how the two silently drift apart.

## Step 6 — Verify, with numbers

Do not declare success on vibes. Show:

- `wc -l CLAUDE.md` — under 200.
- Every `.claude/rules/*.md` has `paths:` frontmatter (check it, do not assume).
- Every hook command in `settings.json` points at a file that exists.
- `settings.json` still parses as JSON.
- Before/after startup byte count: old always-loaded total vs new, converted to a
  rough token figure (bytes ÷ 4).

Then tell the user what moved where, in a table, and what is left for them.

## What this skill will not do

- It will not write facts it has not verified in the repo. An invented rule is
  worse than a missing one, because it will be trusted.
- It will not delete a legacy store before its content has landed.
- It will not add a memory MCP server. A knowledge graph solves retrieval over
  unstructured memory; the common failure is that nothing was *written*, which a
  graph does not fix and which the cartographer's memory does — with no database,
  no embedding step, and no tokens in the main window.
