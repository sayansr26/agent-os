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
  writeFileSync(join(root, ".cursor/rules/api.mdc"), "hand edited\n");
  const d = cli(["check"], root);
  ok(d.status === 1, "check exits 1 on drift");
  ok(d.stdout.includes("DRIFTED"), "check names the drifted file");
  ok(cli(["sync"], root).status === 0 && cli(["check"], root).status === 0, "sync repairs drift");

  console.log("\n  merge, not overwrite");
  writeFileSync(join(root, "opencode.json"), JSON.stringify({ model: "anthropic/x", instructions: ["KEEP.md"] }, null, 2));
  cli(["sync"], root);
  const oc = JSON.parse(read("opencode.json"));
  ok(oc.model === "anthropic/x", "existing keys preserved");
  ok(oc.instructions.includes("KEEP.md"), "existing instructions preserved");
} finally { rmSync(root, { recursive: true, force: true }); }

console.log(`\n${fail ? `FAILED (${fail})` : "PASSED"}\n`);
process.exit(fail ? 1 : 0);
