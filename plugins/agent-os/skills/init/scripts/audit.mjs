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
import { coverage } from "../../../lib/features.mjs";
import { GIT_DENY, TODO_ENV } from "./settings.mjs";
import { describeState, setupState } from "./state.mjs";

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
else if (!/agent-os:(feature-cartographer|builder|reviewer)/.test(read(join(ROOT, "CLAUDE.md")) || ""))
  flag("INFO", "CLAUDE.md does not say when to use the agent-os agents — add the \"Agents in this project\" section (references/establishing.md, Step 4b).");

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

// Generated copies edited in place are reverted by the next `sync`, silently.
// A copy whose source body no longer appears in it has drifted.
const srcRulesDir = join(ROOT, ".agent-os/rules");
if (existsSync(srcRulesDir)) {
  const body = (t) => (t.startsWith("---\n") && t.indexOf("\n---\n", 3) !== -1 ? t.slice(t.indexOf("\n---\n", 3) + 5) : t).trim();
  const drifted = [], orphans = [];
  for (const f of ruleFiles) {
    const gen = read(join(rulesDir, f)) || "";
    if (!gen.includes("agent-os: generated from .agent-os/")) continue;
    const src = read(join(srcRulesDir, f));
    if (src === null) { orphans.push(f); continue; }
    if (!gen.includes(body(src))) drifted.push(f);
  }
  say(`  source .agent-os/rules/ — ${drifted.length ? `${drifted.length} generated cop(ies) DRIFTED` : "generated copies match"}`);
  for (const f of drifted) {
    say(`  DRIFT ${f}`);
    flag("WARN", `.claude/rules/${f} was edited in place and differs from .agent-os/rules/${f} — the next sync reverts it. Port the edit to the source, then sync.`);
  }
  for (const f of orphans) flag("WARN", `.claude/rules/${f} is generated but .agent-os/rules/${f} no longer exists — delete it or restore its source.`);
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
      if (/cartographer-reminder/.test(target))
        flag("INFO", `${target} duplicates the plugin's own pre-edit reminder — remove the project copy and its hook entry.`);
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
// A store this tool generated is not legacy — telling someone to fold their
// own compiled output back into CLAUDE.md and delete it would destroy the
// thing `sync` just wrote. Generated files carry the banner; check for it.
const generated = (p) => {
  const files = statSync(p).isDirectory() ? ls(p).map((f) => join(p, f)) : [p];
  const readable = files.filter((f) => statSync(f).isFile());
  return readable.length > 0 &&
    readable.every((f) => (read(f) || "").includes("agent-os: generated from .agent-os/"));
};

let anyLegacy = false, anyListed = false;
for (const [label, p] of legacy) {
  if (!existsSync(p)) continue;
  const isDir = statSync(p).isDirectory();
  const n = isDir ? ls(p).length : 1, b = isDir ? dirBytes(p) : size(p);
  if (generated(p)) {
    say(`  ${label.padEnd(22)} ${n} file(s)  ${b} B  — generated by agent-os, not legacy`);
    anyListed = true;
    continue;
  }
  anyLegacy = true;
  anyListed = true;
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
if (!anyListed) say("  none");

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
    // An agent that writes `.claude/agent-memory/<agent>/x.md` relative to its
    // own memory directory nests a copy of the tree inside it.
    const nested = ls(adir).filter((e) => { try { return statSync(join(adir, e)).isDirectory(); } catch { return false; } });
    for (const d of nested)
      flag("WARN", `${agent}/${d}/ is a folder inside agent memory${d === ".claude" ? " — a memory write resolved against the wrong root" : ""}. Move any topic files up into ${agent}/ and delete it.`);
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

// Git write protection and the task tools, wherever either is set.
{
  const norm = (r) => r.replace(/:\*\)$/, " *)").replace(/\s+/g, " ");
  const denyOf = (st) => new Set(((st && st !== "INVALID" && st.permissions?.deny) || []).map(norm));
  const envOn = (st) => st && st !== "INVALID" && ["1", "true", true].includes((st.env || {})[TODO_ENV]);
  const u = denyOf(gs), pj = denyOf(projSettings);
  const uHave = GIT_DENY.filter((r) => u.has(norm(r))).length, pHave = GIT_DENY.filter((r) => pj.has(norm(r))).length;
  say(`  git write protection            user ${uHave}/${GIT_DENY.length}  project ${pHave}/${GIT_DENY.length}`);
  say(`  env.${TODO_ENV}  user ${envOn(gs) ? "on" : "off"}  project ${envOn(projSettings) ? "on" : "off"}`);
  if (uHave < GIT_DENY.length || pHave < GIT_DENY.length)
    flag("INFO", `git write protection incomplete (user ${uHave}/${GIT_DENY.length}, project ${pHave}/${GIT_DENY.length}) — the settings pass applies it.`);
  if (!envOn(gs) && !envOn(projSettings))
    flag("INFO", `${TODO_ENV} is not on in user or project settings — the settings pass turns it on.`);
}

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

// ---------------------------------------------------------- what to add
// Signals for each extension mechanism Claude Code offers. Only suggest one
// when the repo shows evidence it would help — an unused mechanism is cost.
say();
say("WHAT THIS PROJECT COULD ADD");
const rec = [];

// per-directory CLAUDE.md for monorepos
const pkgDirs = ["packages", "apps", "services", "libs"].filter((d) => existsSync(join(ROOT, d)));
if (pkgDirs.length) {
  const subs = pkgDirs.flatMap((d) => ls(join(ROOT, d)).filter((s) => { try { return statSync(join(ROOT, d, s)).isDirectory(); } catch { return false; } }));
  if (subs.length >= 3) rec.push(["CLAUDE.md (nested)", `${subs.length} packages under ${pkgDirs.join("/")} — a per-package CLAUDE.md loads only when Claude reads there`]);
}

// hooks: a linter exists but nothing runs it
const lintCfg = ["eslint.config.js", ".eslintrc", ".eslintrc.json", "biome.json", "ruff.toml", ".golangci.yml"].find((f) => existsSync(join(ROOT, f)));
const hookEvents = projSettings && projSettings !== "INVALID" ? Object.keys(projSettings.hooks || {}) : [];
if (lintCfg && !hookEvents.includes("PostToolUse"))
  rec.push(["hook: PostToolUse", `${lintCfg} exists but nothing lints after an edit — a PostToolUse hook feeds errors straight back`]);
if (ruleFiles.length && !hookEvents.includes("PreToolUse"))
  rec.push(["hook: PreToolUse", "rules are written but nothing enforces them — a PreToolUse guard blocks the violation instead of describing it"]);

// MCP: dependencies that postdate model training
if (pkg && pkg !== "INVALID") {
  const fast = ["react", "next", "tailwindcss", "react-router-dom", "vue", "svelte", "@angular/core"].filter(dep);
  const servers = mcp && mcp !== "INVALID" ? Object.keys(mcp.mcpServers || {}) : [];
  if (fast.length && !servers.includes("context7"))
    rec.push(["MCP: context7", `${fast.slice(0, 3).join(", ")} move faster than model training — context7 serves current API docs`]);
}

// skills: repeated procedures worth capturing
const skillDirs = ls(join(ROOT, ".claude/skills"));
if (!skillDirs.length && srcFiles > 100)
  rec.push(["skills", "no project skills — a multi-step procedure you repeat (scaffolding a feature, a release) belongs in one, loaded on invoke not every turn"]);

// agents: only when there is a real repeated specialised review
const projAgentFiles = ls(join(ROOT, ".claude/agents"));
if (!projAgentFiles.length && ruleFiles.length >= 4)
  rec.push(["agents (project)", `${ruleFiles.length} rule files — if one area needs auditing after every change, a project subagent enforces it`]);

// settings: worktree/read hygiene
if (srcFiles > 500 && !(projSettings && projSettings !== "INVALID" && projSettings.permissions?.deny?.length))
  rec.push(["settings: Read deny", "large tree with no Read deny rules — block generated and vendored paths"]);

if (!rec.length) say("  nothing obvious — the mechanisms in use look proportionate");
for (const [what, why] of rec) say(`  ${what.padEnd(24)} ${why}`);
if (rec.length) flag("INFO", `${rec.length} extension(s) this project could use — see the list above. Each one costs context, so add only what earns it.`);

// ---------------------------------------------------------- mode
const hasLayer = residentBytes > 0 || ruleFiles.length > 0;
// "Mapped" means the architecture map exists. Feature maps are built lazily —
// the first change to a feature maps it, and the pre-edit hook reminds — so
// coverage is reported honestly rather than used as a pass/fail gate.
const cov = coverage(ROOT, { stale: true });
const mapped = !!cov.dir && cov.architecture;
say();
say("CARTOGRAPHER");
say(`  memory${" ".repeat(27)}${cov.dir ? cov.dir.slice(ROOT.length + 1) : "none yet"}`);
say(`  architecture map${" ".repeat(17)}${cov.architecture ? "present" : "MISSING"}`);
if (cov.features.length) {
  const pct = Math.round((cov.mapped.length / cov.features.length) * 100);
  say(`  features mapped${" ".repeat(18)}${cov.mapped.length} of ${cov.features.length} (${pct}%) under ${cov.parents.join(", ")}`);
  if (cov.mapped.length) say(`    ${cov.mapped.map((f) => f.name).join(", ")}`);
  for (const f of cov.outdated) say(`  STALE ${f.name.padEnd(26)} mapped ${f.date}, code changed ${f.changed}  (${f.map})`);
  if (cov.mapped.length < cov.features.length)
    flag("INFO", `${cov.features.length - cov.mapped.length} of ${cov.features.length} features have no cartographer map. They are mapped on first change; map the ones in active work now with /agent-os:map.`);
  if (cov.outdated.length)
    flag("INFO", `${cov.outdated.length} map(s) older than their feature's last commit (${cov.outdated.map((f) => f.name).join(", ")}) — the cartographer re-checks them on next use.`);
} else say(`  features${" ".repeat(25)}no feature directories found — set "claude.features" in .agent-os/config.json`);
let MODE;
if (srcFiles < 5 && !hasLayer) MODE = "TOO-EARLY";
else if (!hasLayer) MODE = "ESTABLISH";
else if (anyLegacy || findings.some((f) => f.startsWith("WARN") || f.startsWith("FAIL"))) MODE = "MIGRATE";
else if (!mapped) MODE = "MAP";
else MODE = "MAINTAIN";
// ---------------------------------------------------------- setup state
// Install and settings, as opposed to MODE, which is about the context layer.
say();
for (const l of describeState(setupState(ROOT))) say(l);

say();
say(`MODE  ${MODE}`);
say({
  "TOO-EARLY": "  Barely any source yet. Do not build a context layer over nothing —\n  write code first, then run Claude Code's own /init, then come back.",
  ESTABLISH:   "  Real code, no context layer. Build one FROM THE CODE: read\n  references/establishing.md. Do not invent conventions.",
  MIGRATE:     "  A layer exists but has problems. Fix the findings below;\n  read references/migrating.md for anything legacy.",
  MAP:         "  Layer is healthy but the codebase has never been mapped. Build the\n  architecture map: read references/establishing.md, 'Map the architecture'.",
  MAINTAIN:    `  Layer is healthy and the architecture is mapped${cov.features.length ? ` (${cov.mapped.length} of ${cov.features.length} features)` : ""}.\n  Nothing to set up; remaining features are mapped as they are changed.`,
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
