#!/usr/bin/env node
/** RaptorBundle CLI entrypoint. Runs natively on Node (type-stripping). */
import { runBundleCli } from "./cli.ts";

const argv = process.argv.slice(2);

// `build --prerender` needs an async path (it dynamically imports the app's
// routes + prerender); everything else stays synchronous.
if (argv[0] === "build" && argv.includes("--prerender")) {
  const { runPrerenderBuild } = await import("./prerender-cli.ts");
  const result = await runPrerenderBuild(argv);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  if (result.message) console.log(result.message);
} else {
  const result = runBundleCli(argv);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  if (result.message) console.log(result.message);
  // For `dev`, the process stays alive through the already-started server (keepAlive).
}
