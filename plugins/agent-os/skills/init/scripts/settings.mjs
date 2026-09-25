#!/usr/bin/env node
/**
 * agent-os settings — write the permission and task-tool setup, not describe it.
 *
 * Three things, at project scope, user scope, or both:
 *
 *   settings.json  permissions.deny  += the git write-protection rules
 *                  env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "1"
 *   CLAUDE.md      the task-tracking rule
 *
 * Merges, never replaces: existing keys, allow rules, deny rules and a value
 * the user set for the env flag all survive. Idempotent. Before changing a
 * file under ~/.claude it copies it to `<file>.agent-os.bak`; project files
 * are left to git, so a backup does not show up as an untracked file.
 *
 * Previews by default. `--apply` writes. The preview is what /agent-os:init
 * shows the user before asking once; the CLI's `init` asks the same question.
 *
 * Usage: node settings.mjs [--root <dir>] [--scope project|user|both] [--apply]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TODO_ENV = "CLAUDE_CODE_ENABLE_TODO_TOOLS";

export const TASK_RULE = `- **Always track work with the task tool (TaskCreate / TaskUpdate).** Any request
  with more than one step gets a task list before work starts: one task per
  deliverable, marked \`in_progress\` when started and \`completed\` only when
  verified. Keep it current as scope changes, including work delegated to
  subagents, so I can see what is done, running and left at any moment.`;

/**
 * Every git command that changes the repository. Read-only inspection
 * (status, log, diff, show, blame, …) stays available. The first five close
 * the flag forms that would otherwise walk past a per-subcommand rule —
 * references/git-permissions.md explains each judgment call.
 */
export const GIT_DENY = [
  "Bash(git -C*)", "Bash(git -c*)", "Bash(git --git-dir*)", "Bash(git --work-tree*)", "Bash(git --exec-path*)",
  "Bash(git add *)", "Bash(git am *)", "Bash(git apply *)", "Bash(git bisect *)", "Bash(git branch *)",
  "Bash(git checkout *)", "Bash(git cherry-pick *)", "Bash(git clean *)", "Bash(git clone *)", "Bash(git commit *)",
  "Bash(git config *)", "Bash(git fast-import *)", "Bash(git filter-branch *)", "Bash(git gc *)", "Bash(git init *)",
  "Bash(git merge *)", "Bash(git mv *)", "Bash(git notes *)", "Bash(git prune *)", "Bash(git pull *)",
  "Bash(git push *)", "Bash(git rebase *)", "Bash(git reflog *)", "Bash(git remote *)", "Bash(git repack *)",
  "Bash(git replace *)", "Bash(git reset *)", "Bash(git restore *)", "Bash(git revert *)", "Bash(git rm *)",
  "Bash(git stash *)", "Bash(git submodule *)", "Bash(git switch *)", "Bash(git symbolic-ref *)", "Bash(git tag *)",
  "Bash(git update-ref *)", "Bash(git worktree *)",
];

export const userDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

export function paths(scope, root) {
  return scope === "user"
    ? { settings: join(userDir(), "settings.json"), claudeMd: join(userDir(), "CLAUDE.md"), label: "USER (~/.claude)" }
    : { settings: join(root, ".claude/settings.json"), claudeMd: join(root, "CLAUDE.md"), label: "PROJECT" };
}

const put = (p, text, keep) => {
  if (keep && existsSync(p)) copyFileSync(p, `${p}.agent-os.bak`);
  mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

// "Bash(git commit *)" and "Bash(git commit:*)" are the same rule to Claude Code.
const norm = (r) => r.replace(/:\*\)$/, " *)").replace(/\s+/g, " ");

/**
 * Merge the deny rules and the env flag into one settings.json.
 * Returns { status: "changed"|"unchanged"|"invalid", file, denyAdded, env, current }
 * where env is "added" | "present" | "conflict".
 */
export function mergeSettings(file, { dry = false, deny = GIT_DENY, todo = true, keep = false } = {}) {
  let settings = {};
  if (existsSync(file)) {
    try { settings = JSON.parse(readFileSync(file, "utf8")); }
    catch { return { status: "invalid", file, denyAdded: [], env: null }; }
  }
  const perms = settings.permissions || {};
  const have = new Set((perms.deny || []).map(norm));
  const denyAdded = deny.filter((r) => !have.has(norm(r)));

  let env = null, current;
  if (todo) {
    current = (settings.env || {})[TODO_ENV];
    // "true" and "1" are both truthy to Claude Code; an existing value is the
    // user's choice and is left alone rather than normalised.
    if (current === undefined) env = "added";
    else env = current === "1" || current === "true" || current === true ? "present" : "conflict";
  }

  if (!denyAdded.length && env !== "added") return { status: "unchanged", file, denyAdded, env, current };

  if (denyAdded.length) settings.permissions = { ...perms, deny: [...(perms.deny || []), ...denyAdded] };
  if (env === "added") settings.env = { ...(settings.env || {}), [TODO_ENV]: "1" };
  if (!dry) put(file, JSON.stringify(settings, null, 2) + "\n", keep);
  return { status: "changed", file, denyAdded, env, current };
}

/**
 * Put the task-tracking rule in a CLAUDE.md. Returns "added" | "present" | "no-file".
 * A project CLAUDE.md is never created — that is the project's own
 * always-loaded context, and a CLI inventing one leaves a stub nobody owns.
 * The user's ~/.claude/CLAUDE.md is created when `create` is set.
 */
export function addTaskRule(file, { dry = false, create = false, keep = false } = {}) {
  if (!existsSync(file)) {
    if (!create) return { status: "no-file", file };
    if (!dry) put(file, `# Personal working agreement\n\n${TASK_RULE}\n`);
    return { status: "added", file, section: "new file" };
  }
  const text = readFileSync(file, "utf8");
  if (/TaskCreate/.test(text)) return { status: "present", file };

  // Prefer an operator-preferences section so the rule lands with the other
  // instructions about how to work rather than orphaned at the bottom.
  const heading = text.match(/^##\s+Operator preferences\s*$/m);
  let next;
  if (heading) {
    const start = heading.index + heading[0].length;
    const rest = text.slice(start);
    const nextHeading = rest.search(/^##\s+/m);
    const end = nextHeading === -1 ? text.length : start + nextHeading;
    next = `${text.slice(0, end).replace(/\s*$/, "")}\n\n${TASK_RULE}\n\n${text.slice(end)}`;
  } else {
    next = `${text.replace(/\s*$/, "")}\n\n## Working agreement\n\n${TASK_RULE}\n`;
  }
  if (!dry) put(file, next.replace(/\n{4,}/g, "\n\n\n"), keep);
  return { status: "added", file, section: heading ? "Operator preferences" : "Working agreement" };
}

/** Everything for one scope. */
export function applyScope(scope, root, { dry = false } = {}) {
  const p = paths(scope, root);
  return {
    scope,
    label: p.label,
    settings: mergeSettings(p.settings, { dry, keep: scope === "user" }),
    rule: addTaskRule(p.claudeMd, { dry, create: scope === "user", keep: scope === "user" }),
  };
}

export function describe(r, { dry }) {
  const s = r.settings, lines = [];
  const verb = dry ? "would add" : "added";
  lines.push(`${r.label}  ${s.file}`);
  if (s.status === "invalid") lines.push("  not valid JSON — left alone; fix it and re-run");
  else {
    lines.push(s.denyAdded.length
      ? `  permissions.deny   ${verb} ${s.denyAdded.length} git write rule(s)${s.denyAdded.length < GIT_DENY.length ? ` (${GIT_DENY.length - s.denyAdded.length} already there)` : ""}`
      : `  permissions.deny   git write protection already complete`);
    lines.push({
      added: `  env.${TODO_ENV}  ${verb} "1"`,
      present: `  env.${TODO_ENV}  already on`,
      conflict: `  env.${TODO_ENV}  is "${s.current}" — left as set`,
    }[s.env]);
    if (s.status === "changed" && !dry && r.scope === "user" && existsSync(`${s.file}.agent-os.bak`)) lines.push(`  backup             ${s.file}.agent-os.bak`);
  }
  lines.push({
    added: `  ${r.rule.file}  ${dry ? "would add" : "added"} the task-tracking rule (${r.rule.section})`,
    present: `  ${r.rule.file}  task-tracking rule already there`,
    "no-file": `  ${r.rule.file}  absent — /agent-os:init builds it`,
  }[r.rule.status]);
  return lines;
}

function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i === -1 ? d : argv[i + 1]; };
  const root = arg("--root", process.cwd());
  const scope = arg("--scope", "both");
  const dry = !argv.includes("--apply");
  const scopes = scope === "both" ? ["project", "user"] : [scope];
  if (!scopes.every((s) => s === "project" || s === "user")) {
    console.error(`--scope must be project, user or both (got "${scope}")`);
    process.exit(2);
  }
  const out = [`AGENT-OS SETTINGS  ${dry ? "preview — nothing written; re-run with --apply" : "applied"}`, ""];
  for (const s of scopes) out.push(...describe(applyScope(s, root, { dry }), { dry }), "");
  if (scopes.includes("user")) out.push("~/.claude applies to every project on this machine.");
  process.stdout.write(out.join("\n") + "\n");
}

const isMain = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};
if (process.argv[1] && isMain()) main(process.argv.slice(2));
