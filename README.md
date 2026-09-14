# claude-agent-os

A context-engineered agent system for [Claude Code](https://claude.com/claude-code).

Most agent setups fail the same way: they put everything the agent might need
into context on every single turn. A handbook `CLAUDE.md`, a memory bank read at
every startup, a pile of always-loaded rules. You pay for all of it on every
decision, and it still does not answer the two questions you actually have each
morning — *where did I stop yesterday*, and *how is this feature currently built*.

`agent-os` is built on one idea: **storing a fact and loading a fact are
different acts.** Store as much as you like. Load almost none of it.

## Install

```
/plugin marketplace add sayansr26/claude-agent-os
/plugin install agent-os@sayan-plugins
```

Then, in any project:

```
/agent-os:memory-bootstrap
```

It audits what the project already has, shows you the numbers before touching
anything, and builds the rest. It also checks the layer around the project —
user-scope agents shadowing plugin ones, the same hook registered twice, and
whether your permission settings actually enforce the rules your CLAUDE.md
merely states.

## What you get

**A memory layer that costs nothing at rest.**

| Tier | Lives in | Loads at startup | Holds |
|---|---|---|---|
| Always-loaded | `CLAUDE.md`, ≤200 lines | small, fixed | What is true in *every* session |
| On-demand | `.claude/rules/*.md` with `paths:` | **nothing** | Durable facts scoped to some files |
| Self-writing | Claude Code auto memory | index only | Corrections, preferences, decisions |
| Explored | agent memory | **nothing** | How each feature is actually built |

A rule with `paths: ["src/api/**"]` is absent until you touch `src/api`. You can
add a hundred of them and startup cost does not move.

**A cartographer that remembers.** Ask "how is checkout built?" — the first time,
it explores in its own context window and returns forty lines: entry point, the
files that matter, the state, the network edge, what gates it, and the blast
radius. Then it writes the map to disk. Every time after, it answers from the
map. Either way your main context pays only for the answer.

**Agents that read your rules instead of hardcoding them.** `orchestrator`,
`architect`, `builder`, `reviewer`, `tester`, `documenter`. Every one of them
reads `CLAUDE.md` and the matching `.claude/rules/` before acting — so the same
agent set behaves correctly in a Next.js monorepo and a Django service, because
the project-specific part lives in the project, not in the agent.

**A resume block on every session start.** Branch, recent commits, uncommitted
files, and your handoff note if you keep one. Capped at forty lines, fails
silent, never writes anything.

## The design rules behind it

These are what the agents are actually built on, and they are worth stealing even
if you never install this.

1. **A rules file without `paths:` frontmatter is a `CLAUDE.md` in disguise.**
   Scope it or move it.
2. **Never write down what the code already says.** Directory tours, dependency
   lists and architecture narration read as valuable, go stale first, and mislead
   hardest — because they look authoritative. Explore them on demand instead.
3. **A gotcha is worth ten descriptions.** "X is at Y" is derivable. "X looks like
   it is at Y but is actually at Z, and the docs say otherwise" is not.
4. **Verbose work belongs in a subagent.** Search results, logs and file dumps
   should never enter the conversation you are trying to keep.
5. **Agent memory is `project`-scoped, not `user`.** User scope leaks one repo's
   knowledge into every other repo you open.
6. **An honest "I could not verify this" beats a confident summary.** Every agent
   here is told to separate what it ran from what it assumed.
7. **A CLAUDE.md rule is context, not enforcement.** "Never run git on your own
   initiative" holds until a model decides otherwise. If you would be upset when
   it is broken, it belongs in `permissions.deny` or a `PreToolUse` hook as well —
   write it in both places, and let the instruction explain what the guard blocks.

## Requirements

Claude Code, and `node` on your PATH for the session-resume hook. No database, no
embedding step, no MCP server, no external service.

## Not included, on purpose

No knowledge-graph backend. Graph memory solves retrieval over a large
unstructured store; the common failure is that nothing gets *written*, which a
graph does not fix and per-agent memory does — with no infrastructure and no
tokens in your main window.

No user-level `CLAUDE.md`. Claude Code plugins cannot ship one, and they should
not: your working preferences are yours. Keep them in `~/.claude/CLAUDE.md`.

## Development

```bash
git clone https://github.com/sayansr26/claude-agent-os
claude --plugin-dir ./claude-agent-os/plugins/agent-os
claude plugin validate ./claude-agent-os/plugins/agent-os
```

`/reload-plugins` picks up changes without restarting.

## License

MIT
