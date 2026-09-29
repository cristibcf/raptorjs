#!/usr/bin/env node
/** Entrypoint CLI RaptorBundle. Ruleaza nativ pe Node (type-stripping). */
import { runBundleCli } from "./cli.ts";

const result = runBundleCli(process.argv.slice(2));
if (!result.ok) {
  console.error(result.message);
  process.exit(1);
}
if (result.message) console.log(result.message);
// Pentru `dev`, procesul ramane viu prin server-ul deja pornit (keepAlive).
