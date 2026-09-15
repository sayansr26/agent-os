/**
 * The two Claude Code settings that are not rules and not a plugin.
 *
 * Both are written at PROJECT scope only — `.claude/settings.json` and the
 * project's `CLAUDE.md`. Nothing here touches `~/.claude/`: a project setup
 * tool that edits the machine's global config is overreach, and the point is
 * that the setup travels with the repository.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { write } from "./source.mjs";

export const TODO_ENV = "CLAUDE_CODE_ENABLE_TODO_TOOLS";

export const TASK_RULE = `- **Always track work with the task tool (TaskCreate / TaskUpdate).** Any request
  with more than one step gets a task list before work starts: one task per
  deliverable, marked \`in_progress\` when started and \`completed\` only when
  verified. Keep it current as scope changes, including work delegated to
  subagents, so I can see what is done, running and left at any moment.`;

/**
 * Turn on the todo tools in project settings, preserving every other key.
 * Returns "added" | "present" | "conflict" | "invalid".
 */
export function ensureTodoEnv(root, { dry = false } = {}) {
  const rel = ".claude/settings.json";
  const p = join(root, rel);
  let settings = {};
  if (existsSync(p)) {
    try { settings = JSON.parse(readFileSync(p, "utf8")); }
    catch { return { status: "invalid", rel }; }
  }
  const env = settings.env || {};
  const current = env[TODO_ENV];

  // "true" and "1" are both truthy to Claude Code; an existing truthy value is
  // the user's choice and is left alone rather than normalised.
  if (current !== undefined) {
    const on = current === "1" || current === "true" || current === true;
    return { status: on ? "present" : "conflict", rel, current };
  }

  settings.env = { ...env, [TODO_ENV]: "1" };
  if (!dry) write(root, rel, JSON.stringify(settings, null, 2) + "\n");
  return { status: "added", rel };
}

/**
 * Put the task-tracking rule in CLAUDE.md if it is not already there.
 * Never creates CLAUDE.md — that file is the project's own always-loaded
 * context, and inventing one from a CLI is how a project ends up with a stub
 * nobody owns. Returns "added" | "present" | "no-file".
 */
export function ensureTaskRule(root, { dry = false } = {}) {
  const rel = "CLAUDE.md";
  const p = join(root, rel);
  if (!existsSync(p)) return { status: "no-file", rel };

  const text = readFileSync(p, "utf8");
  if (/TaskCreate/.test(text)) return { status: "present", rel };

  // Prefer the operator-preferences section if the project keeps one, so the
  // rule lands with the other instructions about how to work rather than
  // orphaned at the bottom of the file.
  const heading = text.match(/^##\s+Operator preferences\s*$/m);
  let next;
  if (heading) {
    const start = heading.index + heading[0].length;
    const rest = text.slice(start);
    const nextHeading = rest.search(/^##\s+/m);
    const end = nextHeading === -1 ? text.length : start + nextHeading;
    const before = text.slice(0, end).replace(/\s*$/, "");
    next = `${before}\n\n${TASK_RULE}\n\n${text.slice(end)}`;
  } else {
    next = `${text.replace(/\s*$/, "")}\n\n## Working agreement\n\n${TASK_RULE}\n`;
  }
  next = next.replace(/\n{4,}/g, "\n\n\n");

  if (!dry) write(root, rel, next);
  return { status: "added", rel, section: heading ? "Operator preferences" : "Working agreement" };
}
