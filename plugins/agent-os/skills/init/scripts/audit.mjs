#!/usr/bin/env node
/**
 * agent-os audit — one call, whole picture.
 *
 * The audit is deterministic: line counts, frontmatter presence, file
 * existence, JSON keys. Having a model discover that with a dozen Read and
 * Grep round trips costs tokens on every one. This emits the lot in a single
 * tool result.
 *
 * Read-only. Never writes, never mutates. Exits 0 even on failures so a
 * partial audit still reaches the caller.
 *
 * Usage: node audit.mjs [projectDir]   (defaults to cwd)
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const ROOT = process.argv[2] || process.cwd();
const HOME = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const out = [];
const findings = [];
const say = (s = "") => out.push(s);
const flag = (sev, msg) => findings.push(`${sev}  ${msg}`);

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const lines = (s) => (s ? s.split("\n").length : 0);
const ls = (p) => { try { return readdirSync(p); } catch { return []; } };
const size = (p) => { try { return statSync(p).size; } catch { return 0; } };
const dirBytes = (p) => ls(p).reduce((n, f) => {
  const fp = join(p, f);
  try { return n + (statSync(fp).isDirectory() ? dirBytes(fp) : statSync(fp).size); } catch { return n; }
}, 0);
const frontmatter = (t) => (t && t.startsWith("---\n")) ? t.slice(4).split("\n---")[0] : "";

say(`AGENT-OS AUDIT   ${ROOT}`);
say(`                 ${new Date().toISOString().slice(0, 10)}`);
say();

// ---------------------------------------------------------- always-loaded
let residentBytes = 0;
say("ALWAYS-LOADED  (cost on every turn)");
for (const f of ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) {
  const t = read(join(ROOT, f));
  if (!t) continue;
  const n = lines(t), b = t.length;
  residentBytes += b;
  const over = n > 200;
  say(`  ${f.padEnd(30)} ${String(n).padStart(4)} lines  ${String(b).padStart(6)} B  ${over ? "OVER BUDGET (>200)" : "ok"}`);
  if (over) flag("WARN", `${f} is ${n} lines; budget is 200. Move path-scoped content to .claude/rules/.`);
}
if (!residentBytes) flag("WARN", "No CLAUDE.md at all — this project has no always-loaded instructions.");

// ---------------------------------------------------------- rules
const rulesDir = join(ROOT, ".claude/rules");
const ruleFiles = ls(rulesDir).filter((f) => f.endsWith(".md"));
say();
say(`RULES  .claude/rules/  — ${ruleFiles.length} file(s)`);
if (!ruleFiles.length && existsSync(rulesDir) === false) say("  (no rules directory)");
for (const f of ruleFiles) {
  const t = read(join(rulesDir, f)) || "";
  const fm = frontmatter(t);
  const scoped = /^paths:/m.test(fm);
  const globs = (fm.match(/-\s+["']/g) || []).length;
  say(`  ${scoped ? "ok  " : "WARN"} ${f.padEnd(26)} ${String(lines(t)).padStart(4)} lines  ${scoped ? `paths: ${globs}` : "NO paths: — loads every session"}`);
  if (!scoped) { residentBytes += t.length; flag("WARN", `.claude/rules/${f} has no paths: frontmatter, so it loads every session like CLAUDE.md.`); }
}

// ---------------------------------------------------------- hooks
const readJson = (p) => { const t = read(p); if (!t) return null; try { return JSON.parse(t); } catch { return "INVALID"; } };
const projSettingsPath = join(ROOT, ".claude/settings.json");
const projSettings = readJson(projSettingsPath);
say();
say("HOOKS  .claude/settings.json");
if (projSettings === null) say("  (no project settings.json)");
else if (projSettings === "INVALID") flag("FAIL", ".claude/settings.json is not valid JSON.");
else {
  const hooks = projSettings.hooks || {};
  if (!Object.keys(hooks).length) say("  (none)");
  for (const [evt, entries] of Object.entries(hooks)) {
    for (const e of entries) for (const h of e.hooks || []) {
      const cmd = h.command || "";
      const m = cmd.match(/\$\{CLAUDE_PROJECT_DIR\}\/([^"']+)/);
      if (!m) { say(`  ok   ${evt.padEnd(14)} ${cmd.slice(0, 60)}`); continue; }
      const target = m[1], exists = existsSync(join(ROOT, target));
      say(`  ${exists ? "ok  " : "FAIL"} ${evt.padEnd(14)} ${target}${exists ? "" : "  <- TARGET MISSING"}`);
      if (!exists) flag("FAIL", `${evt} hook points at ${target}, which does not exist. It fires at a missing path every session.`);
    }
  }
}

// ---------------------------------------------------------- legacy stores
say();
say("LEGACY STORES");
const legacy = [
  ["memory-bank/", join(ROOT, "memory-bank")],
  [".serena/memories/", join(ROOT, ".serena/memories")],
  [".cursorrules", join(ROOT, ".cursorrules")],
  [".cursor/rules/", join(ROOT, ".cursor/rules")],
  [".windsurfrules", join(ROOT, ".windsurfrules")],
  [".clinerules", join(ROOT, ".clinerules")],
];
let anyLegacy = false;
for (const [label, p] of legacy) {
  if (!existsSync(p)) continue;
  anyLegacy = true;
  const isDir = statSync(p).isDirectory();
  const n = isDir ? ls(p).length : 1, b = isDir ? dirBytes(p) : size(p);
  say(`  FOUND ${label.padEnd(22)} ${n} file(s)  ${b} B`);
  flag("INFO", `${label} exists — preserve its content into CLAUDE.md or .claude/rules/ before deleting anything.`);
}
const mcp = readJson(join(ROOT, ".mcp.json"));
if (mcp && mcp !== "INVALID") {
  const servers = Object.keys(mcp.mcpServers || {});
  const graphy = servers.filter((s) => /graphiti|memory|knowledge|mem0|zep|serena/i.test(s));
  say(`  .mcp.json servers: ${servers.join(", ") || "(none)"}`);
  if (graphy.length) flag("INFO", `.mcp.json has memory-ish server(s): ${graphy.join(", ")}. Check they are still wanted.`);
}
if (!anyLegacy) say("  none");

// ---------------------------------------------------------- auto memory + agent memory
say();
say("MEMORY");
for (const [label, dir] of [["agent memory", join(ROOT, ".claude/agent-memory")], ["agent memory (local)", join(ROOT, ".claude/agent-memory-local")]]) {
  if (!existsSync(dir)) continue;
  for (const agent of ls(dir)) {
    const adir = join(dir, agent);
    const files = ls(adir).filter((f) => f.endsWith(".md"));
    const idx = read(join(adir, "MEMORY.md"));
    const idxLines = idx ? idx.split("\n").filter((l) => l.trim()).length : 0;
    const topics = files.filter((f) => f !== "MEMORY.md");
    say(`  ${agent.padEnd(34)} index ${String(idxLines).padStart(3)} line(s)   ${topics.length} topic file(s)`);
    if (idxLines < topics.length) flag("WARN", `${agent}: ${topics.length} topic files but only ${idxLines} indexed in MEMORY.md — the unindexed ones are invisible next session.`);
    const slugs = topics.map((f) => basename(f, ".md").replace(/[-_]/g, ""));
    const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
    if (dupes.length) flag("WARN", `${agent}: near-duplicate topic filenames (hyphen/underscore variants). Merge them.`);
    if (idx && idx.split("\n").length > 200) flag("WARN", `${agent}: MEMORY.md over 200 lines — everything past that is dropped at startup.`);
  }
}
if (!existsSync(join(ROOT, ".claude/agent-memory")) && !existsSync(join(ROOT, ".claude/agent-memory-local")))
  say("  no agent memory yet (agents have not run in this project)");

// ---------------------------------------------------------- machine layer
say();
say("MACHINE  " + HOME);
const g = (p) => join(HOME, p);
const gClaude = read(g("CLAUDE.md"));
say(`  CLAUDE.md${" ".repeat(24)}${gClaude ? `present  ${gClaude.length} B` : "ABSENT"}`);
if (!gClaude && residentBytes) {
  const pc = read(join(ROOT, "CLAUDE.md")) || "";
  if (/~\/\.claude\/CLAUDE\.md/.test(pc)) flag("FAIL", "Project CLAUDE.md refers to ~/.claude/CLAUDE.md, which does not exist — a dangling reference.");
}
for (const d of ["agents", "skills"]) {
  const names = ls(g(d)).map((f) => basename(f, ".md"));
  say(`  ${(d + "/").padEnd(33)}${names.length ? names.join(", ") : "absent"}`);
  const plugin = ["orchestrator", "architect", "builder", "reviewer", "tester", "documenter", "feature-cartographer", "init"];
  const clash = names.filter((n) => plugin.includes(n));
  if (clash.length) flag("FAIL", `~/.claude/${d}/ contains ${clash.join(", ")} — user scope OVERRIDES the plugin's copy, so plugin updates stop reaching you.`);
}
const projAgents = ls(join(ROOT, ".claude/agents")).map((f) => basename(f, ".md"));
const pluginNames = ["orchestrator", "architect", "builder", "reviewer", "tester", "documenter", "feature-cartographer"];
const projClash = projAgents.filter((n) => pluginNames.includes(n));
if (projClash.length) flag("FAIL", `.claude/agents/ contains ${projClash.join(", ")} — shadows the plugin agent of the same name.`);

const gs = readJson(g("settings.json"));
if (gs === "INVALID") flag("FAIL", "~/.claude/settings.json is not valid JSON.");
else if (gs) {
  const perms = gs.permissions || {};
  const deny = perms.deny || [];
  const mode = perms.defaultMode || "(unset)";
  say(`  permissions.defaultMode${" ".repeat(10)}${mode}`);
  say(`  permissions.deny${" ".repeat(17)}${deny.length} rule(s)`);
  if (/auto|accept/i.test(mode) && !deny.length)
    flag("WARN", `defaultMode is "${mode}" with an empty deny list. A CLAUDE.md rule is context, not enforcement — see references/git-permissions.md.`);
  const gHooks = JSON.stringify((gs.hooks || {}).SessionStart || []);
  if (gHooks.includes("session-resume"))
    flag("FAIL", "~/.claude/settings.json also registers session-resume — the plugin registers it too, so the resume block prints twice. Remove the user-scope copy.");
  say(`  SessionStart in user scope${" ".repeat(7)}${(gs.hooks || {}).SessionStart ? "yes" : "no"}`);
} else say("  settings.json                    absent");

// ---------------------------------------------------------- stack + scale
say();
say("PROJECT");
const pkg = readJson(join(ROOT, "package.json"));
const stacks = [];
const dep = (n) => {
  if (!pkg || pkg === "INVALID") return false;
  return !!((pkg.dependencies || {})[n] || (pkg.devDependencies || {})[n]);
};
if (pkg && pkg !== "INVALID") {
  if (dep("next")) stacks.push("Next.js");
  else if (dep("react")) stacks.push("React");
  if (dep("vue")) stacks.push("Vue");
  if (dep("@nestjs/core")) stacks.push("NestJS");
  else if (dep("express")) stacks.push("Express");
  if (dep("typescript")) stacks.push("TypeScript");
  if (dep("prisma") || dep("@prisma/client")) stacks.push("Prisma");
}
for (const [f, label] of [["pyproject.toml", "Python"], ["requirements.txt", "Python"],
                          ["go.mod", "Go"], ["Cargo.toml", "Rust"], ["pom.xml", "Java/Maven"],
                          ["Gemfile", "Ruby"], ["composer.json", "PHP"]])
  if (existsSync(join(ROOT, f)) && !stacks.includes(label)) stacks.push(label);

// source scale — cheap walk, skips the usual noise
const SKIP = new Set(["node_modules", ".git", "dist", "build", "vendor", ".next", "target", "__pycache__", ".venv", "coverage"]);
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|vue|svelte|kt|swift|cs)$/;
let srcFiles = 0, srcBytes = 0, deepest = 0;
(function walk(d, depth) {
  if (depth > 8 || srcFiles > 20000) return;
  for (const e of ls(d)) {
    if (SKIP.has(e) || e.startsWith(".")) continue;
    const fp = join(d, e);
    let st; try { st = statSync(fp); } catch { continue; }
    if (st.isDirectory()) { deepest = Math.max(deepest, depth + 1); walk(fp, depth + 1); }
    else if (CODE.test(e)) { srcFiles++; srcBytes += st.size; }
  }
})(ROOT, 0);
say(`  stack${" ".repeat(28)}${stacks.join(", ") || "not detected"}`);
say(`  source files${" ".repeat(21)}${srcFiles}  (~${Math.round(srcBytes / 1024)} KB)`);

// LSP — the official plugins answer "find the definition" without reading files
const LSP = { TypeScript: "typescript-lsp", Python: "pyright-lsp", Go: "gopls-lsp", Rust: "rust-analyzer-lsp", "Java/Maven": "jdtls-lsp", Ruby: "ruby-lsp", PHP: "php-lsp" };
const wantLsp = stacks.map((s) => LSP[s]).filter(Boolean);
if (wantLsp.length && srcFiles > 50)
  flag("INFO", `Install code intelligence: /plugin install ${wantLsp[0]}@claude-plugins-official — lets Claude jump to a definition instead of scanning files.`);

// generated/vendored code that is checked in costs reads
const genDirs = ["dist", "build", "vendor", "generated", "src/generated", ".next"].filter((d) => existsSync(join(ROOT, d)));
const gi = read(join(ROOT, ".gitignore")) || "";
const unignored = genDirs.filter((d) => !gi.split("\n").some((l) => l.trim().replace(/\/$/, "") === d));
if (unignored.length)
  flag("INFO", `Checked-in generated/vendored dirs (${unignored.join(", ")}) — add Read deny rules so Claude never opens them.`);

// ---------------------------------------------------------- mode
const hasLayer = residentBytes > 0 || ruleFiles.length > 0;
const mapped = existsSync(join(ROOT, ".claude/agent-memory/agent-os-feature-cartographer"));
let MODE;
if (srcFiles < 5 && !hasLayer) MODE = "TOO-EARLY";
else if (!hasLayer) MODE = "ESTABLISH";
else if (anyLegacy || findings.some((f) => f.startsWith("WARN") || f.startsWith("FAIL"))) MODE = "MIGRATE";
else if (!mapped) MODE = "MAP";
else MODE = "MAINTAIN";
say();
say(`MODE  ${MODE}`);
say({
  "TOO-EARLY": "  Barely any source yet. Do not build a context layer over nothing —\n  write code first, then run Claude Code's own /init, then come back.",
  ESTABLISH:   "  Real code, no context layer. Build one FROM THE CODE: read\n  references/establishing.md. Do not invent conventions.",
  MIGRATE:     "  A layer exists but has problems. Fix the findings below;\n  read references/migrating.md for anything legacy.",
  MAP:         "  Layer is healthy but the codebase has never been mapped. Build the\n  architecture map: read references/establishing.md, 'Map the architecture'.",
  MAINTAIN:    "  Layer is healthy and the codebase is mapped. Nothing to set up.",
}[MODE]);

// ---------------------------------------------------------- verdict
say();
say(`STARTUP COST  ~${residentBytes} B  ~= ${Math.round(residentBytes / 4)} tokens  (always-loaded files only)`);
say();
if (!findings.length) say("VERDICT  no findings — setup is clean.");
else {
  say(`VERDICT  ${findings.length} finding(s), worst first:`);
  const order = { FAIL: 0, WARN: 1, INFO: 2 };
  findings.sort((a, b) => order[a.split(" ")[0]] - order[b.split(" ")[0]]);
  for (const f of findings) say("  " + f);
}
process.stdout.write(out.join("\n") + "\n");
