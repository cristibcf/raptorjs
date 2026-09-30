/**
 * End-to-end RaptorEngine demo (whitepaper section 35).
 * Run with: `node examples/raptorengine-app/src/demo.ts`
 *
 * Shows: multi-target build from a single graph, optimization trace, semantic
 * graph dump, reproducible manifest, and one cycle of Stateful Reactive HMR.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildModule,
  inspectGraph,
  formatOptimizationTrace,
  analyzeReport,
  DevEngine,
  formatUpdateLog,
} from "@raptorstack/engine";

const here = dirname(fileURLToPath(import.meta.url));
const appPath = join(here, "App.raptor");
const source = readFileSync(appPath, "utf8");

const result = buildModule(source, "App.raptor");

console.log("=== RaptorEngine build ===\n");
console.log(analyzeReport(result));

console.log("\n=== Optimization trace ===\n");
console.log(formatOptimizationTrace(result.optimization));

console.log("\n=== Semantic Application Graph ===\n");
console.log(inspectGraph(result.graph));

console.log("\n=== Browser output (generated) ===\n");
console.log(result.browser);

console.log("=== Server output (generated) ===\n");
console.log(result.server.code);

console.log("=== Wire manifest (RAS) ===\n");
console.log(JSON.stringify(result.wire, null, 2));

console.log("\n=== Build manifest (Appendix B) ===\n");
console.log(JSON.stringify(result.manifest, null, 2));

console.log("\n=== Stateful Reactive HMR ===\n");
const dev = new DevEngine();
dev.update("App.raptor", source);
// Local edit: change only a derived's expression (without touching structure).
const edited = source.replace("count * 2", "count * 3");
console.log(formatUpdateLog(dev.update("App.raptor", edited)));
console.log();
// Structural edit: add an element -> fall back to remount, with a reason.
const structural = source.replace(
  '<span class="price">price = {price}</span>',
  '<span class="price">price = {price}</span>\n    <hr />',
);
console.log(formatUpdateLog(dev.update("App.raptor", structural)));
