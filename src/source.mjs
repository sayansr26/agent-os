/**
 * The canonical source. One place you edit; everything else is generated.
 *
 *   .agent-os/
 *     config.json      { targets: [...] }
 *     AGENTS.md        instructions that apply everywhere
 *     rules/<name>.md  --- paths: [globs] | always: true | description: ... ---
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";

export const DIR = ".agent-os";
export const BANNER = "agent-os: generated from .agent-os/ — edit the source, then run `npx @sayansr26/agent-os sync`";

export function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { fields: {}, body: text };
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) return { fields: {}, body: text };
  const block = text.slice(4, end + 1);
  const body = text.slice(end + 5).replace(/^\n+/, "");
  const fields = {};
  let key = null;
  for (const line of block.split("\n")) {
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    const item = line.match(/^\s*-\s+(.*)$/);
    if (kv) { key = kv[1]; const v = kv[2].trim(); fields[key] = v === "" ? [] : v; }
    else if (item && key) {
      if (!Array.isArray(fields[key])) fields[key] = [];
      fields[key].push(item[1].trim().replace(/^["']|["']$/g, ""));
    }
  }
  return { fields, body };
}

export function load(root) {
  const dir = join(root, DIR);
  if (!existsSync(dir)) return null;
  const cfgPath = join(dir, "config.json");
  const config = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : { targets: [] };
  const agents = existsSync(join(dir, "AGENTS.md")) ? readFileSync(join(dir, "AGENTS.md"), "utf8") : "";
  const rulesDir = join(dir, "rules");
  const rules = (existsSync(rulesDir) ? readdirSync(rulesDir) : [])
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { fields, body } = parseFrontmatter(readFileSync(join(rulesDir, f), "utf8"));
      const paths = Array.isArray(fields.paths) ? fields.paths : fields.paths ? [fields.paths] : [];
      return {
        name: basename(f, ".md"),
        description: typeof fields.description === "string" ? fields.description : "",
        paths,
        always: String(fields.always) === "true" || paths.length === 0,
        body: body.trim(),
      };
    });
  // Skills: a directory per skill, SKILL.md plus any supporting files.
  const skillsDir = join(dir, "skills");
  const skills = (existsSync(skillsDir) ? readdirSync(skillsDir) : [])
    .filter((d) => existsSync(join(skillsDir, d, "SKILL.md")))
    .map((d) => ({ name: d, files: walkRel(join(skillsDir, d)) }));

  return { root, config, agents: agents.trim(), rules, skills };
}

export function write(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return rel;
}

export function readIfExists(root, rel) {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/**
 * Compare a generated file against what is on disk.
 *
 * Skill files are read as Buffers by `walkRel` so that a skill can ship a PNG
 * or a zip without being mangled, while rule files are generated as strings.
 * Comparing the two kinds with `!==` reports every skill file as drifted even
 * immediately after a sync, so the comparison is done per kind here.
 *
 * Returns `null` when the file does not exist, otherwise a boolean.
 */
export function matches(root, rel, content) {
  const p = join(root, rel);
  if (!existsSync(p)) return null;
  const cur = readFileSync(p);
  return Buffer.isBuffer(content) ? cur.equals(content) : cur.toString("utf8") === content;
}

/** Every file under `dir`, as paths relative to it. */
export function walkRel(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir)) {
    const abs = join(dir, e);
    if (statSync(abs).isDirectory()) out.push(...walkRel(abs, prefix ? `${prefix}/${e}` : e));
    else out.push({ rel: prefix ? `${prefix}/${e}` : e, content: readFileSync(abs) });
  }
  return out;
}
