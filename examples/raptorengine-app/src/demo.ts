/**
 * Demo RaptorEngine end-to-end (whitepaper sectiunea 35).
 * Ruleaza cu: `node examples/raptorengine-app/src/demo.ts`
 *
 * Arata: build multi-target dintr-un singur graf, trace de optimizare, dump de
 * graf semantic, manifest reproductibil si un ciclu de Stateful Reactive HMR.
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
} from "@raptor/engine";

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

console.log("\n=== Browser output (generat) ===\n");
console.log(result.browser);

console.log("=== Server output (generat) ===\n");
console.log(result.server.code);

console.log("=== Wire manifest (RAS) ===\n");
console.log(JSON.stringify(result.wire, null, 2));

console.log("\n=== Build manifest (Appendix B) ===\n");
console.log(JSON.stringify(result.manifest, null, 2));

console.log("\n=== Stateful Reactive HMR ===\n");
const dev = new DevEngine();
dev.update("App.raptor", source);
// Edit local: schimba doar expresia unui derived (fara a atinge structura).
const edited = source.replace("count * 2", "count * 3");
console.log(formatUpdateLog(dev.update("App.raptor", edited)));
console.log();
// Edit structural: adauga un element -> fallback la remount, cu motiv.
const structural = source.replace(
  '<span class="price">price = {price}</span>',
  '<span class="price">price = {price}</span>\n    <hr />',
);
console.log(formatUpdateLog(dev.update("App.raptor", structural)));
