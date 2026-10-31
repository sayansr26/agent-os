/**
 * The agent-os layer for Cursor: the same agents, skills and hooks the Claude
 * Code plugin ships, compiled into the places Cursor reads them.
 *
 *   .cursor/agents/agent-os-<name>.md        the seven agents, as subagents
 *   .cursor/skills/agent-os-{init,map,memory}/  the three skills
 *   .cursor/hooks/agent-os/                  the session and pre-edit hooks, plus
 *                                            git write protection
 *   .cursor/hooks.json                       merged: user hooks are kept
 *   .cursor/rules/agent-os-agents.mdc        when to use which agent, always on
 *
 * Everything is generated from this package, never from `.agent-os/`, so `sync`
 * keeps it current the way `claude plugin update` does for Claude Code.
 *
 * Agent memory stays in `.claude/agent-memory/agent-os-<name>/`: the directory
 * Claude Code's plugin agents use, so a project on both tools has one map.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNER, parseFrontmatter } from "./source.mjs";
import { GIT_DENY } from "../plugins/agent-os/skills/init/scripts/settings.mjs";

const PKG = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PLUGIN = join(PKG, "plugins/agent-os");
const OWN = join(PKG, "cursor");
const HOOKS = ".cursor/hooks/agent-os";

const read = (p) => readFileSync(p, "utf8");
const md = (fields, body) => `---\n${fields}---\n\n<!-- ${BANNER} -->\n\n${body.trim()}\n`;
const js = (text) => text.startsWith("#!")
  ? text.replace(/^(#!.*\n)/, `$1// ${BANNER}\n`)
  : `// ${BANNER}\n${text}`;

/** `{ "cursor": { "agentOs": false } }` turns the whole layer off. */
export const enabled = (config) => config?.cursor?.agentOs !== false;
const gitGuard = (config) => config?.cursor?.gitProtection !== false;

/** Claude Code names and commands, rewritten to what this layer installs. */
export function translate(text) {
  return text
    .replace(/agent-os:([a-z][a-z-]*)/g, "agent-os-$1")
    .replace(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/\w+\/scripts\/(\w+)\.mjs"/g, "npx -y @sayansr26/agent-os $1");
}

/** A description is what the parent reads to pick a subagent, so it names Cursor's files. */
const describe = (d) => JSON.stringify(translate(String(d || ""))
  .replace(/CLAUDE\.md/g, "AGENTS.md").replace(/\.claude\/rules\//g, ".cursor/rules/"));

const READ_AS = `> **Running in Cursor.** This text was written for Claude Code. Read it as:
> \`CLAUDE.md\` → \`AGENTS.md\` (edit \`.agent-os/AGENTS.md\`, then \`npx @sayansr26/agent-os sync\`);
> \`.claude/rules/\` → \`.cursor/rules/\` (edit \`.agent-os/rules/\`, then sync);
> an agent \`<name>\` → the \`agent-os-<name>\` subagent; \`/agent-os:<skill>\` → \`/agent-os-<skill>\`;
> "the Agent tool" or "dispatch" → delegate to that subagent.`;

function agents() {
  const dir = join(PLUGIN, "agents");
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const { fields, body } = parseFrontmatter(read(join(dir, f)));
    const name = `agent-os-${fields.name}`;
    // Claude Code creates the memory directory and preloads MEMORY.md for an
    // agent with `memory: project`. Cursor does neither, so the agent is told.
    const memory = `> **Your memory directory** is \`.claude/agent-memory/${name}/\` at the project root
> (shared with Claude Code's agent-os agents). Create it if it does not exist. Cursor does
> not load \`MEMORY.md\` for you — read it yourself before anything else.
>
${READ_AS}`;
    return {
      path: `.cursor/agents/${name}.md`,
      content: md(
        `name: ${name}\ndescription: ${describe(fields.description)}\nmodel: inherit\n`,
        `${memory}\n\n${translate(body)}`),
    };
  });
}

function skills() {
  const out = [];
  const refs = join(PLUGIN, "skills/init/references");
  // init is rewritten for Cursor; its references are shared, read through the table.
  {
    const { fields, body } = parseFrontmatter(read(join(OWN, "skills/agent-os-init/SKILL.md")));
    out.push({ path: ".cursor/skills/agent-os-init/SKILL.md",
      content: md(`name: ${fields.name}\ndescription: ${JSON.stringify(fields.description)}\n`, body) });
    for (const f of readdirSync(refs).filter((f) => f.endsWith(".md")).sort())
      out.push({ path: `.cursor/skills/agent-os-init/references/${f}`,
        content: `<!-- ${BANNER} -->\n\n${READ_AS}\n\n${translate(read(join(refs, f))).trim()}\n` });
  }
  // map and memory carry over as they are, renamed. Their scripts run through
  // the CLI, which bundles the same files, so no script is copied.
  for (const s of ["map", "memory"]) {
    const { fields, body } = parseFrontmatter(read(join(PLUGIN, "skills", s, "SKILL.md")));
    out.push({ path: `.cursor/skills/agent-os-${s}/SKILL.md`,
      content: md(`name: agent-os-${s}\ndescription: ${describe(fields.description)}\n`, `${READ_AS}\n\n${translate(body)}`) });
  }
  return out;
}

function hookScripts(config) {
  const out = [
    { path: `${HOOKS}/hooks/session-resume.mjs`, content: js(read(join(PLUGIN, "hooks/session-resume.mjs"))) },
    { path: `${HOOKS}/hooks/pre-edit.mjs`, content: js(read(join(PLUGIN, "hooks/pre-edit.mjs"))) },
    { path: `${HOOKS}/lib/features.mjs`, content: js(read(join(PLUGIN, "lib/features.mjs"))) },
  ];
  if (gitGuard(config)) out.push(
    { path: `${HOOKS}/hooks/git-guard.mjs`, content: js(read(join(OWN, "hooks/git-guard.mjs"))) },
    { path: `${HOOKS}/lib/git-deny.mjs`,
      content: js(`/** The same rules Claude Code gets as permissions.deny (settings.mjs). */\nexport const GIT_DENY = ${JSON.stringify(GIT_DENY, null, 2)};\n`) },
  );
  return out;
}

/** The agent contract, always on — the Cursor half of CLAUDE.md's Step 4b section. */
const contract = () => ({
  path: ".cursor/rules/agent-os-agents.mdc",
  content: md("description: When to use each agent-os subagent\nalwaysApply: true\n", `## Agents in this project (agent-os)

Delegate to these subagents without being asked:

- Before changing an existing feature: ask \`agent-os-feature-cartographer\` how
  it is built. In plan mode ask it read-only, and have it file the map as the
  first step after plan mode ends.
- New subsystem, cross-module change, shared data model: \`agent-os-architect\` first.
- Writing the change: \`agent-os-builder\`, given the map and the files to change.
- Done means: \`agent-os-tester\` verified it and \`agent-os-reviewer\` found no
  rule violations.
- Once verified: \`agent-os-documenter\` records it.
- Work spanning several of these, or that cannot be stated in one sentence:
  \`agent-os-orchestrator\`.

\`/agent-os-map\` builds the architecture map, \`/agent-os-memory\` inspects agent
memory, \`/agent-os-init\` sets up or repairs all of this.

Generated files carry a banner. Edit \`.agent-os/\`, then run
\`npx @sayansr26/agent-os sync\`; never edit the output.`),
});

/** Every file of the layer except hooks.json. */
export function cursorFiles(src) {
  if (!enabled(src.config)) return [];
  return [...agents(), ...skills(), ...hookScripts(src.config), contract()];
}

const OURS = (h) => String(h?.command || "").includes(`${HOOKS}/`);

/**
 * Merge the agent-os hooks into `.cursor/hooks.json`. Hooks the user wrote are
 * kept; earlier agent-os entries are replaced, so a removed hook goes away.
 */
export function mergeHooks(src, existing) {
  if (!existing && !enabled(src.config)) return [];
  const cfg = existing ? JSON.parse(existing) : { version: 1, hooks: {} };
  cfg.version ||= 1;
  cfg.hooks ||= {};
  for (const ev of Object.keys(cfg.hooks)) {
    cfg.hooks[ev] = (cfg.hooks[ev] || []).filter((h) => !OURS(h));
    if (!cfg.hooks[ev].length) delete cfg.hooks[ev];
  }
  if (enabled(src.config)) {
    const add = (ev, h) => (cfg.hooks[ev] ||= []).push(h);
    add("sessionStart", { command: `node ${HOOKS}/hooks/session-resume.mjs --cursor` });
    add("preToolUse", { command: `node ${HOOKS}/hooks/pre-edit.mjs --cursor`, matcher: "Write" });
    if (gitGuard(src.config))
      add("beforeShellExecution", { command: `node ${HOOKS}/hooks/git-guard.mjs`, matcher: "\\bgit\\b" });
  }
  return [{ path: ".cursor/hooks.json", content: JSON.stringify(cfg, null, 2) + "\n" }];
}
