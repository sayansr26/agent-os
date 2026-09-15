/**
 * Adopt what a project already has, instead of scaffolding over it.
 *
 * `init` used to write a placeholder `AGENTS.md` and an `example.md` rule into
 * every project, including projects that already had a real AGENTS.md and a
 * directory of real rules. The next `sync` then compiled the placeholder over
 * the real file. A tool whose whole purpose is to stop rule files drifting must
 * not destroy the rules it finds, so `init` now imports them as the source.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { BANNER } from "./source.mjs";

const isGenerated = (text) => text.includes(BANNER);

const readDirMd = (dir, ext) => {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => ({ name: basename(f, ext), text: readFileSync(join(dir, f), "utf8") }))
    .filter((r) => !isGenerated(r.text));
};

/** `.cursor/rules/*.mdc` back into the canonical `paths:` / `always:` shape. */
function fromCursor({ name, text }) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { name, text };
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  const globs = (fields.globs || "").split(",").map((g) => g.trim()).filter(Boolean);
  const always = String(fields.alwaysApply) === "true";
  const fm = ["---"];
  if (fields.description) fm.push(`description: ${fields.description}`);
  if (always || globs.length === 0) fm.push("always: true");
  else { fm.push("paths:"); for (const g of globs) fm.push(`  - "${g}"`); }
  fm.push("---", "");
  return { name, text: `${fm.join("\n")}\n${m[2].trim()}\n` };
}

/**
 * What this project already has that should become the source.
 * Returns `{ agents, rules, from, paths }`; `from` is what to tell the user,
 * `paths` the files it consumed — safe for `init` to regenerate in place.
 */
export function adopt(root) {
  const from = [];
  const paths = new Set();
  let agents = null;

  const agentsPath = join(root, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const text = readFileSync(agentsPath, "utf8");
    if (!isGenerated(text)) { agents = text; from.push("AGENTS.md"); paths.add("AGENTS.md"); }
  }

  // In precedence order — the first store that has anything wins, because these
  // are copies of each other in a project that was keeping them in sync by hand.
  const sources = [
    [".claude/rules", ".md", (r) => r],
    [".clinerules", ".md", (r) => r],
    [".agents/rules", ".md", (r) => r],
    [".cursor/rules", ".mdc", fromCursor],
    [".windsurf/rules", ".md", (r) => r],
  ];

  let rules = [];
  for (const [dir, ext, convert] of sources) {
    const found = readDirMd(join(root, dir), ext);
    if (!found.length) continue;
    rules = found.map(convert);
    from.push(`${dir}/ (${rules.length} rule${rules.length === 1 ? "" : "s"})`);
    for (const r of found) paths.add(`${dir}/${r.name}${ext}`);
    break;
  }

  return { agents, rules, from, paths };
}
