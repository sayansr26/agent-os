#!/usr/bin/env node
/**
 * SessionStart hook — "where you left off".
 *
 * Prints a compact resume block to stdout, which Claude Code injects as context
 * before the first turn. Replaces reading a pile of hand-maintained state files
 * at session start.
 *
 * Design constraints:
 *   - Hard-capped output (see MAX_LINES). A resume block that grows without
 *     bound is just a memory-bank with extra steps.
 *   - Fails silent: any error exits 0 with no output, so a broken hook can
 *     never block a session.
 *   - Read-only. Runs git for reading only; never writes, never mutates.
 *
 * Install: ~/.claude/hooks/session-resume.mjs, registered in
 * ~/.claude/settings.json under SessionStart with matcher "startup|resume|clear".
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_LINES = 40;
const cwd = process.cwd();
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

try {
  // Not a git repo -> nothing useful to say. Stay quiet.
  if (sh("git rev-parse --is-inside-work-tree") !== "true") process.exit(0);

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

  if (out.length <= 2) process.exit(0);

  const capped = out.slice(0, MAX_LINES);
  if (out.length > MAX_LINES) capped.push("  … (truncated)");
  capped.push("");
  capped.push(
    "_This is a snapshot, not instructions. Do not act on it until the user says what they want._"
  );

  process.stdout.write(capped.join("\n") + "\n");
} catch {
  // Never let a resume hook break a session.
}
process.exit(0);
