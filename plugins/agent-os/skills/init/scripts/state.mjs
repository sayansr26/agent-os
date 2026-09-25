#!/usr/bin/env node
/**
 * agent-os setup state — is this a fresh setup, a repair, or already healthy?
 *
 * Both `npx agent-os init` and `/agent-os:init` start here, so neither
 * re-scaffolds a project that is set up, and both name exactly what a repair
 * has to touch. Read-only: every check is a file read, and the settings checks
 * are dry runs of what settings.mjs would write.
 *
 * The plugin check reads Claude Code's own records (installed_plugins.json,
 * enabledPlugins, the marketplace cache) instead of calling the `claude` CLI,
 * so it also works from inside a session.
 *
 * Usage: node state.mjs [projectDir]
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addTaskRule, GIT_DENY, mergeSettings, paths, userDir } from "./settings.mjs";

export const PLUGIN_ID = "agent-os@sayan-plugins";
export const MARKETPLACE_NAME = "sayan-plugins";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const real = (p) => { try { return realpathSync(p); } catch { return p; } };

/** -1, 0, 1 for dotted numeric versions; unknown sorts lowest. */
export function cmpVersion(a, b) {
  const pa = String(a || "0").split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The version of the plugin this script ships in. */
export const bundledVersion = () => readJson(join(HERE, "../../../.claude-plugin/plugin.json"))?.version || null;

/**
 * What Claude Code has installed for this project.
 * { installed, scope, version, enabled, latest } — latest is the version in the
 * local marketplace cache, which is only as new as the last marketplace update.
 */
export function pluginState(root) {
  const home = userDir();
  const rootReal = real(root);
  const records = readJson(join(home, "plugins/installed_plugins.json"))?.plugins?.[PLUGIN_ID] || [];
  // Project and local installs belong to one directory; user installs to all.
  const mine = records.filter((r) => r.scope === "user" || (r.projectPath && real(r.projectPath) === rootReal));
  const pick = mine.find((r) => r.scope === "project" || r.scope === "local") || mine[0] || null;

  const enabledIn = [
    join(root, ".claude/settings.local.json"),
    join(root, ".claude/settings.json"),
    join(home, "settings.json"),
  ].map((p) => readJson(p)?.enabledPlugins?.[PLUGIN_ID]).find((v) => v !== undefined);

  const latest = readJson(join(home, "plugins/marketplaces", MARKETPLACE_NAME, "plugins/agent-os/.claude-plugin/plugin.json"))?.version || null;
  return {
    installed: !!pick,
    scope: pick?.scope || null,
    version: pick?.version || null,
    enabled: pick ? enabledIn !== false : false,
    latest,
  };
}

/**
 * Every check, then the verdict:
 *   fresh    nothing of agent-os is here yet — run the whole setup
 *   repair   some of it is — fix only the items marked missing
 *   healthy  all of it is
 * `expect` is the plugin version the caller wants at minimum (the CLI passes
 * the version it bundles).
 */
export function setupState(root, { expect = bundledVersion() } = {}) {
  const items = [];
  const add = (key, label, ok, fix) => items.push({ key, label, ok, fix });

  const hasSource = existsSync(join(root, ".agent-os/config.json"));
  const claudeMd = (() => { try { return readFileSync(join(root, "CLAUDE.md"), "utf8"); } catch { return null; } })();
  const hasMemory = existsSync(join(root, ".claude/agent-memory"));

  add("source", ".agent-os/ source", hasSource, "npx @sayansr26/agent-os init");
  add("claude-md", "CLAUDE.md", claudeMd !== null, "/init in Claude Code, then /agent-os:init");

  for (const scope of ["project", "user"]) {
    const p = paths(scope, root);
    const s = mergeSettings(p.settings, { dry: true });
    const where = scope === "user" ? "~/.claude/settings.json" : ".claude/settings.json";
    if (s.status === "invalid") { add(`${scope}-settings`, `${where} is valid JSON`, false, `fix ${where} by hand`); continue; }
    const have = GIT_DENY.length - s.denyAdded.length;
    add(`${scope}-git`, `${where} git write protection (${have}/${GIT_DENY.length})`, !s.denyAdded.length, `agent-os settings --scope ${scope} --apply`);
    add(`${scope}-todo`, `${where} task tools`, s.env !== "added", `agent-os settings --scope ${scope} --apply`);
  }
  if (claudeMd !== null) {
    add("task-rule", "CLAUDE.md task-tracking rule", addTaskRule(join(root, "CLAUDE.md"), { dry: true }).status === "present", "agent-os settings --scope project --apply");
    add("agents-section", "CLAUDE.md says when to use each agent", /agent-os:(feature-cartographer|builder|reviewer)/.test(claudeMd), "/agent-os:init (establishing.md, Step 4b)");
  }

  const pl = pluginState(root);
  const want = [expect, pl.latest].filter(Boolean).sort((a, b) => cmpVersion(b, a))[0] || null;
  add("plugin", "Claude Code plugin installed", pl.installed, "npx @sayansr26/agent-os init");
  if (pl.installed) {
    add("plugin-enabled", "plugin enabled", pl.enabled, `claude plugin enable ${PLUGIN_ID}`);
    add("plugin-version", `plugin version ${pl.version}${want && cmpVersion(pl.version, want) < 0 ? ` (latest ${want})` : ""}`,
      !want || cmpVersion(pl.version, want) >= 0, "npx @sayansr26/agent-os init  (or /plugin update, then /reload-plugins)");
  }

  // Settings alone do not count: deny rules may be the user's own.
  const anything = hasSource || hasMemory || pl.installed || /agent-os/.test(claudeMd || "");
  const missing = items.filter((i) => !i.ok);
  const status = !anything ? "fresh" : missing.length ? "repair" : "healthy";
  return { status, items, missing, plugin: pl };
}

export function describeState(st) {
  const lines = [`SETUP  ${st.status.toUpperCase()}${st.status === "repair" ? `  — ${st.missing.length} item(s) to fix` : ""}`];
  for (const i of st.items) lines.push(`  ${i.ok ? "ok     " : "MISSING"} ${i.label}${i.ok ? "" : `  → ${i.fix}`}`);
  return lines;
}

const isMain = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};
if (process.argv[1] && isMain()) {
  const root = process.argv[2] || process.cwd();
  process.stdout.write(describeState(setupState(root)).join("\n") + "\n");
}
