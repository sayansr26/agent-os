/**
 * Install the Claude Code half of agent-os during `init`.
 *
 * The CLI compiles rules for every tool. Claude Code additionally gets the
 * agents, skills, per-agent memory and session hook, which ship as a plugin —
 * so `init` should install it rather than printing two slash commands and
 * hoping. `claude plugin ...` with `--yes` is the documented automation path.
 *
 * Everything here is best effort and reversible: if the `claude` CLI is not on
 * PATH, or a command fails, `init` reports it and carries on. The rules are the
 * part that must not depend on this.
 */
import { spawnSync } from "node:child_process";

export const MARKETPLACE = "sayansr26/agent-os";
export const MARKETPLACE_NAME = "sayan-plugins";
export const PLUGIN = "agent-os";

const run = (args) =>
  spawnSync("claude", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Is the Claude Code CLI usable from here? */
export function claudeAvailable() {
  const r = spawnSync("claude", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return !r.error && r.status === 0;
}

/**
 * Add the marketplace and install the plugin at project scope, so the setup
 * travels with the repository instead of living on one machine.
 */
export function installPlugin({ dry = false, scope = "project" } = {}) {
  const steps = [
    ["marketplace", ["plugin", "marketplace", "add", MARKETPLACE, "--scope", scope]],
    ["plugin", ["plugin", "install", `${PLUGIN}@${MARKETPLACE_NAME}`, "--scope", scope, "--yes"]],
  ];

  if (!claudeAvailable())
    return {
      ok: false,
      reason: "no-cli",
      done: [],
      hint: [
        "The `claude` CLI is not on PATH, so the plugin was not installed.",
        "Inside Claude Code, run:",
        `  /plugin marketplace add ${MARKETPLACE}`,
        `  /plugin install ${PLUGIN}@${MARKETPLACE_NAME}`,
      ],
    };

  if (dry)
    return { ok: true, reason: "dry-run", done: steps.map(([, a]) => `claude ${a.join(" ")}`), hint: [] };

  const done = [];
  for (const [what, args] of steps) {
    const r = run(args);
    if (r.status !== 0) {
      const err = (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join("\n");
      return {
        ok: false,
        reason: what,
        done,
        hint: [
          `\`claude ${args.join(" ")}\` failed:`,
          ...err.split("\n").map((l) => `  ${l}`),
          "The rules above were still written. Install the plugin by hand inside",
          `Claude Code: /plugin install ${PLUGIN}@${MARKETPLACE_NAME}`,
        ],
      };
    }
    done.push(`claude ${args.join(" ")}`);
  }
  return { ok: true, reason: "installed", done, hint: [] };
}
