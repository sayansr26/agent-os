#!/usr/bin/env node
/**
 * Inspect every memory store this project has, and check each one's health.
 * Read-only. The deterministic half of `/agent-os:memory`.
 *
 * Usage: node memory.mjs [projectDir] [--stale]
 *   --stale  also compare each map's `mapped:` date against git's last commit
 *            touching the file it describes, so you can see what has drifted.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const ROOT = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) || process.cwd();
const STALE = process.argv.includes("--stale");
const HOME = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const ls = (p) => { try { return readdirSync(p); } catch { return []; } };
const git = (c) => { try { return execSync(c, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 4000 }).trim(); } catch { return ""; } };

const out = [], issues = [];
const say = (s = "") => out.push(s);

say(`MEMORY STORES   ${ROOT}\n`);

// ---- agent memory ----
for (const [scope, dir] of [["project", join(ROOT, ".claude/agent-memory")], ["local", join(ROOT, ".claude/agent-memory-local")]]) {
  if (!existsSync(dir)) continue;
  for (const agent of ls(dir).sort()) {
    const adir = join(dir, agent);
    const files = ls(adir).filter((f) => f.endsWith(".md"));
    const topics = files.filter((f) => f !== "MEMORY.md");
    const idxRaw = read(join(adir, "MEMORY.md"));
    const idx = idxRaw ? idxRaw.split("\n").filter((l) => l.trim().startsWith("-")) : [];

    say(`${agent}  (${scope})`);
    say(`  index: ${idx.length} entr${idx.length === 1 ? "y" : "ies"}   topics: ${topics.length} file(s)`);

    // which topic files are not referenced anywhere in the index
    const orphans = topics.filter((f) => !idxRaw || !idxRaw.includes(basename(f, ".md")));
    // hyphen/underscore collisions — the same subject written twice
    const norm = (f) => basename(f, ".md").replace(/[-_]/g, "").toLowerCase();
    const seen = {};
    const dupes = [];
    for (const f of topics) { const k = norm(f); if (seen[k]) dupes.push([seen[k], f]); else seen[k] = f; }

    for (const f of topics.sort()) {
      const t = read(join(adir, f)) || "";
      const mapped = (t.match(/^mapped:\s*(\S+)/m) || [])[1];
      const entry = (t.match(/^entry:\s*(\S+)/m) || [])[1];
      let note = "";
      if (orphans.includes(f)) note += "  NOT IN INDEX";
      if (STALE && mapped && entry) {
        const last = git(`git log -1 --format=%cs -- ${JSON.stringify(entry)}`);
        if (last && last > mapped) note += `  STALE (mapped ${mapped}, code changed ${last})`;
      }
      say(`    ${f.padEnd(34)} ${String(t.split("\n").length).padStart(4)} lines${mapped ? `  mapped ${mapped}` : ""}${note}`);
    }
    if (orphans.length) issues.push(`${agent}: ${orphans.length} topic file(s) not in MEMORY.md — invisible next session: ${orphans.join(", ")}`);
    for (const [a, b] of dupes) issues.push(`${agent}: "${a}" and "${b}" are the same subject — merge them`);
    if (idxRaw && idxRaw.split("\n").length > 200) issues.push(`${agent}: MEMORY.md over 200 lines — everything past that is dropped at startup`);
    say();
  }
}
if (!out.some((l) => l.includes("index:"))) say("no agent memory yet — agents have not run in this project\n");

// ---- Claude Code auto memory ----
const repo = git("git rev-parse --show-toplevel") || ROOT;
const slug = repo.replace(/\//g, "-");
const autoDir = join(HOME, "projects", slug, "memory");
say("auto memory (Claude Code's own)");
if (!existsSync(autoDir)) say(`  none yet at ${autoDir}`);
else {
  const idx = read(join(autoDir, "MEMORY.md"));
  const topics = ls(autoDir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  say(`  ${autoDir}`);
  say(`  MEMORY.md: ${idx ? idx.split("\n").length + " lines" : "absent"}   topics: ${topics.length}`);
  for (const f of topics.sort()) say(`    ${f}`);
  if (idx && idx.split("\n").length > 200) issues.push("auto memory MEMORY.md over 200 lines — content past that is dropped at startup");
}

// ---- rules, the other durable store ----
const rules = ls(join(ROOT, ".claude/rules")).filter((f) => f.endsWith(".md"));
say();
say(`project rules  .claude/rules/  — ${rules.length} file(s)`);
for (const f of rules.sort()) {
  const t = read(join(ROOT, ".claude/rules", f)) || "";
  const scoped = /^paths:/m.test(t.split("---")[1] || "");
  say(`  ${scoped ? "scoped  " : "UNSCOPED"} ${f}`);
  if (!scoped) issues.push(`.claude/rules/${f} has no paths: — it loads every session`);
}

say();
if (!issues.length) say("HEALTH  no issues.");
else { say(`HEALTH  ${issues.length} issue(s):`); for (const i of issues) say("  - " + i); }
process.stdout.write(out.join("\n") + "\n");
