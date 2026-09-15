/**
 * Which agent tools is this project already set up for?
 *
 * Detection is by evidence on disk, never by asking. A tool counts as present
 * if its config exists here — that is the only signal that survives a fresh
 * clone, and the only one that matters for deciding what to compile.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

/**
 * `rules` — can the tool scope instructions to file globs?
 *   "native"    same `paths:` array as the canonical source; copy verbatim
 *   "translate" supports scoping with a different schema; must be converted
 *   "none"      no conditional loading; gets AGENTS.md and an instructions list
 */
export const TOOLS = [
  { id: "claude-code", name: "Claude Code",  rules: "native",
    marks: [".claude", "CLAUDE.md"],            home: [".claude"] },
  { id: "cline",       name: "Cline",        rules: "native",
    marks: [".clinerules", ".cline"],           home: [".cline"] },
  { id: "cursor",      name: "Cursor",       rules: "translate",
    marks: [".cursor"],                         home: [".cursor"] },
  { id: "windsurf",    name: "Windsurf",     rules: "translate",
    marks: [".windsurf", ".windsurfrules", ".devin"], home: [".codeium/windsurf"] },
  { id: "antigravity", name: "Antigravity",  rules: "translate",
    marks: [".agents/rules", ".agent/rules"],   home: [".gemini/config"] },
  { id: "gemini-cli",  name: "Gemini CLI",   rules: "none",
    marks: [".gemini", "GEMINI.md"],            home: [".gemini"] },
  { id: "opencode",    name: "OpenCode",     rules: "none",
    marks: [".opencode", "opencode.json", "opencode.jsonc"], home: [".config/opencode"] },
  { id: "kilo",        name: "Kilo",         rules: "none",
    marks: [".kilo", "kilo.json", "kilo.jsonc", ".kilocode"], home: [".config/kilo"] },
];

export function detect(root) {
  return TOOLS.map((t) => {
    const inProject = t.marks.some((m) => existsSync(join(root, m)));
    const onMachine = (t.home || []).some((h) => existsSync(join(HOME, h)));
    return { ...t, inProject, onMachine, present: inProject || onMachine };
  });
}

export function summarise(found) {
  const lines = [];
  for (const t of found) {
    const where = t.inProject ? "project" : t.onMachine ? "machine only" : "—";
    lines.push(`  ${t.present ? "✓" : " "} ${t.name.padEnd(14)} ${where.padEnd(14)} rules: ${t.rules}`);
  }
  return lines.join("\n");
}
