/**
 * What counts as a feature, and which features the cartographer has mapped.
 *
 * Shared by the session hook, the pre-edit hook and the audit, so the three
 * never disagree about coverage. Everything here is read-only, synchronous and
 * swallows its own errors — hooks must never fail a session.
 *
 * Feature directories come from `.agent-os/config.json`:
 *
 *   { "claude": { "features": ["src/features/*", "apps/*"] } }
 *
 * Each entry is `<dir>/*`: every direct subdirectory of `<dir>` is a feature.
 * With no config, the first of DEFAULT_PARENTS that exists is used.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_PARENTS = ["src/features", "src/modules", "app/features", "features", "modules"];

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const ls = (p) => { try { return readdirSync(p); } catch { return []; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `.agent-os/config.json`'s `claude` block, or {}. */
export function claudeConfig(root) {
  try { return JSON.parse(read(join(root, ".agent-os/config.json")) || "{}").claude || {}; }
  catch { return {}; }
}

/** The parent directories whose children are features, relative to root. */
export function featureParents(root) {
  const cfg = claudeConfig(root).features;
  if (Array.isArray(cfg) && cfg.length)
    return cfg.map((g) => String(g).replace(/\/\*+$/, "").replace(/\/$/, "")).filter(Boolean);
  const found = DEFAULT_PARENTS.find((d) => isDir(join(root, d)));
  return found ? [found] : [];
}

/** Every feature: { name, dir } with dir relative to root. */
export function listFeatures(root) {
  const out = [];
  for (const parent of featureParents(root))
    for (const name of ls(join(root, parent)))
      if (!name.startsWith(".") && isDir(join(root, parent, name))) out.push({ name, dir: `${parent}/${name}` });
  return out;
}

/** The feature a (relative or absolute) path belongs to, or null. */
export function featureOf(root, filePath) {
  let rel = String(filePath || "").replace(/\\/g, "/");
  const r = root.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  if (rel.startsWith(r)) rel = rel.slice(r.length);
  for (const parent of featureParents(root)) {
    const m = rel.match(new RegExp(`^${esc(parent)}/([^/]+)/`));
    if (m) return { name: m[1], dir: `${parent}/${m[1]}` };
  }
  return null;
}

/**
 * The cartographer's memory directory. Plugin agents are namespaced, so the
 * directory is `agent-os-feature-cartographer`; the bare name is what a copy
 * installed as a standalone agent writes to.
 */
export function cartographerDir(root) {
  for (const base of [".claude/agent-memory", ".claude/agent-memory-local"])
    for (const name of ["agent-os-feature-cartographer", "feature-cartographer"]) {
      const d = join(root, base, name);
      if (isDir(d)) return d;
    }
  return null;
}

/** Topic files in the cartographer's memory: [{ file, text, mapped }]. */
export function mapFiles(root) {
  const dir = cartographerDir(root);
  if (!dir) return [];
  return ls(dir)
    .filter((f) => f.endsWith(".md") && f !== "MEMORY.md")
    .map((f) => {
      const text = read(join(dir, f)) || "";
      const m = text.match(/^mapped:\s*["']?(\d{4}-\d{2}-\d{2})/m);
      return { file: f, text, mapped: m ? m[1] : null };
    });
}

/**
 * Does some topic file map this feature? A map names its subject in a header
 * line (description:, entry:, a heading), is named after it, or mentions its
 * directory at least twice. `_architecture.md` is the system map and never
 * counts as a feature map. `dashboard` must not match `dashboardV2`.
 */
export function findMap(feature, maps) {
  const named = new RegExp(`${esc(feature.dir)}(?![\\w-])`);
  const slug = feature.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  for (const m of maps) {
    if (m.file.startsWith("_")) continue;
    if (m.file.replace(/\.md$/, "").toLowerCase() === slug) return m;
    const header = m.text.split("\n").some((l) => /^(description:|entry:|#)/.test(l) && named.test(l));
    if (header || m.text.split(`${feature.dir}/`).length - 1 >= 2) return m;
  }
  return null;
}

/** Is anything under this directory tracked by git? Unknown counts as yes. */
export function tracked(root, dir) {
  try {
    const out = execFileSync("git", ["ls-files", "--", dir], {
      cwd: root, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch { return true; }
}

/** Date (YYYY-MM-DD) of the last commit touching dir, or null. */
export function lastChanged(root, dir) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", dir], {
      cwd: root, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch { return null; }
}

/**
 * Coverage summary. `stale` compares each map's `mapped:` date with the last
 * commit to its feature, which costs one git call per mapped feature — the
 * audit asks for it, the hooks do not.
 */
export function coverage(root, { stale = false } = {}) {
  const features = listFeatures(root);
  const maps = mapFiles(root);
  const mapped = [], unmapped = [], outdated = [];
  for (const f of features) {
    const m = findMap(f, maps);
    if (!m) { unmapped.push(f); continue; }
    mapped.push({ ...f, map: m.file, date: m.mapped });
    if (stale && m.mapped) {
      const changed = lastChanged(root, f.dir);
      if (changed && changed > m.mapped) outdated.push({ ...f, map: m.file, date: m.mapped, changed });
    }
  }
  return {
    parents: featureParents(root),
    features,
    mapped,
    unmapped,
    outdated,
    architecture: maps.some((m) => m.file === "_architecture.md"),
    dir: cartographerDir(root),
  };
}
