# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] — 2026-09-15

Found by running 0.5.0 against a real repository that already had six
path-scoped rules and a hand-written `AGENTS.md`. It overwrote the
`AGENTS.md`. 0.5.0 was never published.

### Added
- **`init` installs the Claude Code plugin.** When Claude Code is detected it
  runs `claude plugin marketplace add` and `claude plugin install --yes` at
  project scope, so the plugin travels with the repository rather than living
  on one machine. If the `claude` CLI is not on PATH it prints the two slash
  commands instead. `--no-plugin` skips it, and the rules are written either
  way — the compiler never depends on the plugin step succeeding.

### Fixed
- **`init` scaffolded over projects that already had rules.** It wrote a
  placeholder `AGENTS.md` and an `example.md` rule regardless of what was
  there, and the next `sync` compiled the placeholder on top of the project's
  real `AGENTS.md`. `init` now adopts what it finds — the existing `AGENTS.md`
  and the first rules directory it recognises, `.cursor/rules/*.mdc` converted
  back to `paths:` — and seeds `example.md` only when there was nothing to
  adopt. A tool for stopping rule drift must not cause it.
- **`sync` now refuses to overwrite a file it did not generate.** Generated
  files carry a banner; anything else at a generated path is the user's own
  work. `sync` names those files, leaves them alone and exits non-zero, with
  `--force` as the explicit opt-out. `AGENTS.md` carries the banner too — it
  previously did not, which is why nothing could tell it apart.

## [0.5.0] — 2026-09-15

`agent-os` becomes a cross-tool CLI. The Claude Code plugin is now one target
among several rather than the whole product.

### Added
- **`npx @sayansr26/agent-os`** — `init`, `sync`, `check`, `detect`, `audit`,
  `memory`. Published to npm; no install required. The name is scoped because
  unscoped `agent-os` collides with an existing `agentos` package under npm's
  similarity check.
- **A canonical source** at `.agent-os/` — `config.json`, `AGENTS.md`,
  `rules/`, `skills/` — compiled outward to each tool in its own schema.
- **Eight compile targets.** Claude Code and Cline take `paths:` verbatim.
  Cursor gets `.mdc` with `description`/`globs`/`alwaysApply`. Windsurf gets
  `trigger:` and a 12,000-character cap. Antigravity gets plain Markdown plus a
  stated intended scope, because its glob syntax is undocumented and UI-set.
  Gemini CLI, OpenCode and Kilo have no conditional loading, so they get
  `AGENTS.md` plus an instructions list, merged into their existing config
  rather than overwriting it.
- **`AGENTS.md` for everything else** — read natively by 35+ tools.
- **Skills compiled to `.agents/skills/`**, which Cursor, Windsurf, Antigravity
  and Gemini CLI all read, so four vendors are served by one directory. Claude
  Code and Cline get their own copies.
- **`check`** exits non-zero when a generated file no longer matches source, so
  drift fails CI instead of being discovered later.
- **A compiler self-test** (`npm test`) that scaffolds a throwaway project,
  compiles all eight targets and asserts each tool's real schema — plus drift
  detection and merge-not-overwrite. CI additionally installs the packed
  tarball and runs the CLI from it, because the checkout is not what users get.

### Changed
- Repository and package renamed from `claude-agent-os` to `agent-os`.
- Documentation is generic throughout; examples are invented.

### Fixed
- `check` reported every skill file as drifted immediately after a `sync`. Skill
  files are read as buffers so a skill can ship a binary asset, rule files are
  generated as strings, and the two were compared with `!==`. Comparison is now
  per kind.
- The audit listed `.cursor/rules/` and `.clinerules` as legacy stores to fold
  into `CLAUDE.md` and delete, even when `agent-os` had just generated them —
  advice that would have destroyed the compiled output. Directories whose files
  all carry the generated banner are now reported as generated, not legacy.

### Notes
- Hooks are not compiled. Events and control protocols differ per tool with no
  honest common denominator.
- The memory layer stays Claude Code only — it is the only target with somewhere
  to put it. Windsurf has native memories but no documented write path.
- Roo Code shut down in May 2026 and is not a target. Windsurf is now Devin
  Desktop, though its `.windsurf/` paths are unchanged.

## [0.4.0] — 2026-09-15

### Added
- `/agent-os:memory` — inspect, repair and edit what a project remembers: agent
  memory, Claude Code auto memory and `.claude/rules/`. Script-backed, read-only
  by default. `--stale` compares each map's `mapped:` date against the last commit
  touching the file it describes. Arguments: `list`, `show`, `clean`, `forget`,
  `stale`.
- `/agent-os:map` — build or refresh the architecture map and per-feature maps,
  dispatched to `feature-cartographer` so file reads never enter the main
  conversation. Arguments: `architecture`, `<feature>`, `refresh`.
- `/agent-os:init` gains `audit` and `settings` arguments.
- The audit now recommends the extension mechanisms a project could use — nested
  `CLAUDE.md`, a `PostToolUse` lint hook, a `PreToolUse` guard, the `context7` MCP
  server, project skills, a project subagent, `Read` deny rules — each gated on
  evidence in the repository rather than offered as a checklist.

### Notes
- Three skills with argument dispatch rather than one skill per verb. Skill
  descriptions load on every turn in every project; eight skills would have cost
  roughly 2.5 KB resident. Three cost 636 B, taking the plugin from 636 to 786
  tokens per turn.
- The settings pass **proposes and never applies**. `permissions.deny` is the
  guardrail on the agent's own behaviour, and a skill that edits its own
  guardrails unasked is the thing that setting exists to prevent.

## [0.3.0] — 2026-09-15

The goal is not smaller context. It is that every project **has** an
architectural memory, so a request like "change the login flow from email to OTP"
runs off known structure and known conventions instead of rediscovering the
codebase. Smaller context is the consequence.

### Added
- **The architecture map.** `_architecture.md` is now first-class in
  `feature-cartographer`'s memory — stack, layers, where a request enters and how
  it reaches data, state, network edge, auth model, the files a newcomer reads
  first. The cartographer reads it before anything else, so a feature question
  explores a fraction of what it would cold, and must correct it in the same turn
  when a change contradicts it.
- **`references/establishing.md`** — build a context layer *from* an existing
  codebase. The convention-extraction method: find at least three independent
  examples, read them fully, write down only what all three agree on, note what
  varies as drift rather than picking a winner, and cite the files. One file is a
  sample, two is a coincidence, three that agree is a convention.
- **`references/changing-a-feature.md`** — the workflow for changing code that
  already exists: cartographer answers *how is it built* → find the nearest
  precedent → path-scoped rules load themselves → `builder` works from the map and
  precedent rather than the one-line request → `reviewer` checks against written
  rules → **the cartographer updates the map in the same turn**.
- Audit detects stack and source scale, and emits a `MODE`: `TOO-EARLY`,
  `ESTABLISH`, `MAP`, `MIGRATE` or `MAINTAIN`, which decides what the run is for.
- Audit recommends the official code intelligence plugin for the detected
  language, and `Read` deny rules for checked-in generated or vendored paths.

### Changed
- `init` was a migration tool. On a fresh project it found nothing and had nothing
  true to write, and the undefined behaviour there invited inventing conventions.
  `TOO-EARLY` now says so explicitly and builds nothing; `ESTABLISH` builds the
  layer from the code.
- The skill defers to Claude Code's own `/init` and `/doctor` for the first
  `CLAUDE.md` draft instead of duplicating them.

## [0.2.0] — 2026-09-15

### Added
- `skills/init/scripts/audit.mjs` — the whole audit in one call. The checks are
  deterministic, so discovering them with a dozen Read and Grep round trips was
  most of what `init` cost. Read-only, exits 0 on failures so a partial audit
  still reaches the caller.
- Detection for unindexed and near-duplicate agent-memory topic files. Found by
  dogfooding: an agent had written six files for one subject across sessions with
  only one of them indexed, so five were invisible and kept being rewritten.
- `scripts/validate-plugin.mjs` and CI. Runs with no auth or network.

### Changed
- `SKILL.md` 9,563 → 4,391 B. Steps 2–6 moved into `references/`, loaded only
  when a finding calls for them. A clean project now costs about a tenth of what
  it did end to end.
- Agent descriptions rewritten. Descriptions load on every turn in every project;
  bodies do not. Replacing the `<example>` blocks with dense trigger sentences cut
  resident context from 4,696 B to 2,545 B — 1,174 → 636 tokens per turn.

### Fixed
- Agent frontmatter. A scripted edit dropped the closing `---` delimiter in six
  agents and wrote `—` escapes instead of em dashes, so every field but the
  filename-derived name was silently dropped at load time. The validator added in
  this release exists specifically to catch it.

## [0.1.5] — 2026-09-14

### Fixed
- Every agent now carries an explicit memory protocol: read `MEMORY.md` first,
  one kebab-case file per subject, index every file in the same turn, merge
  near-duplicates. Only `feature-cartographer` had this before; the others just
  said "update your MEMORY.md" and invented a new filename each session.

## [0.1.4] — 2026-09-14

### Added
- `references/git-permissions.md` — a deny set that blocks every git command
  which changes the repository while leaving read-only inspection available.

### Changed
- `init` no longer recommends the broad `Bash(git:*)` form by default. A
  per-subcommand list is bypassed by `git -C`, `git -c` and
  `--git-dir`/`--work-tree`, so the reference denies those flag forms too — which
  is what makes the rest of it hold. What quoting still defeats is documented
  rather than glossed over.

## [0.1.3] — 2026-09-14

### Changed
- Documented that `Bash(git commit *)` matches literally on the words before the
  first `*`, and that deny rules cannot carry allow exceptions.

## [0.1.2] — 2026-09-14

### Changed
- Skill renamed `memory-bootstrap` → `init`, so `/agent-os:init` works. The
  description now carries natural-language triggers as well.

## [0.1.1] — 2026-09-14

### Added
- Machine-layer audit: user-scope agents or skills shadowing plugin components,
  the same hook registered twice, and whether `permissions.deny` enforces what a
  `CLAUDE.md` merely states.

## [0.1.0] — 2026-09-14

Initial release: the memory layer, `feature-cartographer`, six coordinated
agents, the session-resume hook, and the setup skill.

[0.5.0]: https://github.com/sayansr26/agent-os/releases/tag/v0.5.0
[0.4.0]: https://github.com/sayansr26/agent-os/releases/tag/v0.4.0
[0.3.0]: https://github.com/sayansr26/agent-os/releases/tag/v0.3.0
[0.2.0]: https://github.com/sayansr26/agent-os/releases/tag/v0.2.0
[0.1.5]: https://github.com/sayansr26/agent-os/releases/tag/v0.1.5
[0.1.4]: https://github.com/sayansr26/agent-os/releases/tag/v0.1.4
[0.1.3]: https://github.com/sayansr26/agent-os/releases/tag/v0.1.3
[0.1.2]: https://github.com/sayansr26/agent-os/releases/tag/v0.1.2
[0.1.1]: https://github.com/sayansr26/agent-os/releases/tag/v0.1.1
[0.1.0]: https://github.com/sayansr26/agent-os/releases/tag/v0.1.0
