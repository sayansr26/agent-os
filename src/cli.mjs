import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { detect, summarise, TOOLS } from "./detect.mjs";
import { load, write, readIfExists, matches, BANNER, DIR } from "./source.mjs";
import { adopt } from "./adopt.mjs";
import { ensurePlugin, MARKETPLACE_NAME, PLUGIN } from "./plugin.mjs";
import { setupState, describeState } from "../plugins/agent-os/skills/init/scripts/state.mjs";
import { applyScope, describe } from "./claude-setup.mjs";
import { createInterface } from "node:readline/promises";
import { compile, TARGETS } from "./targets.mjs";

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const USAGE = `
${bold("agent-os")} — one source of truth for AI coding agent config

  agent-os init      set up a fresh project, or repair and update an existing one
  agent-os sync      recompile after editing .agent-os/
  agent-os check     verify nothing drifted (exit 1 if it has) — for CI
  agent-os detect    list which tools this project is set up for
  agent-os audit     inspect the project's context layer and report findings
  agent-os memory    inspect and health-check every memory store
  agent-os settings  preview git write protection + task tools for Claude Code
                     (--scope project|user|both, --apply to write)

  Without a global install, prefix any of these with
  ${dim("npx @sayansr26/agent-os")}

Options
  --root <dir>   project directory (default: cwd)
  --dry-run      print what would change, write nothing
  --force        overwrite files agent-os did not generate (it refuses by default)
  --no-plugin    skip installing or updating the Claude Code plugin during init
  --global       init: also write ~/.claude settings without asking
  --no-global    init: leave ~/.claude alone
`;

function scaffold(root, found) {
  const present = found.filter((t) => t.present).map((t) => t.id);
  mkdirSync(join(root, DIR, "rules"), { recursive: true });
  if (!existsSync(join(root, DIR, "config.json")))
    write(root, `${DIR}/config.json`, JSON.stringify({ targets: present.length ? present : ["claude-code"] }, null, 2) + "\n");

  // Take what the project already has as the source. Writing a placeholder over
  // a real AGENTS.md, then compiling the placeholder back on top of it, is the
  // exact drift this tool exists to prevent.
  const taken = adopt(root);
  if (taken.agents && !existsSync(join(root, DIR, "AGENTS.md")))
    write(root, `${DIR}/AGENTS.md`, taken.agents);
  for (const r of taken.rules)
    if (!existsSync(join(root, DIR, "rules", `${r.name}.md`)))
      write(root, `${DIR}/rules/${r.name}.md`, r.text);

  if (!existsSync(join(root, DIR, "AGENTS.md")))
    write(root, `${DIR}/AGENTS.md`, `# Project instructions

Replace this with what is true in **every** session: how to build, how to run,
how to verify, and the conventions that are not obvious from the code.

Keep it short. Anything that only matters for part of the tree belongs in
\`.agent-os/rules/\` instead, where it can be scoped to the files it applies to.
`);
  mkdirSync(join(root, DIR, "skills"), { recursive: true });

  // Only seed the placeholder when there was nothing to adopt. A project with
  // real rules does not need an `example.md` compiled into every tool it uses.
  const anyRule = readdirSync(join(root, DIR, "rules")).some((f) => f.endsWith(".md"));
  if (!anyRule)
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
  return { present, taken };
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

  if (cmd === "settings") {
    const i = argv.indexOf("--scope");
    runScript("plugins/agent-os/skills/init/scripts/settings.mjs",
      ["--root", root, "--scope", i === -1 ? "both" : argv[i + 1], ...(argv.includes("--apply") ? ["--apply"] : [])]);
    return;
  }

  if (cmd === "memory") {
    runScript("plugins/agent-os/skills/memory/scripts/memory.mjs", argv.includes("--stale") ? [root, "--stale"] : [root]);
    return;
  }

  let adopted = new Set();

  let before = null;
  if (cmd === "init") {
    console.log(`\n${bold("agent-os init")}  ${root}\n`);
    // Decide fresh vs repair before touching anything, and say which, so a
    // second run on a set-up project reads as a repair rather than a re-init.
    before = setupState(root);
    for (const l of describeState(before)) console.log(`  ${l}`);
    console.log({
      fresh: `\n  ${dim("Fresh setup: creating everything.")}`,
      repair: `\n  ${dim("Existing setup: fixing the items marked MISSING, leaving the rest as it is.")}`,
      healthy: `\n  ${dim("Setup is complete: re-syncing and checking the plugin for updates.")}`,
    }[before.status]);
    console.log("");
    console.log(summarise(found));
    const hadSource = existsSync(join(root, DIR));
    const { present, taken } = scaffold(root, found);
    adopted = taken.paths;
    if (taken.from.length) {
      console.log(`\n  adopted into ${DIR}/ ${dim("— your existing files are now the source")}`);
      for (const f of taken.from) console.log(`    ${f}`);
    } else if (hadSource) {
      console.log(`\n  kept ${DIR}/ ${dim("— already the source; nothing re-scaffolded")}`);
    } else {
      console.log(`\n  created ${DIR}/ ${dim("(config.json, AGENTS.md, rules/example.md)")}`);
    }
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
    // Never overwrite a file this tool did not write. A generated file carries
    // the banner; anything else at that path is the user's own work, and
    // silently compiling over it is worse than doing nothing.
    const force = argv.includes("--force");
    const isOurs = (f) => {
      const cur = readIfExists(root, f.path);
      if (cur === null) return true;                       // nothing there yet
      if (cur.includes(BANNER)) return true;               // we wrote it
      if (TARGETS[f.target]?.merge) return true;           // merged in place, nothing lost
      if (adopted.has(f.path)) return true;                // init just took this as the source
      if (matches(root, f.path, f.content) === true) return true; // already identical
      return false;
    };

    const blocked = [];
    for (const [t, fs_] of Object.entries(byTarget)) {
      console.log(`  ${labelFor(t).padEnd(38)} ${fs_.length} file(s)`);
      for (const f of fs_) {
        if (!force && !isOurs(f)) { blocked.push(f.path); console.log(`    ${f.path}  ${dim("SKIPPED — not generated by agent-os")}`); continue; }
        if (!dry) write(root, f.path, f.content);
        console.log(`    ${f.path}`);
      }
    }

    if (blocked.length) {
      console.log(`\n${bold(`${blocked.length} file(s) left alone`)} because agent-os did not write them:\n`);
      for (const b of blocked) console.log(`  ${b}`);
      console.log(`
Pick one:
  · move the content into ${DIR}/ so it becomes the source, then re-run
  · ${dim("--force")} to overwrite (the current content is lost — commit first)
`);
      process.exitCode = 1;
      return;
    }

    console.log(`\n${dim("Generated files carry a banner. Edit .agent-os/ and re-run sync; never edit them directly.")}`);

    // The rules are done and safe at this point. The Claude Code plugin is the
    // other half — agents, skills, per-agent memory, the session hook — and it
    // installs from the same repo. Only on `init`, never on `sync`.
    if (cmd === "init" && targets.includes("claude-code")) {
      console.log(`\n${bold("Claude Code setup")}\n`);

      // Project scope always: it travels with the repo. User scope protects
      // every other project on the machine too, so it is asked once rather
      // than assumed — unless --global / --no-global already answered.
      for (const l of describe(applyScope("project", root, { dry }), { dry })) console.log(`  ${l}`);

      let global = argv.includes("--global") ? true : argv.includes("--no-global") ? false : null;
      if (global === null && !dry && process.stdin.isTTY && process.stdout.isTTY) {
        console.log("");
        for (const l of describe(applyScope("user", root, { dry: true }), { dry: true })) console.log(`  ${l}`);
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const a = (await rl.question(`\n  Apply the same to ~/.claude (every project on this machine)? [Y/n] `)).trim().toLowerCase();
        rl.close();
        global = a === "" || a === "y" || a === "yes";
      }
      if (global) {
        console.log("");
        for (const l of describe(applyScope("user", root, { dry }), { dry })) console.log(`  ${l}`);
      } else if (global === null) {
        console.log(`\n  ${dim("~/.claude left alone (not a terminal). To protect every project:")}`);
        console.log(`  ${dim("npx @sayansr26/agent-os settings --scope user --apply")}`);
      }
    }

    if (cmd === "init" && targets.includes("claude-code") && !argv.includes("--no-plugin")) {
      console.log(`\n${bold("Claude Code plugin")} ${dim(`${PLUGIN}@${MARKETPLACE_NAME}`)}\n`);
      const r = ensurePlugin({ root, dry });
      for (const line of r.done) console.log(`  ${dim(line)}`);
      if (r.ok) console.log({
        installed: `\n  installed ${r.to || ""} at project scope ${dim("— .claude/settings.json, so it travels with the repo")}`,
        updated: `\n  updated ${r.from} → ${r.to}`,
        current: `\n  already the latest (${r.to})`,
        "dry-run": `\n  ${dim(r.from ? `installed: ${r.from} — would refresh and update` : "not installed — would install")}`,
      }[r.reason]);
      for (const line of r.hint) console.log(`  ${r.ok ? dim(line) : line}`);
      if (r.reason === "installed" || r.reason === "updated")
        console.log(`  ${dim("restart Claude Code, or /reload-plugins, to load it")}`);
      console.log(`\n  ${dim("--no-plugin skips this")}`);
    }

    if (cmd === "init" && !dry) {
      const after = setupState(root);
      console.log(`\n${bold("Result")}  ${before.status} → ${after.status}`);
      if (after.missing.length) {
        console.log(dim("  still to do:"));
        for (const i of after.missing) console.log(`    ${i.label}  → ${i.fix}`);
      }
    }
    console.log("");
    return;
  }

  console.log(USAGE);
}
