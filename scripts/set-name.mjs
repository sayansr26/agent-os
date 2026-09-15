#!/usr/bin/env node
/**
 * Set the published package name everywhere it appears, in one pass.
 *
 * npm rejects an unscoped `agent-os` because it normalizes to `agentos`, which
 * is taken. A scope avoids that check entirely, but the scope has to be your
 * npm username or an org you belong to — publishing to someone else's scope
 * fails with a 404, not a permissions error.
 *
 *   node scripts/set-name.mjs @$(npm whoami)/agent-os
 *   node scripts/set-name.mjs agent-os-cli        # unscoped alternative
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const next = process.argv[2];
if (!next) {
  console.error("usage: node scripts/set-name.mjs <package-name>");
  process.exit(1);
}
if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(next)) {
  console.error(`not a valid npm package name: ${next}`);
  process.exit(1);
}

const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const prev = pkg.name;
if (prev === next) {
  console.log(`already ${next}`);
  process.exit(0);
}

pkg.name = next;
// Scoped packages default to restricted; without this a publish either creates
// a private package or fails outright on a free account.
if (next.startsWith("@")) pkg.publishConfig = { access: "public" };
else delete pkg.publishConfig;

// Rewrite in a stable key order so the diff is the name, not the whole file.
const ORDER = ["name","version","description","keywords","homepage","repository","license",
               "author","type","engines","bin","files","publishConfig","scripts"];
const ordered = {};
for (const k of ORDER) if (k in pkg) ordered[k] = pkg[k];
for (const k of Object.keys(pkg)) if (!(k in ordered)) ordered[k] = pkg[k];
writeFileSync(pkgPath, JSON.stringify(ordered, null, 2) + "\n");

// Every file that names the package for a user to type or a badge to fetch.
const enc = (s) => encodeURIComponent(s);
const files = ["README.md", "CHANGELOG.md", "src/cli.mjs", "src/source.mjs"];
let touched = 0;
for (const f of files) {
  const before = readFileSync(f, "utf8");
  const after = before
    .split(`npx ${prev}`).join(`npx ${next}`)
    .split(`npm i -g ${prev}`).join(`npm i -g ${next}`)
    .split(`npmjs.com/package/${prev}`).join(`npmjs.com/package/${next}`)
    .split(`npm/v/${enc(prev)}.svg`).join(`npm/v/${enc(next)}.svg`);
  if (after !== before) { writeFileSync(f, after); touched++; }
}

console.log(`${prev} -> ${next}  (package.json + ${touched} file(s))`);
const left = execSync(
  `grep -rn --exclude-dir=.git --exclude-dir=node_modules -F ${JSON.stringify(prev)} . || true`,
  { encoding: "utf8" },
).trim();
if (left) {
  console.log(`\nStill mentioning ${prev} — check whether these should change too:\n`);
  console.log(left);
}
