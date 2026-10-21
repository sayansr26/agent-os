/**
 * Install or update the Claude Code half of agent-os during `init`.
 *
 * The CLI compiles rules for every tool. Claude Code additionally gets the
 * agents, skills, per-agent memory and hooks, which ship as a plugin, and
 * auto-route, a mod that picks the model and effort per turn. Both live in
 * this repo's marketplace. `init` brings each to the latest version whatever
 * state it finds:
 *
 *   not installed        marketplace add + install, at project scope
 *   installed, disabled  enable
 *   installed            refresh the marketplace, then update
 *
 * An installed plugin is never left behind: Claude Code pins the cached
 * version, so a project installed once stays on that version until something
 * updates it — which is how a project ended up running 0.4.1 hooks.
 *
 * Every command runs with the project as its working directory, so project
 * scope means *this* project even with --root. Best effort throughout: if the
 * `claude` CLI is missing or a command fails, `init` reports it and carries
 * on. The rules are the part that must not depend on this.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { cmpVersion } from "../plugins/agent-os/skills/init/scripts/state.mjs";

export const MARKETPLACE = "sayansr26/agent-os";
export const MARKETPLACE_NAME = "sayan-plugins";
export const PLUGIN = "agent-os";
// Installed by `init` in this order; each can be skipped with --no-<name>.
export const PLUGINS = [PLUGIN, "auto-route"];
const idOf = (plugin) => `${plugin}@${MARKETPLACE_NAME}`;

const run = (args, cwd) =>
  spawnSync("claude", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
const real = (p) => { try { return realpathSync(p); } catch { return p; } };
/** The version this package ships for a plugin, from its plugin.json. */
const bundled = (plugin) => {
  try { return JSON.parse(readFileSync(new URL(`../plugins/${plugin}/.claude-plugin/plugin.json`, import.meta.url), "utf8")).version || null; }
  catch { return null; }
};
const tail = (r) => (r.stderr || r.stdout || String(r.error || "")).trim().split("\n").slice(-3);

/** Is the Claude Code CLI usable from here? */
export function claudeAvailable() {
  const r = spawnSync("claude", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return !r.error && r.status === 0;
}

/** This project's install of a plugin, per `claude plugin list --json`, or null. */
export function installed(root, plugin = PLUGIN) {
  const list = json(run(["plugin", "list", "--json"], root));
  if (!Array.isArray(list)) return null;
  const mine = list.filter((p) => p.id === idOf(plugin) &&
    (p.scope === "user" || (p.projectPath && real(p.projectPath) === real(root))));
  return mine.find((p) => p.scope === "project" || p.scope === "local") || mine[0] || null;
}

/**
 * Bring a plugin to the latest version for this project.
 * Returns { ok, reason, from, to, done, hint } with reason one of
 * "installed" | "updated" | "current" | "dry-run" | "no-cli" | "failed".
 * `refresh: false` skips the marketplace step when an earlier call this run
 * already added or updated it.
 */
export function ensurePlugin({ root = process.cwd(), dry = false, scope = "project", plugin = PLUGIN, refresh = true } = {}) {
  const ID = idOf(plugin);
  if (!claudeAvailable())
    return {
      ok: false, reason: "no-cli", done: [],
      hint: [
        ...(refresh ? [
          "The `claude` CLI is not on PATH, so the plugin was not installed or updated.",
          "Inside Claude Code, run:",
          `  /plugin marketplace add ${MARKETPLACE}`,
        ] : []),
        `  /plugin install ${ID}     (or /plugin update ${ID} if it is already there)`,
      ],
    };

  const before = installed(root, plugin);
  const steps = [];
  if (refresh) {
    const markets = json(run(["plugin", "marketplace", "list", "--json"], root));
    const haveMarket = Array.isArray(markets) && markets.some((m) => m.name === MARKETPLACE_NAME);
    steps.push(haveMarket
      ? ["plugin", "marketplace", "update", MARKETPLACE_NAME]
      : ["plugin", "marketplace", "add", MARKETPLACE, "--scope", scope]);
  }
  if (!before) steps.push(["plugin", "install", ID, "--scope", scope, "--yes"]);
  else {
    if (before.enabled === false) steps.push(["plugin", "enable", ID, "--scope", before.scope]);
    steps.push(["plugin", "update", ID, "--scope", before.scope, "--yes"]);
  }

  if (dry)
    return { ok: true, reason: "dry-run", from: before?.version || null, done: steps.map((a) => `claude ${a.join(" ")}`), hint: [] };

  const done = [];
  for (const args of steps) {
    const r = run(args, root);
    if (r.status !== 0) {
      return {
        ok: false, reason: "failed", from: before?.version || null, done,
        hint: [
          `\`claude ${args.join(" ")}\` failed:`,
          ...tail(r).map((l) => `  ${l}`),
          "The rules and settings above were still written. Inside Claude Code:",
          before ? `  /plugin update ${ID}, then /reload-plugins` : `  /plugin install ${ID}`,
        ],
      };
    }
    done.push(`claude ${args.join(" ")}`);
  }

  const after = installed(root, plugin);
  const to = after?.version || null;
  const from = before?.version || null;
  const want = bundled(plugin);
  const hint = [];
  // The marketplace serves what is pushed to GitHub; this package may be newer.
  if (to && want && cmpVersion(to, want) < 0)
    hint.push(`Marketplace still serves ${plugin} ${to}; this agent-os ships ${want}. It updates once ${MARKETPLACE} is pushed.`);
  return {
    ok: true,
    reason: !before ? "installed" : from !== to ? "updated" : "current",
    from, to, done, hint,
  };
}
