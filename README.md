# claude-agent-os

**A Claude Code plugin for context engineering.** Gives every project a durable architectural memory, so a request like *"change the login flow from email to OTP"* runs off known structure and known conventions instead of rediscovering the codebase from a cold grep.

No database, no embeddings, no MCP server.

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

### Commands

| | |
|---|---|
| `/agent-os:init` | Audit the project, then establish or repair its context layer. `audit` to report only, `settings` for the permissions pass. |
| `/agent-os:map` | Build the architecture map, or map one feature. `refresh` re-maps what has drifted. |
| `/agent-os:memory` | Inspect and repair what the project remembers. `clean`, `forget <x>`, `stale`. |

Plus seven agents you ask for by name, not by slash command.

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

## How do I change a feature without re-reading the codebase?

This is the thing the whole design exists for. Say the request is *"change the login flow from email to OTP"*.

The instinct is to grep for `login` and start opening files. That burns context, finds the obvious call sites, misses the non-obvious ones, and produces a change written in the model's default style rather than this codebase's.

Instead:

**1. The cartographer answers how it is built** — reading the architecture map first, exploring only what is missing, in *its* context window:

```
Entry:      src/features/auth/login.tsx:24 (route /login)
Renders:    LoginForm.themed.tsx, OtpDialog.tsx (already exists — used by password reset)
State:      auth.slice — also read by RoleProvider, PermissionProvider
Network:    services/auth.api.ts -> POST /auth/login, POST /auth/refresh

Blast radius
- useAuth() — imported by 14 files outside this feature

Watch out
- OtpDialog already exists for password reset; reuse it rather than writing one
```

That last line is the argument for all of this. A cold grep for `login` never finds it, and you ship a second OTP dialog.

**2. Find the nearest precedent** — what did this codebase already do that resembles this change? Matching an existing precedent beats a cleaner design that matches nothing else in the repo.

**3. The rules load themselves.** Touching `src/features/auth/` pulls in the feature rules; touching a service pulls in the service conventions. Nothing to fetch, nothing to paste.

**4. `builder` works from the map and the precedent**, not from the one-line request — and matches the nearest existing example for anything the rules do not cover.

**5. `reviewer` checks against written rules** first, then correctness and the seams.

**6. The cartographer updates the map in the same turn.** This is the step everyone skips, and skipping it is how a map becomes confidently wrong.

| | Cold | With the map |
|---|---|---|
| Finding how it works | 15–30 file reads in your context | ~40 lines from a subagent |
| Finding the conventions | re-derived, inconsistently | loaded automatically by path |
| Finding the precedent | usually missed | named in the map |
| Second change to the same area | the same cost again | near zero |

## How do I set this up on a project that has nothing?

`/agent-os:init` audits first and reports a `MODE` that decides what the run is for:

| MODE | What happens |
|---|---|
| `TOO-EARLY` | **Nothing is built.** Barely any source — a layer over an empty project is invented conventions. Write code, run Claude Code's `/init`, come back. |
| `ESTABLISH` | Real code, no layer. Builds one *from the code*. |
| `MAP` | Layer healthy, never mapped. Builds the architecture map. |
| `MIGRATE` | Layer exists with problems — legacy `memory-bank/`, an over-budget `CLAUDE.md`, a hook pointing at a deleted script. |
| `MAINTAIN` | Healthy and mapped. Reports and stops. |

The rule throughout: **everything written must be observed in your repository.** Not what the model knows about React. A convention is what at least three independent examples agree on — one file is a sample, two a coincidence — and every rule cites the files it came from, so it can be re-checked later.

It also flags what Claude Code offers that you are not using: the official code intelligence plugin for your language (jumping to a definition beats scanning the tree), `Read` deny rules for checked-in generated code, a lint hook when a linter config exists but nothing runs it, `context7` when your dependencies move faster than model training. Each gated on evidence in the repo, not offered as a checklist.

---

## The agents

`orchestrator` · `architect` · `builder` · `reviewer` · `tester` · `documenter` · `feature-cartographer`

Every one reads your `CLAUDE.md` and the matching `.claude/rules/` before acting — so the same agent set behaves correctly in a Next.js monorepo and a Django service, because the project-specific part lives in the project, not baked into the agent.

All use `memory: project` scope, so one repo's knowledge never leaks into another. `feature-cartographer` keeps `_architecture.md` — stack, layers, how a request reaches data, the auth model, the files a newcomer reads first — and reads it before anything else, so every feature question starts from the skeleton rather than cold.

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
