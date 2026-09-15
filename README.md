# claude-agent-os

**A Claude Code plugin for context engineering** — per-project agent memory, a codebase-mapping agent, path-scoped `CLAUDE.md` rules, and a coordinated subagent set. No database, no embeddings, no MCP server.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-6b4fbb)](https://code.claude.com/docs/en/plugins)

Measured on a 290k-LOC React codebase: **startup context fell from ~6.2k tokens to ~2.7k**, and the `init` audit itself went from ~30 KB of file reads to a single 1.8 KB call.

---

## Install

```
/plugin marketplace add sayansr26/claude-agent-os
/plugin install agent-os@sayan-plugins
```

Then in any project:

```
/agent-os:init
```

Not for you? One line to remove it, nothing left behind:

```
/plugin uninstall agent-os@sayan-plugins
```

To update later:

```
/plugin marketplace update sayan-plugins
/reload-plugins
```

**Requirements:** Claude Code, and `node` on your PATH for the session-resume hook.

---

## The problem

Most Claude Code setups fail the same way. A handbook `CLAUDE.md`. A `memory-bank/` read at every startup. A pile of always-loaded rules. You pay for all of it on every single turn — and it still doesn't answer the two questions you actually have each morning:

- *Where did I stop yesterday?*
- *How is this feature currently built?*

`agent-os` is built on one idea: **storing a fact and loading a fact are different acts.** Store as much as you like. Load almost none of it.

---

## How the memory layer works

| Tier | Lives in | Loads at startup | Holds |
|---|---|---|---|
| Always-loaded | `CLAUDE.md`, ≤200 lines | small, fixed | What is true in *every* session |
| On-demand | `.claude/rules/*.md` with `paths:` | **nothing** | Durable facts scoped to some files |
| Self-writing | Claude Code auto memory | index only | Corrections, preferences, decisions |
| Explored | agent memory | **nothing** | How each feature is actually built |

A rule with `paths: ["src/api/**"]` is absent from context until you touch `src/api`. Add a hundred of them and startup cost does not move.

---

## How do I stop my CLAUDE.md getting too big?

Run `/agent-os:init`. It audits first and shows you the numbers before touching anything:

```
ALWAYS-LOADED  (cost on every turn)
  CLAUDE.md                       755 lines   31204 B  OVER BUDGET (>200)

RULES  .claude/rules/  — 0 file(s)
  (no rules directory)

LEGACY STORES
  FOUND memory-bank/           7 file(s)  42104 B

VERDICT  4 finding(s), worst first:
  FAIL  PostToolUse hook points at .claude/hooks/gone.sh, which does not exist.
  WARN  CLAUDE.md is 755 lines; budget is 200.
```

Then it migrates: durable-but-scoped facts into path-scoped rules, derivable facts deleted rather than rewritten, legacy stores preserved before anything is removed.

It also audits the layer *around* the project — user-scope agents shadowing plugin ones, the same hook registered twice, and whether your permission settings actually enforce the rules your `CLAUDE.md` merely states.

---

## How do I find where I left off in Claude Code?

A `SessionStart` hook prints it before you type anything:

```
## Where you left off

Branch: `feat/attendance-admin`

Recent commits:
  307123c  wire attendance mock seam  (14 hours ago)

Uncommitted (3):
   M src/features/attendance/index.themed.tsx
  ?? src/features/attendance/services/attendance.mock.ts

Handoff note (obsidian/session-handoff.md, today):
  Next task: hook attendance-admin to the real endpoint.
```

Capped at 40 lines, fails silent, never writes anything.

---

## How do I find how a feature is implemented?

Ask the `feature-cartographer`:

> use the feature-cartographer to map the checkout flow

The first time it explores in **its own context window** and returns ~40 lines — entry point, the files that matter, the state, the network edge, what gates it, and the blast radius. Then it writes the map to disk. Every time after, it answers from the map.

Either way your main context pays only for the answer, never the exploration.

---

## The agents

`orchestrator` · `architect` · `builder` · `reviewer` · `tester` · `documenter` · `feature-cartographer`

Every one reads your `CLAUDE.md` and the matching `.claude/rules/` before acting — so the same agent set behaves correctly in a Next.js monorepo and a Django service, because the project-specific part lives in the project, not baked into the agent.

All use `memory: project` scope, so one repo's knowledge never leaks into another.

Agents aren't slash commands — ask for them by name, or let Claude pick one from the task.

---

## The design rules behind it

Worth stealing even if you never install this.

1. **A rules file without `paths:` frontmatter is a `CLAUDE.md` in disguise.** Scope it or move it.
2. **Never write down what the code already says.** Directory tours, dependency lists and architecture narration read as valuable, go stale first, and mislead hardest — because they look authoritative. Explore them on demand instead.
3. **A gotcha is worth ten descriptions.** "X is at Y" is derivable. "X looks like it is at Y but is actually at Z, and the docs say otherwise" is not.
4. **Verbose work belongs in a subagent.** Search results, logs and file dumps should never enter the conversation you are trying to keep.
5. **Agent memory is `project`-scoped, not `user`.** User scope leaks one repo's knowledge into every other repo you open.
6. **An honest "I could not verify this" beats a confident summary.** Every agent here separates what it ran from what it assumed.
7. **A `CLAUDE.md` rule is context, not enforcement.** "Never run git on your own initiative" holds until a model decides otherwise. If you'd be upset when it's broken, it belongs in `permissions.deny` or a `PreToolUse` hook too.
8. **A deterministic check should be a script, not a conversation.** Line counts and file existence don't need a model to discover them one Read at a time.

---

## Not included, on purpose

**No knowledge-graph backend.** Graph memory (Graphiti, mem0, Zep) solves retrieval over a large unstructured store. The common failure is that nothing gets *written* — which a graph doesn't fix and per-agent memory does, with no infrastructure and no tokens in your main window.

**No user-level `CLAUDE.md`.** Claude Code plugins can't ship one, and shouldn't: your working preferences are yours. Keep them in `~/.claude/CLAUDE.md`.

---

## Contributing

Issues and PRs welcome. To work on the plugin:

```bash
claude --plugin-dir ./plugins/agent-os     # load your working copy
claude plugin validate ./plugins/agent-os --strict
/reload-plugins                            # pick up edits without restarting
```

## License

MIT © [Sayan Choudhury](https://github.com/sayansr26)
