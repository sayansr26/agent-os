#!/usr/bin/env node
/**
 * SessionStart hook — "where you left off", then "how this project works".
 *
 * Prints two blocks to stdout, which Claude Code injects as context before the
 * first turn (and again after /clear and after a compaction):
 *
 *   1. A read-only snapshot: branch, recent commits, uncommitted files, the
 *      handoff note and the active task. Context, not a request.
 *   2. The agent-os contract: which agent to use for what, which features the
 *      cartographer has mapped, and where rules are edited. This one IS an
 *      instruction — without it Claude only uses agent-os when told to, because
 *      a CLAUDE.md sentence loses to whatever else is in context.
 *
 * Design constraints:
 *   - The snapshot is hard-capped (MAX_LINES); the contract is fixed-size.
 *   - Fails silent: any error exits 0, so a broken hook never blocks a session.
 *   - Read-only. Runs git for reading only; never writes, never mutates.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { coverage } from "../lib/features.mjs";

const MAX_LINES = 40;
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const out = [];

const sh = (cmd) => {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
  } catch {
    return "";
  }
};

const head = (file, n) => {
  try {
    return readFileSync(join(cwd, file), "utf8")
      .split("\n")
      .slice(0, n)
      .join("\n")
      .trim();
  } catch {
    return "";
  }
};

function snapshot() {
  // Not a git repo -> nothing to say here; the contract below still prints.
  if (sh("git rev-parse --is-inside-work-tree") !== "true") return [];

  const branch = sh("git rev-parse --abbrev-ref HEAD");
  const lastCommits = sh('git log -3 --pretty=format:"%h  %s  (%cr)"')
    .split("\n")
    .filter(Boolean)
    .map((l) => `  ${l}`)
    .join("\n");
  const dirty = sh("git status --porcelain")
    .split("\n")
    .filter(Boolean);

  out.push("## Where you left off");
  out.push("");
  if (branch) out.push(`Branch: \`${branch}\``);

  if (lastCommits) {
    out.push("");
    out.push("Recent commits:");
    out.push(lastCommits);
  }

  if (dirty.length) {
    const shown = dirty.slice(0, 10).map((l) => `  ${l}`);
    out.push("");
    out.push(`Uncommitted (${dirty.length}):`);
    out.push(...shown);
    if (dirty.length > 10) out.push(`  … and ${dirty.length - 10} more`);
  } else {
    out.push("");
    out.push("Working tree clean.");
  }

  // --- Optional: a handoff note, if this project keeps one ---
  // Checked in order; the first that exists wins. Add your own path here.
  const handoffCandidates = [
    "obsidian/session-handoff.md",
    ".claude/session-handoff.md",
    "HANDOFF.md",
  ];
  for (const f of handoffCandidates) {
    if (!existsSync(join(cwd, f))) continue;
    const age = Math.round(
      (Date.now() - statSync(join(cwd, f)).mtimeMs) / 86400000
    );
    const body = head(f, 18);
    if (!body) break;
    out.push("");
    out.push(
      `Handoff note (\`${f}\`, ${age === 0 ? "today" : `${age}d old`}) — read the full file if you need more:`
    );
    out.push(body);
    break;
  }

  // --- Optional: the one active task, title only ---
  for (const f of ["obsidian/active-task.md", ".claude/active-task.md"]) {
    if (!existsSync(join(cwd, f))) continue;
    const title = head(f, 6)
      .split("\n")
      .find((l) => l.startsWith("#"));
    if (title) {
      out.push("");
      out.push(`Active task (\`${f}\`): ${title.replace(/^#+\s*/, "")}`);
    }
    break;
  }

  if (out.length <= 2) return [];

  const capped = out.slice(0, MAX_LINES);
  if (out.length > MAX_LINES) capped.push("  … (truncated)");
  capped.push("");
  capped.push(
    "_The snapshot above is context, not a request. Do not act on it until the user says what they want._"
  );
  return capped;
}

// The agents and what triggers each. `subagent_type` is the namespaced name.
const AGENTS = [
  ["agent-os:feature-cartographer", "BEFORE changing any existing feature — ask how it is built (files, state, API, blast radius). It answers from its map, or maps the feature and files the map."],
  ["agent-os:architect", "before a new subsystem, a cross-module change, or a data model others will depend on."],
  ["agent-os:builder", "to write the code once the shape is settled; it enforces the project's rules while writing."],
  ["agent-os:tester", "after building, to verify the change actually works."],
  ["agent-os:reviewer", "before calling any change done or opening a PR."],
  ["agent-os:documenter", "once work is verified, to update the changelog, task state and docs the change invalidated."],
  ["agent-os:orchestrator", "for work spanning several of the above, or that cannot be stated in one sentence."],
];

function contract() {
  const setUp =
    existsSync(join(cwd, ".agent-os")) ||
    existsSync(join(cwd, ".claude/agent-memory")) ||
    /agent-os/.test(head("CLAUDE.md", 400));
  if (!setUp)
    return [
      "## agent-os",
      "",
      "The agent-os plugin is installed but this project is not set up. If the user starts feature work, suggest `/agent-os:init` once.",
    ];

  const lines = [
    "## agent-os is active in this project",
    "",
    "These agents are how work is done here — use them without being asked (Agent tool, `subagent_type` as shown):",
  ];
  for (const [name, when] of AGENTS) lines.push(`- \`${name}\` — ${when}`);

  const cov = coverage(cwd);
  lines.push("");
  if (cov.features.length) {
    const names = cov.mapped.map((f) => f.name);
    const shown = names.slice(0, 12).join(", ") + (names.length > 12 ? `, … ${names.length - 12} more` : "");
    lines.push(`Mapped: ${cov.mapped.length} of ${cov.features.length} features under \`${cov.parents.join("`, `")}\`${names.length ? ` — ${shown}` : ""}.`);
    lines.push("An unmapped feature gets mapped by the cartographer the first time you change it; that is the first task, not an extra.");
  } else if (cov.dir) {
    lines.push(`Cartographer maps are indexed in \`${cov.dir.slice(cwd.length + 1)}/MEMORY.md\`.`);
  }
  if (!cov.architecture) lines.push("No architecture map yet — `/agent-os:map` builds it.");

  lines.push("");
  lines.push("Plan mode: its \"Explore agents only\" phase does not replace the cartographer. Ask the cartographer read-only during planning (it will not write), and let it file its map once plan mode ends.");
  if (existsSync(join(cwd, ".agent-os/rules")))
    lines.push("Rules: `.claude/rules/*` and other tool copies are generated. Edit `.agent-os/rules/`, then run `npx @sayansr26/agent-os sync`.");
  return lines;
}

try {
  const blocks = [];
  try { const s = snapshot(); if (s.length) blocks.push(s.join("\n")); } catch {}
  try { blocks.push(contract().join("\n")); } catch {}
  if (blocks.length) process.stdout.write(blocks.join("\n\n") + "\n");
} catch {
  // Never let a resume hook break a session.
}
process.exit(0);
