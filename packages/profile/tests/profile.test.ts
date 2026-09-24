import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModule } from "@raptor/engine";
import { RaptorRuntime, type RouteDef } from "@raptor/run";
import {
  Profiler,
  runScenario,
  wireByteSize,
  planFromProfile,
  serializeProfile,
  runProfileCli,
  type Scenario,
} from "../src/index.ts";

const APP = `
component App {
  const count = state(0)
  const doubled = derived(() => count * 2)
  const price = serverSignal("BTC.price", schema.money)
  <div class="app">
    <span>{count}</span>
    <span data-d={doubled}>{doubled}</span>
    <span>{price}</span>
  </div>
}
component Admin {
  const users = serverSignal("admin.users", schema.uint)
  <div class="admin"><span>{users}</span></div>
}
`;

const ROUTES: RouteDef[] = [
  { path: "/", component: "App" },
  { path: "/admin", component: "Admin" },
];

function setup(): { result: ReturnType<typeof buildModule>; runtime: RaptorRuntime } {
  const result = buildModule(APP, "app.raptor");
  const runtime = RaptorRuntime.fromBuild(result, { routes: ROUTES });
  return { result, runtime };
}

test("wireByteSize: payload real dupa schema (money/uint mici)", () => {
  assert.ok(wireByteSize(60000, "money") > 0);
  assert.ok(wireByteSize(60000, "money") <= 5);
  assert.equal(wireByteSize(5, "uint"), 1);
});

test("profiler: colecteaza frecvente, payload, bursts si fan-out static", () => {
  const { result, runtime } = setup();
  const profiler = new Profiler(result.graph);
  const scenario: Scenario = {
    sessions: [
      [
        { visit: "/" },
        { visit: "/admin" },
        { produce: { address: "BTC.price", value: 60000 } },
        { produce: { address: "BTC.price", value: 61000 } },
      ],
      [{ visit: "/" }, { visit: "/admin" }, { produce: { address: "admin.users", value: 5 } }],
      [{ produceMany: [{ address: "BTC.price", value: 1 }, { address: "admin.users", value: 2 }] }],
    ],
  };
  runScenario(runtime, profiler, scenario);
  const profile = profiler.finish();

  assert.equal(profile.signalUpdateFrequency["BTC.price"], 3);
  assert.equal(profile.signalUpdateFrequency["admin.users"], 2);
  assert.equal(profile.routeFrequency["/"], 2);
  assert.equal(profile.routeFrequency["/admin"], 2);
  // Derived fan-out static: doubled are 2 consumatori (atribut + text).
  assert.equal(profile.derivedFanOut["App.doubled"], 2);
  // Payload wire real masurat.
  const btc = profile.wirePayload.find((w) => w.address === "BTC.price");
  assert.ok(btc && btc.samples === 3 && btc.totalBytes > 0);
  // Bursts DOM: produceMany a dat un batch de 2.
  assert.equal(profile.domBursts.maxBatch, 2);
  // Hot paths peste prag.
  assert.deepEqual(profile.hotSignals, ["BTC.price", "admin.users"]);
  assert.deepEqual(profile.hotRoutes, ["/", "/admin"]);
});

test("planner: co-usage -> chunk folding (behavior-guided, 23)", () => {
  const { result, runtime } = setup();
  const profiler = new Profiler(result.graph);
  runScenario(runtime, profiler, {
    sessions: [
      [{ visit: "/" }, { visit: "/admin" }],
      [{ visit: "/" }, { visit: "/admin" }],
    ],
  });
  const profile = profiler.finish();
  const plan = planFromProfile(profile, {
    routes: ROUTES,
    components: ["App", "Admin"],
    serverSignals: ["BTC.price", "admin.users"],
  });
  // "/" si "/admin" co-vizitate de 2 ori -> App+Admin fuzionate intr-un chunk.
  assert.deepEqual(plan.hints.foldChunks, [["Admin", "App"]]);
  assert.deepEqual(plan.hints.preloadRoutes, ["/", "/admin"]);
});

test("planner (24): ce nu e in profil e PASTRAT, nu eliminat", () => {
  const { result, runtime } = setup();
  const profiler = new Profiler(result.graph);
  // Scenariu care viziteaza doar "/" si produce doar BTC.price.
  runScenario(runtime, profiler, {
    sessions: [[{ visit: "/" }, { produce: { address: "BTC.price", value: 1 } }]],
  });
  const profile = profiler.finish();
  const plan = planFromProfile(profile, {
    routes: ROUTES,
    components: ["App", "Admin"],
    serverSignals: ["BTC.price", "admin.users"],
  });
  // admin.users si /admin nu au fost vazute -> raman explicit in output.
  assert.deepEqual(plan.keptDespiteUnseen, ["route:/admin", "signal:admin.users"]);
  assert.ok(plan.notes.some((n) => n.includes("nu elimin cod nevazut")));
});

test("build: aplica planHints (chunk folding + preload) fara a elimina componente", () => {
  const withHints = buildModule(APP, "app.raptor", {
    planHints: {
      foldChunks: [["App", "Admin"]],
      preloadRoutes: ["/"],
      batchSizes: { default: 2 },
      encodingSpecialization: ["BTC.price"],
    },
  });
  // Un singur chunk foldat cu ambele componente; nimic eliminat (24).
  assert.equal(withHints.chunks.length, 1);
  assert.deepEqual(withHints.chunks[0]!.components, ["App", "Admin"]);
  assert.equal(withHints.manifest.hintsApplied, true);
  assert.deepEqual(withHints.manifest.preload, ["/"]);
  // Corectitudine independenta de profil: ambele server signals raman.
  const addresses = withHints.wire.addresses.map((a) => a.logical);
  assert.ok(addresses.includes("BTC.price"));
  assert.ok(addresses.includes("admin.users"));
});

test("build: fara hints -> comportament default (niciun hint aplicat)", () => {
  const plain = buildModule(APP, "app.raptor");
  assert.equal(plain.manifest.hintsApplied, false);
  assert.deepEqual(plain.manifest.preload, []);
});

test("profile: serializare canonica reproductibila", () => {
  const { result, runtime } = setup();
  const p = new Profiler(result.graph);
  runScenario(runtime, p, { sessions: [[{ produce: { address: "BTC.price", value: 1 } }]] });
  const a = serializeProfile(p.finish());
  const p2 = new Profiler(result.graph);
  runScenario(runtime, p2, { sessions: [[{ produce: { address: "BTC.price", value: 1 } }]] });
  const b = serializeProfile(p2.finish());
  assert.equal(a, b);
});

test("cli: collect emite profil, plan aplica hints (in-memory fs)", () => {
  const files = new Map<string, string>([["app.raptor", APP]]);
  const io = {
    readFile: (p: string) => {
      const f = files.get(p);
      if (f === undefined) throw new Error(`no file ${p}`);
      return f;
    },
    writeFile: (p: string, d: string) => void files.set(p, d),
  };

  const collect = runProfileCli(["collect", "app.raptor", "--out", "app.profile"], io);
  assert.equal(collect.code, 0);
  assert.match(collect.out, /profil scris in app\.profile/);
  assert.ok(files.has("app.profile"));

  const plan = runProfileCli(["plan", "app.raptor", "--profile", "app.profile"], io);
  assert.equal(plan.code, 0);
  assert.match(plan.out, /RaptorProfile plan/);
  assert.match(plan.out, /encodingSpecialization: BTC\.price/);
});
