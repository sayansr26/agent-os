import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { detect, summarise, TOOLS } from "./detect.mjs";
import { load, write, readIfExists, matches, DIR } from "./source.mjs";
import { compile, TARGETS } from "./targets.mjs";

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const USAGE = `
${bold("agent-os")} — one source of truth for AI coding agent config

  agent-os init      detect your tools, create .agent-os/, compile
  agent-os sync      recompile after editing .agent-os/
  agent-os check     verify nothing drifted (exit 1 if it has) — for CI
  agent-os detect    list which tools this project is set up for
  agent-os audit     inspect the project's context layer and report findings
  agent-os memory    inspect and health-check every memory store

  Without a global install, prefix any of these with
  ${dim("npx @sayansr26/agent-os")}

Options
  --root <dir>   project directory (default: cwd)
  --dry-run      print what would change, write nothing
`;

function scaffold(root, found) {
  const present = found.filter((t) => t.present).map((t) => t.id);
  mkdirSync(join(root, DIR, "rules"), { recursive: true });
  if (!existsSync(join(root, DIR, "config.json")))
    write(root, `${DIR}/config.json`, JSON.stringify({ targets: present.length ? present : ["claude-code"] }, null, 2) + "\n");
  if (!existsSync(join(root, DIR, "AGENTS.md")))
    write(root, `${DIR}/AGENTS.md`, `# Project instructions

Replace this with what is true in **every** session: how to build, how to run,
how to verify, and the conventions that are not obvious from the code.

Keep it short. Anything that only matters for part of the tree belongs in
\`.agent-os/rules/\` instead, where it can be scoped to the files it applies to.
`);
  mkdirSync(join(root, DIR, "skills"), { recursive: true });
  if (!existsSync(join(root, DIR, "rules", "example.md")))
    write(root, `${DIR}/rules/example.md`, `---
description: Conventions for the API layer
paths:
  - "src/api/**"
---

Delete this file once you have written a real one.

A rule with \`paths:\` is loaded only when the agent touches a matching file, in
every tool that supports conditional loading. Tools that do not support it get
these as a referenced list instead of always-on text.
`);
  return present;
}

export async function main(argv) {
  const cmd = argv.find((a) => !a.startsWith("-")) || "help";
  const root = (() => { const i = argv.indexOf("--root"); return i === -1 ? process.cwd() : argv[i + 1]; })();
  const dry = argv.includes("--dry-run");

  if (cmd === "help" || argv.includes("-h") || argv.includes("--help")) { console.log(USAGE); return; }

  const found = detect(root);

  if (cmd === "detect") {
    console.log(`\n${bold("Tools detected")}  ${root}\n`);
    console.log(summarise(found));
    console.log(`\n${dim("rules: native = same paths: schema · translate = converted · none = AGENTS.md + instructions list")}\n`);
    return;
  }

  // Deterministic inspections. Both are plain scripts, so they run anywhere —
  // unlike `map`, which dispatches an agent and therefore needs a model, not a
  // CLI. That one stays a Claude Code skill.
  const PKG = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const runScript = (rel, args) => {
    const script = join(PKG, rel);
    if (!existsSync(script)) throw new Error(`missing bundled script: ${rel}`);
    const r = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
    if (r.error) throw r.error;
    process.exitCode = r.status ?? 0;
  };

  if (cmd === "audit") {
    console.log(`\n${bold("Tools detected")}\n`);
    console.log(summarise(found));
    runScript("plugins/agent-os/skills/init/scripts/audit.mjs", [root]);
    console.log(dim("\nThe audit above is written around Claude Code's layout (CLAUDE.md,"));
    console.log(dim(".claude/rules/, hooks, agent memory). For the other tools, `agent-os check`"));
    console.log(dim("is the one that matters — it verifies their generated config matches source.\n"));
    return;
  }

  if (cmd === "memory") {
    runScript("plugins/agent-os/skills/memory/scripts/memory.mjs", argv.includes("--stale") ? [root, "--stale"] : [root]);
    return;
  }

  if (cmd === "init") {
    console.log(`\n${bold("agent-os init")}  ${root}\n`);
    console.log(summarise(found));
    const present = scaffold(root, found);
    console.log(`\n  created ${DIR}/ ${dim("(config.json, AGENTS.md, rules/example.md)")}`);
    if (!present.length) console.log(`  ${dim("no tools detected — defaulting to claude-code; edit .agent-os/config.json")}`);
  }

  if (cmd === "init" || cmd === "sync" || cmd === "check") {
    const src = load(root);
    if (!src) throw new Error(`no ${DIR}/ here. Run \`agent-os init\` first.`);
    const targets = (src.config.targets || []).filter((t) => TARGETS[t]);
    const unknown = (src.config.targets || []).filter((t) => !TARGETS[t]);
    if (unknown.length) console.log(`  ${dim(`ignoring unknown target(s): ${unknown.join(", ")}`)}`);

    const files = compile(src, targets, (rel) => readIfExists(root, rel));

    if (cmd === "check") {
      const state = files.map((f) => ({ f, m: matches(root, f.path, f.content) }));
      const drifted = state.filter((s) => s.m !== true);
      console.log(`\n${bold("agent-os check")}  ${root}\n`);
      for (const { f, m } of state)
        console.log(`  ${m === true ? "ok    " : m === null ? "MISSING" : "DRIFTED"} ${f.path}`);
      if (drifted.length) {
        console.log(`\n${drifted.length} file(s) out of date. Run \`agent-os sync\`.\n`);
        process.exitCode = 1;
      } else console.log(`\nAll ${files.length} generated file(s) match the source.\n`);
      return;
    }

    console.log(`\n${bold(dry ? "would write" : "wrote")}  ${dim(`${src.rules.length} rule(s) -> ${targets.length} tool(s) + AGENTS.md`)}\n`);
    const byTarget = {};
    for (const f of files) (byTarget[f.target] ||= []).push(f);
    const labelFor = (t) => {
      if (t === "universal") return "AGENTS.md";
      if (t.startsWith("skills:")) {
        const ids = t.slice(7).split("+").map((i) => TARGETS[i]?.label || i);
        return `skills → ${ids.join(", ")}`;
      }
      return TARGETS[t]?.label || t;
    };
    for (const [t, fs_] of Object.entries(byTarget)) {
      console.log(`  ${labelFor(t).padEnd(38)} ${fs_.length} file(s)`);
      for (const f of fs_) {
        if (!dry) write(root, f.path, f.content);
        console.log(`    ${f.path}`);
      }
    }
    console.log(`\n${dim("Generated files carry a banner. Edit .agent-os/ and re-run sync; never edit them directly.")}\n`);
    return;
  }

  console.log(USAGE);
}
