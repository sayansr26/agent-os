#!/usr/bin/env node
/** End-to-end: scaffold a throwaway project, compile all 8 targets, assert the
 *  output matches each tool's real schema, and prove drift is detected. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// Every child inherits this, so nothing here can ever touch the real ~/.claude.
const HOME = mkdtempSync(join(tmpdir(), "agent-os-home-"));
process.env.CLAUDE_CONFIG_DIR = HOME;
const PLUGIN = join(PKG, "plugins/agent-os");
const node = (script, args, opts = {}) =>
  spawnSync(process.execPath, [join(PLUGIN, script), ...args], { encoding: "utf8", ...opts });
const cli = (args, cwd) => spawnSync(process.execPath, [join(PKG, "bin/agent-os.mjs"), ...args, "--root", cwd], { encoding: "utf8" });
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? "ok  " : "FAIL"} ${m}`); if (!c) fail++; };

const root = mkdtempSync(join(tmpdir(), "agent-os-"));
try {
  mkdirSync(join(root, ".agent-os/rules"), { recursive: true });
  mkdirSync(join(root, ".agent-os/skills/demo"), { recursive: true });
  writeFileSync(join(root, ".agent-os/config.json"), JSON.stringify({
    targets: ["claude-code","cline","cursor","windsurf","antigravity","gemini-cli","opencode","kilo"] }));
  writeFileSync(join(root, ".agent-os/AGENTS.md"), "# Test project\n\nBuild with `make`.\n");
  writeFileSync(join(root, ".agent-os/rules/api.md"),
    '---\ndescription: API conventions\npaths:\n  - "src/api/**"\n---\n\nValidate at the boundary.\n');
  writeFileSync(join(root, ".agent-os/rules/global.md"),
    "---\ndescription: Applies everywhere\nalways: true\n---\n\nNever commit secrets.\n");
  writeFileSync(join(root, ".agent-os/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: A demo skill.\n---\n\nDo the thing.\n");

  const r = cli(["sync"], root);
  ok(r.status === 0, `sync exits 0 ${r.status === 0 ? "" : "\n" + r.stderr}`);
  const read = (p) => existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : null;

  console.log("\n  each target gets its own schema");
  ok(read(".claude/rules/api.md")?.includes('paths:\n  - "src/api/**"'), "Claude Code: paths: verbatim");
  ok(read(".clinerules/api.md")?.includes('paths:\n  - "src/api/**"'), "Cline: paths: verbatim");
  const cur = read(".cursor/rules/api.mdc");
  ok(cur?.includes("globs: src/api/**") && cur.includes("alwaysApply: false"), "Cursor: globs + alwaysApply");
  ok(read(".cursor/rules/global.mdc")?.includes("alwaysApply: true"), "Cursor: always rule -> alwaysApply: true");
  ok(read(".windsurf/rules/api.md")?.includes("trigger: glob"), "Windsurf: trigger: glob");
  ok(read(".windsurf/rules/global.md")?.includes("trigger: always_on"), "Windsurf: always rule -> always_on");
  ok(read(".agents/rules/api.md")?.includes("Intended activation: Glob"), "Antigravity: scope stated, no invented syntax");
  ok(JSON.parse(read(".gemini/settings.json")).context.fileName.includes("AGENTS.md"), "Gemini CLI: context.fileName");
  ok(JSON.parse(read("opencode.json")).instructions.some((i) => i.includes("api.md")), "OpenCode: instructions array");
  ok(JSON.parse(read("kilo.json")).instructions.some((i) => i.includes("api.md")), "Kilo: instructions array");

  console.log("\n  universal + skills");
  const am = read("AGENTS.md");
  ok(am?.includes("Never commit secrets"), "AGENTS.md inlines always-on rules");
  ok(am?.includes("src/api/**"), "AGENTS.md lists scoped rules rather than inlining");
  ok(read(".agents/skills/demo/SKILL.md")?.includes("name: demo"), "skills -> .agents/skills (4 vendors)");
  ok(read(".claude/skills/demo/SKILL.md") !== null, "skills -> .claude/skills");
  ok(read(".cline/skills/demo/SKILL.md") !== null, "skills -> .cline/skills");

  console.log("\n  Cursor gets the agent-os layer");
  {
    const agents = ["architect", "builder", "documenter", "feature-cartographer", "orchestrator", "reviewer", "tester"];
    ok(agents.every((a) => read(`.cursor/agents/agent-os-${a}.md`)?.startsWith(`---\nname: agent-os-${a}\n`)), "7 subagents in .cursor/agents/, Cursor-legal names");
    const carto = read(".cursor/agents/agent-os-feature-cartographer.md");
    ok(carto.includes(".claude/agent-memory/agent-os-feature-cartographer/"), "subagent memory shared with Claude Code's directory");
    ok(!/agent-os:[a-z]/.test(carto) && !/^memory:|^tools:/m.test(carto), "no Claude-only names or frontmatter left");
    ok(["init", "map", "memory"].every((s) => read(`.cursor/skills/agent-os-${s}/SKILL.md`)?.includes(`name: agent-os-${s}\n`)), "skills /agent-os-init, -map, -memory");
    ok(!read(".cursor/skills/agent-os-memory/SKILL.md").includes("CLAUDE_PLUGIN_ROOT"), "skill scripts run through the CLI");
    ok(read(".cursor/rules/agent-os-agents.mdc")?.includes("alwaysApply: true"), "agent contract is an always-on rule");
    const hooks = JSON.parse(read(".cursor/hooks.json"));
    ok(hooks.version === 1 && hooks.hooks.sessionStart && hooks.hooks.preToolUse && hooks.hooks.beforeShellExecution, "hooks.json: sessionStart, preToolUse, beforeShellExecution");

    const hook = (script, args, input) => spawnSync(process.execPath, [join(root, ".cursor/hooks/agent-os/hooks", script), ...args],
      { cwd: root, encoding: "utf8", input, env: { ...process.env, CURSOR_PROJECT_DIR: root } }).stdout;
    const start = JSON.parse(hook("session-resume.mjs", ["--cursor"], ""));
    ok(start.additional_context?.includes("`agent-os-feature-cartographer`"), "session start returns additional_context with Cursor names");
    const pre = (file) => JSON.parse(hook("pre-edit.mjs", ["--cursor"], JSON.stringify({ tool_input: { file_path: join(root, file) } })));
    ok(pre(".cursor/rules/api.mdc").permission === "deny", "pre-edit denies an edit to a generated rule");
    ok(pre(".cursor/agents/agent-os-builder.md").permission === "deny", "pre-edit denies an edit to a generated subagent");
    ok(pre("src/new.ts").permission === "allow", "pre-edit answers allow, never empty, for everything else");
    const git = (command) => JSON.parse(hook("git-guard.mjs", [], JSON.stringify({ command }))).permission;
    ok(git("git status") === "allow" && git("git log --oneline") === "allow", "read-only git allowed");
    ok(["git push", "git commit -m x", "cd a && git reset --hard", "git -C x add .", "A=1 git rebase main"].every((c) => git(c) === "deny"), "git writes denied, chained and flag forms too");

    writeFileSync(join(root, ".cursor/hooks.json"), JSON.stringify({ version: 1, hooks: { afterFileEdit: [{ command: "./fmt.sh" }] } }));
    cli(["sync"], root);
    const merged = JSON.parse(read(".cursor/hooks.json")).hooks;
    ok(merged.afterFileEdit?.[0]?.command === "./fmt.sh" && merged.sessionStart?.length === 1, "hooks.json merged: user hook kept, ours added once");
    cli(["sync"], root);
    ok(JSON.parse(read(".cursor/hooks.json")).hooks.preToolUse.length === 1, "re-sync does not duplicate hooks");
  }

  console.log("\n  drift");
  ok(cli(["check"], root).status === 0, "check passes when in sync");
  // Realistic drift: someone edits the body of a generated file and leaves the
  // banner in place. sync owns that file and must put it back.
  writeFileSync(join(root, ".cursor/rules/api.mdc"),
    read(".cursor/rules/api.mdc").replace("Validate at the boundary.", "hand edited"));
  const d = cli(["check"], root);
  ok(d.status === 1, "check exits 1 on drift");
  ok(d.stdout.includes("DRIFTED"), "check names the drifted file");
  ok(cli(["sync"], root).status === 0 && cli(["check"], root).status === 0, "sync repairs drift");
  // Banner stripped: now indistinguishable from a hand-written file, so sync
  // refuses rather than guessing.
  writeFileSync(join(root, ".cursor/rules/api.mdc"), "mine now\n");
  ok(cli(["sync"], root).status === 1, "sync refuses once the banner is gone");
  ok(read(".cursor/rules/api.mdc") === "mine now\n", "and leaves that file untouched");
  cli(["sync", "--force"], root);

  console.log("\n  never clobbers what it did not write");
  {
    const r2 = mkdtempSync(join(tmpdir(), "agent-os-adopt-"));
    mkdirSync(join(r2, ".claude/rules"), { recursive: true });
    const realAgents = "# Real AGENTS.md\n\nCLAUDE.md is the source of truth.\n";
    writeFileSync(join(r2, "AGENTS.md"), realAgents);
    writeFileSync(join(r2, ".claude/rules/theming.md"),
      '---\ndescription: Theming\npaths:\n  - "src/**/*.tsx"\n---\n\nUse the token set.\n');

    const i = cli(["init", "--no-plugin"], r2);
    ok(i.status === 0, "init exits 0 on a project that already has rules");
    ok(readFileSync(join(r2, "AGENTS.md"), "utf8") === realAgents ||
       readFileSync(join(r2, ".agent-os/AGENTS.md"), "utf8") === realAgents,
       "existing AGENTS.md becomes the source rather than being replaced");
    ok(existsSync(join(r2, ".agent-os/rules/theming.md")), "existing .claude/rules/ are adopted");
    ok(!existsSync(join(r2, ".agent-os/rules/example.md")), "no example.md when real rules were adopted");
    ok(!existsSync(join(r2, ".claude/rules/example.md")), "no example.md compiled into the project");
    ok(!i.stdout.includes("--no-plugin skips this"), "--no-plugin skips the plugin install");

    // init offers the plugin when not told otherwise; --dry-run proves the
    // commands without running them against the machine's real config.
    const r4 = mkdtempSync(join(tmpdir(), "agent-os-plug-"));
    const pi = cli(["init", "--dry-run"], r4);
    ok(pi.stdout.includes("--no-plugin skips this"), "init sets up the Claude Code plugin by default");
    ok(pi.stdout.includes("SETUP  FRESH"), "init on an empty project reports a fresh setup");
    ok(/marketplace add sayansr26\/agent-os|plugin marketplace add|not on PATH/.test(pi.stdout),
       "init names the marketplace step or says why it could not run it");
    ok(pi.stdout.includes("auto-route@sayan-plugins"), "init sets up auto-route by default");
    ok(pi.stdout.includes("auto-handoff@sayan-plugins"), "init sets up auto-handoff by default");
    ok((pi.stdout.match(/marketplace add/g) || []).length <= 1, "the marketplace is added once, not per plugin");
    const na = cli(["init", "--dry-run", "--no-auto-route"], r4);
    ok(!/install auto-route@sayan-plugins/.test(na.stdout) && /install agent-os@sayan-plugins/.test(na.stdout),
       "--no-auto-route keeps agent-os and skips auto-route");
    const nh = cli(["init", "--dry-run", "--no-auto-handoff"], r4);
    ok(!/install auto-handoff@sayan-plugins/.test(nh.stdout) && /install auto-route@sayan-plugins/.test(nh.stdout),
       "--no-auto-handoff skips only auto-handoff");
    rmSync(r4, { recursive: true, force: true });

    // A hand-written file at a generated path must survive a sync.
    const r3 = mkdtempSync(join(tmpdir(), "agent-os-guard-"));
    mkdirSync(join(r3, ".agent-os/rules"), { recursive: true });
    writeFileSync(join(r3, ".agent-os/config.json"), JSON.stringify({ targets: ["claude-code"] }));
    writeFileSync(join(r3, ".agent-os/AGENTS.md"), "# Compiled\n");
    writeFileSync(join(r3, ".agent-os/rules/x.md"), '---\npaths:\n  - "a/**"\n---\n\nBody.\n');
    const mine = "# Mine, by hand\n";
    writeFileSync(join(r3, "AGENTS.md"), mine);
    const g = cli(["sync"], r3);
    ok(g.status === 1, "sync exits 1 rather than clobbering");
    ok(readFileSync(join(r3, "AGENTS.md"), "utf8") === mine, "hand-written AGENTS.md survives sync");
    ok(g.stdout.includes("SKIPPED"), "sync says which file it left alone");
    const fg = cli(["sync", "--force"], r3);
    ok(fg.status === 0 && readFileSync(join(r3, "AGENTS.md"), "utf8") !== mine, "--force overwrites when asked");
    rmSync(r2, { recursive: true, force: true });
    rmSync(r3, { recursive: true, force: true });
  }

  console.log("\n  Claude Code project setup");
  {
    const r5 = mkdtempSync(join(tmpdir(), "agent-os-cc-"));
    mkdirSync(join(r5, ".claude"), { recursive: true });
    // An existing settings.json with unrelated keys must survive untouched.
    writeFileSync(join(r5, ".claude/settings.json"),
      JSON.stringify({ permissions: { deny: ["Bash(git push *)"] }, env: { FOO: "bar" } }, null, 2));
    writeFileSync(join(r5, "CLAUDE.md"),
      "# CLAUDE.md\n\nStack notes.\n\n## Operator preferences\n\n- Never run git unasked.\n\n## Verification\n\nRun make test.\n");

    cli(["init", "--no-plugin"], r5);
    const st = JSON.parse(readFileSync(join(r5, ".claude/settings.json"), "utf8"));
    ok(st.env.CLAUDE_CODE_ENABLE_TODO_TOOLS === "1", "todo tools enabled in project settings");
    ok(st.env.FOO === "bar", "existing env keys preserved");
    ok(st.permissions?.deny?.[0] === "Bash(git push *)", "existing permissions preserved");
    ok(st.permissions.deny.length === 42, "git write protection merged into project settings, no duplicate push rule");
    ok(!existsSync(join(HOME, "settings.json")), "without --global (and no terminal) ~/.claude is left alone");
    ok(!existsSync(join(r5, ".claude/settings.json.agent-os.bak")), "no backup litter inside the project");

    const again = cli(["init", "--no-plugin", "--global"], r5).stdout;
    ok(again.includes("SETUP  REPAIR") && again.includes("MISSING ~/.claude/settings.json git write protection"),
       "init on a set-up project reports a repair and names what is missing");
    ok(again.includes("kept .agent-os/"), "repair keeps the existing source instead of re-scaffolding");
    const us = JSON.parse(readFileSync(join(HOME, "settings.json"), "utf8"));
    ok(us.permissions.deny.includes("Bash(git commit *)") && us.env.CLAUDE_CODE_ENABLE_TODO_TOOLS === "1",
       "--global writes git protection and task tools to ~/.claude/settings.json");
    ok(readFileSync(join(HOME, "CLAUDE.md"), "utf8").includes("TaskCreate"), "--global adds the task rule to ~/.claude/CLAUDE.md");
    cli(["init", "--no-plugin", "--global"], r5);
    ok(JSON.parse(readFileSync(join(HOME, "settings.json"), "utf8")).permissions.deny.length === 42, "second --global run adds nothing");

    const cm = readFileSync(join(r5, "CLAUDE.md"), "utf8");
    ok(cm.includes("TaskCreate / TaskUpdate"), "task-tracking rule added to CLAUDE.md");
    ok(cm.indexOf("TaskCreate") > cm.indexOf("## Operator preferences") &&
       cm.indexOf("TaskCreate") < cm.indexOf("## Verification"),
       "rule lands inside Operator preferences, not at the end");
    ok(cm.includes("Never run git unasked."), "existing CLAUDE.md content preserved");

    // Idempotent: a second init must not duplicate either.
    cli(["init", "--no-plugin"], r5);
    const cm2 = readFileSync(join(r5, "CLAUDE.md"), "utf8");
    ok(cm2.split("TaskCreate").length - 1 === 1, "second init does not duplicate the rule");

    // A user who set the flag their own way keeps their value.
    const r6 = mkdtempSync(join(tmpdir(), "agent-os-cc2-"));
    mkdirSync(join(r6, ".claude"), { recursive: true });
    writeFileSync(join(r6, ".claude/settings.json"),
      JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: "true" } }, null, 2));
    cli(["init", "--no-plugin"], r6);
    ok(JSON.parse(readFileSync(join(r6, ".claude/settings.json"), "utf8"))
       .env.CLAUDE_CODE_ENABLE_TODO_TOOLS === "true", "an existing truthy value is left as the user set it");

    rmSync(r5, { recursive: true, force: true });
    rmSync(r6, { recursive: true, force: true });
  }

  console.log("\n  plugin hooks");
  {
    const r7 = mkdtempSync(join(tmpdir(), "agent-os-hooks-"));
    const mem = join(r7, ".claude/agent-memory/agent-os-feature-cartographer");
    mkdirSync(mem, { recursive: true });
    for (const f of ["billing", "orders", "search"]) mkdirSync(join(r7, "src/features", f), { recursive: true });
    writeFileSync(join(mem, "_architecture.md"), "# Architecture\n");
    writeFileSync(join(mem, "billing.md"), "---\nmapped: 2026-01-01\nentry: src/features/billing/index.ts\n---\n# billing\n");
    writeFileSync(join(mem, "MEMORY.md"), "- billing — src/features/billing — mapped 2026-01-01\n");
    mkdirSync(join(r7, ".agent-os/rules"), { recursive: true });
    writeFileSync(join(r7, ".agent-os/rules/api.md"), '---\npaths:\n  - "src/**"\n---\n\nSource body.\n');
    mkdirSync(join(r7, ".claude/rules"), { recursive: true });
    writeFileSync(join(r7, ".claude/rules/api.md"), "---\n---\n\n<!-- agent-os: generated from .agent-os/ — edit the source -->\nEdited in place.\n");
    const env = { ...process.env, CLAUDE_PROJECT_DIR: r7 };

    const start = node("hooks/session-resume.mjs", [], { cwd: r7, env }).stdout;
    ok(start.includes("agent-os is active") && start.includes("agent-os:feature-cartographer"), "session start announces the agents");
    ok(start.includes("Mapped: 1 of 3 features") && start.includes("billing"), "session start says what is mapped");

    const run = `selftest-${process.pid}-${Date.now()}`;
    const edit = (file, session = run) => node("hooks/pre-edit.mjs", [], {
      env, input: JSON.stringify({ session_id: session, cwd: r7, tool_input: { file_path: join(r7, file) } }),
    }).stdout;
    const denied = edit(".claude/rules/api.md");
    ok(denied.includes('"deny"') && denied.includes(".agent-os/rules/api.md"), "edit to a generated rule is blocked, source named");
    ok(edit("src/features/orders/a.ts").includes("no cartographer map"), "first edit to an unmapped feature reminds");
    ok(edit("src/features/orders/b.ts") === "", "reminder shows once per feature per session");
    ok(edit("src/features/billing/a.ts") === "", "mapped feature stays silent");
    ok(edit("src/lib/x.ts") === "", "non-feature path stays silent");

    mkdirSync(join(mem, ".claude/agent-memory"), { recursive: true });
    const audit = node("skills/init/scripts/audit.mjs", [r7]).stdout;
    ok(/api\.md was edited in place/.test(audit), "audit flags a generated rule that drifted from its source");
    ok(audit.includes("folder inside agent memory"), "audit flags a nested folder in agent memory");
    ok(audit.includes("1 of 3 (33%)"), "audit reports map coverage, not just that a folder exists");
    rmSync(r7, { recursive: true, force: true });
  }

  console.log("\n  merge, not overwrite");
  writeFileSync(join(root, "opencode.json"), JSON.stringify({ model: "anthropic/x", instructions: ["KEEP.md"] }, null, 2));
  cli(["sync"], root);
  const oc = JSON.parse(read("opencode.json"));
  ok(oc.model === "anthropic/x", "existing keys preserved");
  ok(oc.instructions.includes("KEEP.md"), "existing instructions preserved");
} finally { rmSync(root, { recursive: true, force: true }); }

console.log("\n  a Cursor-only init does not report Claude Code items");
const cu = mkdtempSync(join(tmpdir(), "agent-os-cursor-"));
try {
  mkdirSync(join(cu, ".agent-os"), { recursive: true });
  writeFileSync(join(cu, ".agent-os/config.json"), JSON.stringify({ targets: ["cursor"] }));
  const r = cli(["init", "--no-global"], cu);
  ok(r.status === 0, "init exits 0");
  ok(!r.stdout.includes("SETUP") && !r.stdout.includes("still to do") && !r.stdout.includes("CLAUDE.md"), "no Claude Code SETUP or to-do list");
  ok(/Result.*compiled for Cursor/.test(r.stdout) && r.stdout.includes("/agent-os-init"), "result names Cursor and the next step");
  ok(!existsSync(join(cu, ".claude/settings.json")), "nothing written for Claude Code");
  writeFileSync(join(cu, ".agent-os/config.json"), JSON.stringify({ targets: ["cursor"], cursor: { gitProtection: false } }));
  cli(["sync"], cu);
  ok(!JSON.parse(readFileSync(join(cu, ".cursor/hooks.json"), "utf8")).hooks.beforeShellExecution, "gitProtection: false removes the git hook");
} finally { rmSync(cu, { recursive: true, force: true }); }

console.log("\n  a Rulegate repository is left alone");
const rg = mkdtempSync(join(tmpdir(), "agent-os-rulegate-"));
try {
  mkdirSync(join(rg, ".rulegate/rules"), { recursive: true });
  writeFileSync(join(rg, "CLAUDE.md"), "<!-- Generated by Rulegate -->\n# Project\n");
  for (const cmd of ["init", "sync"]) {
    const r = cli([cmd, "--no-plugin", "--no-global"], rg);
    ok(r.status === 1 && /uses Rulegate/.test(r.stderr), `${cmd} refuses with .rulegate/ present`);
  }
  ok(!existsSync(join(rg, ".agent-os")) && !existsSync(join(rg, "AGENTS.md")), "nothing written");
} finally { rmSync(rg, { recursive: true, force: true }); rmSync(HOME, { recursive: true, force: true }); }

console.log(`\n${fail ? `FAILED (${fail})` : "PASSED"}\n`);
process.exit(fail ? 1 : 0);
