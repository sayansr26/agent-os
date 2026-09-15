# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/sayansr26/claude-agent-os/releases/tag/v0.2.0
[0.1.5]: https://github.com/sayansr26/claude-agent-os/releases/tag/v0.1.5
[0.1.4]: https://github.com/sayansr26/claude-agent-os/releases/tag/v0.1.4
[0.1.3]: https://github.com/sayansr26/claude-agent-os/releases/tag/v0.1.3
[0.1.2]: https://github.com/sayansr26/claude-agent-os/releases/tag/v0.1.2
[0.1.1]: https://github.com/sayansr26/claude-agent-os/releases/tag/v0.1.1
[0.1.0]: https://github.com/sayansr26/claude-agent-os/releases/tag/v0.1.0
