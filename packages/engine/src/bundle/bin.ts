#!/usr/bin/env node
/** RaptorBundle CLI entrypoint. Runs natively on Node (type-stripping). */
import { runBundleCli } from "./cli.ts";

const result = runBundleCli(process.argv.slice(2));
if (!result.ok) {
  console.error(result.message);
  process.exit(1);
}
if (result.message) console.log(result.message);
// For `dev`, the process stays alive through the already-started server (keepAlive).
