/**
 * Verificare REALA a integrarii Rolldown/Oxc (whitepaper RaptorEngine §2, §37).
 * Ruleaza din acest director (cwd = integrations/rolldown) dupa `npm install`:
 *   cd integrations/rolldown && npm install && npm run verify
 *
 * Dovedeste ca output-ul semantic al RaptorEngine e bundluit + minificat de
 * engine-ul low-level real, prin acelasi seam LowLevelEngine folosit in teste.
 */
import { buildModule, buildModuleAsync, createRolldownEngine, detectToolchain } from "../../packages/engine/src/index.ts";

const APP = `
component App {
  const count = state(0)
  const doubled = derived(() => count * 2)
  const price = serverSignal("BTC.price", schema.money)
  <div class="app">
    <button on:click={count++}>increment</button>
    <span data-d={doubled}>{doubled}</span>
    <span>{count} / {price}</span>
  </div>
}
`;

const tc = await detectToolchain();
console.log("toolchain detectat:", tc);
if (!tc.rolldown) {
  console.error("Rolldown neinstalat. Ruleaza `npm install rolldown oxc-minify` in integrations/rolldown.");
  process.exit(1);
}

const naive = buildModule(APP, "App.raptor");
const engine = await createRolldownEngine({ minify: true });
const real = await buildModuleAsync(APP, "App.raptor", { engine });

console.log("\nengine:", engine.name, engine.version);
console.log("toolchain in manifest:", real.manifest.toolchain);
console.log("bundle naiv    :", naive.bundleCode.length, "bytes");
console.log("bundle Rolldown:", real.bundleCode.length, "bytes (minified via Oxc)");
console.log("\n--- bundle Rolldown/Oxc ---\n" + real.bundleCode);
