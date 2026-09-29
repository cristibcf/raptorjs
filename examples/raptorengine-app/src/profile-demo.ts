/**
 * Demo RaptorProfile (whitepaper RaptorEngine 22-24). Ruleaza cu:
 *   node examples/raptorengine-app/src/profile-demo.ts
 *
 * Arata bucla PGO completa: build -> ruleaza un scenariu pe runtime -> profil de
 * telemetrie -> plan de hints (strategie) -> rebuild profile-guided. Corectitudinea
 * NU depinde de profil (24): ce nu apare in profil ramane in output.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildModule } from "@raptor/engine";
import { RaptorRuntime } from "@raptor/engine/run";
import { Profiler, runScenario, planFromProfile, serializeProfile } from "@raptor/engine/profile";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "App.raptor"), "utf8");

const result = buildModule(source, "App.raptor");
const runtime = RaptorRuntime.fromBuild(result, { initial: { "BTC.price": 60000 } });

// Scenariu reprezentativ: cateva flow-uri care lovesc "/" si produc BTC.price.
const profiler = new Profiler(result.graph);
runScenario(runtime, profiler, {
  sessions: [
    [{ visit: "/" }, { produce: { address: "BTC.price", value: 60250 } }, { produce: { address: "BTC.price", value: 61000 } }],
    [{ visit: "/" }, { produce: { address: "BTC.price", value: 60875 } }],
  ],
});
const profile = profiler.finish();

console.log("=== Profil de telemetrie (raptor.profile) ===\n");
console.log(serializeProfile(profile));

const plan = planFromProfile(profile, {
  routes: [{ path: "/", component: "App" }],
  components: result.ir.components.map((c) => c.name),
  serverSignals: result.server.producers.map((p) => p.address),
});

console.log("\n=== Plan profile-guided (hints de STRATEGIE) ===\n");
console.log("preload:", plan.hints.preloadRoutes);
console.log("encodingSpecialization:", plan.hints.encodingSpecialization);
console.log("batchSizes:", plan.hints.batchSizes);
console.log("pastrate desi nevazute (24):", plan.keptDespiteUnseen);
console.log("\nnote:");
for (const n of plan.notes) console.log("  ·", n);

console.log("\n=== Rebuild profile-guided ===\n");
const guided = buildModule(source, "App.raptor", { planHints: plan.hints });
console.log("chunks:", guided.chunks.map((c) => c.name).join(", "));
console.log("manifest.preload:", guided.manifest.preload);
console.log("manifest.hintsApplied:", guided.manifest.hintsApplied);
console.log("wire addresses (pastrate):", guided.wire.addresses.map((a) => a.logical).join(", "));
