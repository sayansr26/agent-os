#!/usr/bin/env node
/** End-to-end: scaffold a throwaway project, compile all 8 targets, assert the
 *  output matches each tool's real schema, and prove drift is detected. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG = join(fileURLToPath(new URL(".", import.meta.url)), "..");
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
    ok(!i.stdout.includes("Claude Code plugin"), "--no-plugin skips the plugin install");

    // init offers the plugin when not told otherwise; --dry-run proves the
    // commands without running them against the machine's real config.
    const r4 = mkdtempSync(join(tmpdir(), "agent-os-plug-"));
    const pi = cli(["init", "--dry-run"], r4);
    ok(pi.stdout.includes("Claude Code plugin"), "init sets up the Claude Code plugin by default");
    ok(/marketplace add sayansr26\/agent-os|plugin marketplace add|not on PATH/.test(pi.stdout),
       "init names the marketplace step or says why it could not run it");
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

  console.log("\n  merge, not overwrite");
  writeFileSync(join(root, "opencode.json"), JSON.stringify({ model: "anthropic/x", instructions: ["KEEP.md"] }, null, 2));
  cli(["sync"], root);
  const oc = JSON.parse(read("opencode.json"));
  ok(oc.model === "anthropic/x", "existing keys preserved");
  ok(oc.instructions.includes("KEEP.md"), "existing instructions preserved");
} finally { rmSync(root, { recursive: true, force: true }); }

console.log(`\n${fail ? `FAILED (${fail})` : "PASSED"}\n`);
process.exit(fail ? 1 : 0);
