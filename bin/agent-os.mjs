#!/usr/bin/env node
import { main } from "../src/cli.mjs";
main(process.argv.slice(2)).catch((e) => {
  console.error(`\nagent-os: ${e.message}\n`);
  process.exit(1);
});
