#!/usr/bin/env node
/**
 * Structural validation for the agent-os plugin.
 *
 * Runs with no auth and no network, so it can gate every push.
 * Complements `claude plugin validate`, which needs the CLI installed.
 *
 * Every check here exists because something actually broke:
 *  - agent frontmatter lost its closing `---` in a scripted edit and every
 *    field was silently dropped at load time
 *  - a JSON-escaped description wrote — into YAML
 *  - plugin.json and marketplace.json drifted out of version sync
 *  - a hook pointed at a script that had been deleted
 *  - a version was bumped without a changelog entry, twice
 *
 * Usage: node scripts/validate-plugin.mjs [pluginDir]
 * Exit 0 = clean, 1 = failures.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const PLUGIN = process.argv[2] || "plugins/agent-os";
const MARKET = ".claude-plugin/marketplace.json";
let failures = 0, checks = 0;

const ok = (m) => { checks++; console.log(`  ok    ${m}`); };
const bad = (m) => { checks++; failures++; console.log(`  FAIL  ${m}`); };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const json = (p) => { const t = read(p); if (t === null) return { err: "missing" }; try { return { val: JSON.parse(t) }; } catch (e) { return { err: e.message }; } };

// Anchored: opening delimiter at byte 0, key: value lines, closing delimiter.
// A split-on("---") check cannot detect a missing closing delimiter — this can.
const FRONTMATTER = /\A?^---\n((?:[a-zA-Z_][\w-]*:.*\n(?:[ \t]+.*\n)*)+)---\n/;

function frontmatter(text) {
  if (!text.startsWith("---\n")) return { err: "no opening --- at start of file" };
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) return { err: "no closing --- delimiter" };
  const block = text.slice(4, end + 1);
  const fields = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
    else if (line.trim() && !/^[ \t]/.test(line)) return { err: `unparseable frontmatter line: ${line.slice(0, 40)}` };
  }
  return { fields, block };
}

console.log(`\nvalidating ${PLUGIN}\n`);

// ---- manifests ----
console.log("manifests");
const pj = json(join(PLUGIN, ".claude-plugin/plugin.json"));
const mk = json(MARKET);
pj.err ? bad(`plugin.json: ${pj.err}`) : ok("plugin.json parses");
mk.err ? bad(`marketplace.json: ${mk.err}`) : ok("marketplace.json parses");

// ---- release hygiene ----
// Shipping a version the changelog does not mention has happened twice now. It
// is a deterministic check, so it belongs in a script rather than in a habit.
console.log("\nrelease hygiene");
{
  const pkg = json("package.json");
  const changelog = read("CHANGELOG.md");
  if (pkg.err) bad(`package.json: ${pkg.err}`);
  else if (changelog === null) bad("CHANGELOG.md is missing");
  else {
    const v = pkg.val.version;
    const heads = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);
    heads.includes(v)
      ? ok(`CHANGELOG documents package version ${v}`)
      : bad(`package.json is ${v} but CHANGELOG.md has no "## [${v}]" section (newest: ${heads[0] || "none"})`);
    heads[0] === v
      ? ok(`${v} is the newest changelog entry`)
      : bad(`newest changelog entry is ${heads[0]}, not the package version ${v}`);
  }
}

console.log("");
if (pj.val && mk.val) {
  const entry = (mk.val.plugins || []).find((p) => p.name === pj.val.name);
  entry ? ok(`marketplace lists "${pj.val.name}"`) : bad(`marketplace.json has no entry named "${pj.val.name}"`);
  const mv = mk.val.metadata?.version;
  mv === pj.val.version
    ? ok(`versions in sync (${pj.val.version})`)
    : bad(`version drift: plugin.json ${pj.val.version} vs marketplace metadata ${mv}`);
  for (const f of ["name", "description", "version"]) pj.val[f] ? ok(`plugin.json has ${f}`) : bad(`plugin.json missing ${f}`);
  /^[a-z0-9-]+$/.test(pj.val.name) ? ok("plugin name is kebab-case") : bad(`plugin name "${pj.val.name}" is not kebab-case`);
  // icon.png is the directory listing icon; the portal reads it from here.
  const dirs = readdirSync(join(PLUGIN, ".claude-plugin"));
  const extra = dirs.filter((f) => f !== "plugin.json" && f !== "icon.png");
  dirs.includes("plugin.json") && !extra.length
    ? ok(".claude-plugin holds only plugin.json (and icon.png)")
    : bad(`.claude-plugin should hold only plugin.json and icon.png, found: ${dirs.join(", ")}`);
}

// ---- agents ----
console.log("\nagents");
const agentDir = join(PLUGIN, "agents");
const agents = existsSync(agentDir) ? readdirSync(agentDir).filter((f) => f.endsWith(".md")) : [];
agents.length ? ok(`${agents.length} agent file(s)`) : bad("no agents found");
for (const f of agents) {
  const stem = basename(f, ".md");
  const t = read(join(agentDir, f));
  const fm = frontmatter(t);
  if (fm.err) { bad(`${f}: ${fm.err}`); continue; }
  fm.fields.name === stem ? ok(`${f}: name matches filename`) : bad(`${f}: name "${fm.fields.name}" != filename "${stem}"`);
  fm.fields.description ? ok(`${f}: has description`) : bad(`${f}: no description — it will not be selectable`);
  fm.fields.memory === "project"
    ? ok(`${f}: memory: project`)
    : bad(`${f}: memory is "${fm.fields.memory}" — user scope leaks one repo's knowledge into every other`);
  /\\u[0-9a-fA-F]{4}/.test(fm.block)
    ? bad(`${f}: unicode escape sequence in frontmatter — write the real character`)
    : ok(`${f}: no escaped unicode`);
}

// ---- skills ----
console.log("\nskills");
const skillDir = join(PLUGIN, "skills");
const skills = existsSync(skillDir) ? readdirSync(skillDir).filter((d) => existsSync(join(skillDir, d, "SKILL.md"))) : [];
skills.length ? ok(`${skills.length} skill(s): ${skills.join(", ")}`) : bad("no skills found");
for (const s of skills) {
  const fm = frontmatter(read(join(skillDir, s, "SKILL.md")));
  if (fm.err) { bad(`skills/${s}/SKILL.md: ${fm.err}`); continue; }
  fm.fields.description ? ok(`skills/${s}: has description`) : bad(`skills/${s}: no description`);
  if (fm.fields.name && fm.fields.name !== s) bad(`skills/${s}: frontmatter name "${fm.fields.name}" != directory name`);
  else ok(`skills/${s}: name consistent`);
}

// ---- hooks ----
console.log("\nhooks");
const hp = join(PLUGIN, "hooks/hooks.json");
if (!existsSync(hp)) ok("no hooks.json (optional)");
else {
  const h = json(hp);
  if (h.err) bad(`hooks.json: ${h.err}`);
  else {
    ok("hooks.json parses");
    for (const [evt, entries] of Object.entries(h.val.hooks || {}))
      for (const e of entries) for (const hk of e.hooks || []) {
        const m = (hk.command || "").match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+)/);
        if (!m) { bad(`${evt}: command does not use \${CLAUDE_PLUGIN_ROOT} — path will not resolve when installed`); continue; }
        existsSync(join(PLUGIN, m[1])) ? ok(`${evt} -> ${m[1]}`) : bad(`${evt} -> ${m[1]} does not exist`);
      }
  }
}

// ---- mod plugins ----
// Other marketplace entries whose hooks.json names TypeScript modules (mods)
// rather than shell commands. They ship no agents or skills, so they get their
// own lighter checks; `claude plugin validate <dir>` goes deeper when installed.
if (mk.val) {
  const mods = (mk.val.plugins || []).filter((p) => typeof p.source === "string" && p.source.replace(/^\.\//, "") !== PLUGIN.replace(/^\.\//, ""));
  for (const p of mods) {
    console.log(`\nmod: ${p.name}`);
    const dir = p.source;
    const mj = json(join(dir, ".claude-plugin/plugin.json"));
    if (mj.err) { bad(`${dir}/.claude-plugin/plugin.json: ${mj.err}`); continue; }
    for (const f of ["name", "description", "version"]) mj.val[f] ? ok(`plugin.json has ${f}`) : bad(`plugin.json missing ${f}`);
    mj.val.name === p.name ? ok("name matches marketplace entry") : bad(`plugin.json name "${mj.val.name}" != marketplace entry "${p.name}"`);
    if (mj.val.types) existsSync(join(dir, mj.val.types)) ? ok(`types -> ${mj.val.types}`) : bad(`types -> ${mj.val.types} does not exist`);
    // The engine writes .claude-plugin/types/ (with its own .gitignore) when it
    // loads the mod; icon.png is the listing icon; anything else is a mistake.
    const extra = readdirSync(join(dir, ".claude-plugin")).filter((f) => !["plugin.json", "icon.png", "types"].includes(f));
    extra.length ? bad(`.claude-plugin holds unexpected: ${extra.join(", ")}`) : ok(".claude-plugin holds only plugin.json (+ icon.png, engine types)");
    const h = json(join(dir, "hooks/hooks.json"));
    if (h.err) { bad(`hooks/hooks.json: ${h.err}`); continue; }
    const modules = h.val.modules || [];
    modules.length ? ok(`${modules.length} hook module(s)`) : bad("hooks.json names no modules");
    for (const m of modules) existsSync(join(dir, "hooks", m)) ? ok(`module -> ${m}`) : bad(`module -> ${m} does not exist`);
  }
}

// ---- leak check ----
// Examples in a public plugin must be invented, never lifted from a real
// codebase you happen to have open. This cannot be checked generically, so
// maintainers keep a local, gitignored `.leakcheck` — one term per line — of
// identifiers that must never be published. The file is not committed, so the
// terms themselves never enter the repository.
const leakFile = read(".leakcheck");
if (leakFile) {
  console.log("\nleak check");
  const terms = leakFile.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const scan = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      if ([".git", "node_modules"].includes(e)) continue;
      const fp = join(d, e);
      if (statSync(fp).isDirectory()) walk(fp);
      else if (/\.(md|mjs|js|json|ya?ml)$/.test(e)) scan.push(fp);
    }
  })(".");
  let hits = 0;
  for (const f of scan) {
    if (f.endsWith("validate-plugin.mjs")) continue;
    const body = read(f) || "";
    for (const term of terms)
      if (body.toLowerCase().includes(term.toLowerCase())) { bad(`${f} contains "${term}" — examples must be invented, not lifted from a real codebase`); hits++; }
  }
  if (!hits) ok(`no leaked identifiers (${terms.length} term(s) checked)`);
} 

console.log(`\n${failures ? "FAILED" : "PASSED"}  ${checks - failures}/${checks} checks\n`);
process.exit(failures ? 1 : 0);
