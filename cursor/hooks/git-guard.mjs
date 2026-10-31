#!/usr/bin/env node
/**
 * Cursor beforeShellExecution hook — git write protection.
 *
 * Claude Code gets this as `permissions.deny` rules in .claude/settings.json.
 * Cursor has no deny list, so the same rules (GIT_DENY, generated next to this
 * file from settings.mjs) are enforced here: any git command that changes the
 * repository is denied, read-only inspection is allowed.
 *
 * The hook is registered with a `git` matcher, so it only sees commands that
 * mention git. Cursor reads a missing or invalid response as a block, so every
 * exit answers explicitly.
 */
import { readFileSync } from "node:fs";
import { GIT_DENY } from "../lib/git-deny.mjs";

const answer = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };

// "Bash(git push *)" -> "git push" plus anything after a space;
// "Bash(git -C*)" -> anything starting "git -C".
const RULES = GIT_DENY.map((r) => r.replace(/^Bash\(/, "").replace(/\)$/, "")).map((r) =>
  r.endsWith(" *") ? { prefix: r.slice(0, -2), spaced: true } : { prefix: r.replace(/\*$/, ""), spaced: false });

const denied = (segment) => {
  const cmd = segment.trim().replace(/\s+/g, " ").replace(/^(?:\w+=\S*\s+)+/, "");
  return RULES.find((r) => r.spaced ? cmd === r.prefix || cmd.startsWith(`${r.prefix} `) : cmd.startsWith(r.prefix));
};

let command = "";
try { command = String(JSON.parse(readFileSync(0, "utf8") || "{}").command ?? ""); } catch { answer({ permission: "allow" }); }

// Check every command in a chain: `cd x && git push` is still a push.
for (const segment of command.split(/&&|\|\||[;|\n]|\$\(|`/)) {
  const hit = denied(segment);
  if (!hit) continue;
  const text = `agent-os blocks git commands that change the repository (${hit.prefix}${hit.spaced ? " …" : "…"}). ` +
    "Read-only git (status, log, diff, show, blame) is allowed. Ask the user to run this one themselves.";
  answer({ permission: "deny", user_message: text, agent_message: text });
}
answer({ permission: "allow" });
