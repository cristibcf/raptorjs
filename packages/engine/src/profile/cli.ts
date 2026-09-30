/**
 * CLI RaptorProfile (whitepaper RaptorEngine 5, Appendix A: `raptor profile`).
 *
 *   raptor-profile collect <file> [--scenario <json>] [--out <profile>]
 *   raptor-profile plan    <file> --profile <profile>
 *
 * `collect` runs a scenario and emits the profile artifact; `plan` shows which
 * hints the build would apply (without changing correctness, 24).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildModule } from "@raptorstack/engine";
import { RaptorRuntime, type RouteDef } from "@raptorstack/engine/run";
import { Profiler } from "./collector.ts";
import { runScenario, type Scenario } from "./scenario.ts";
import { serializeProfile, type RaptorProfile } from "./profile.ts";
import { planFromProfile } from "./planner.ts";

export interface ProfileCliIO {
  readFile: (p: string) => string;
  writeFile: (p: string, data: string) => void;
}

export interface ProfileCliResult {
  code: number;
  out: string;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Default scenario: exercises every server signal + visits "/" twice. */
function defaultScenario(addresses: readonly string[]): Scenario {
  const produces = addresses.map((address) => ({ produce: { address, value: 100 } }));
  return {
    name: "default",
    sessions: [
      [{ visit: "/" }, ...produces, ...produces],
      [{ visit: "/" }, ...produces],
    ],
  };
}

export function runProfileCli(
  argv: string[],
  io: ProfileCliIO = { readFile: (p) => readFileSync(p, "utf8"), writeFile: (p, d) => writeFileSync(p, d) },
): ProfileCliResult {
  const command = argv[0];
  const file = argv[1];

  if (!command || command === "--help") {
    return {
      code: 0,
      out: [
        "raptor-profile - RaptorProfile (whitepaper RaptorEngine 22-24)",
        "  raptor-profile collect <file> [--scenario <json>] [--out <profile>]",
        "  raptor-profile plan    <file> --profile <profile>",
      ].join("\n"),
    };
  }
  if (!file) return { code: 1, out: `error: ${command} requires <file.raptor>` };

  try {
    const result = buildModule(io.readFile(file), file);

    if (command === "collect") {
      const runtime = RaptorRuntime.fromBuild(result);
      const scenarioPath = flag(argv, "scenario");
      const scenario: Scenario = scenarioPath
        ? (JSON.parse(io.readFile(scenarioPath)) as Scenario)
        : defaultScenario(runtime.signalAddresses);
      const profiler = new Profiler(result.graph);
      runScenario(runtime, profiler, scenario);
      const profile = profiler.finish();
      const json = serializeProfile(profile);
      const out = flag(argv, "out");
      if (out) io.writeFile(out, json);
      return {
        code: 0,
        out: out ? `✓ profile written to ${out} (${profile.scenarios} sessions)\n\n${json}` : json,
      };
    }

    if (command === "plan") {
      const profilePath = flag(argv, "profile");
      if (!profilePath) return { code: 1, out: "error: plan requires --profile <profile>" };
      const profile = JSON.parse(io.readFile(profilePath)) as RaptorProfile;
      const routes: RouteDef[] = result.ir.components[0]
        ? [{ path: "/", component: result.ir.components[0].name }]
        : [];
      const plan = planFromProfile(profile, {
        routes,
        components: result.ir.components.map((c) => c.name),
        serverSignals: result.server.producers.map((p) => p.address),
      });
      return {
        code: 0,
        out: [
          `RaptorProfile plan - ${file}`,
          `  foldChunks: ${plan.hints.foldChunks.map((g) => g.join("+")).join(", ") || "(none)"}`,
          `  preload: ${plan.hints.preloadRoutes.join(", ") || "(none)"}`,
          `  batchSizes: ${JSON.stringify(plan.hints.batchSizes)}`,
          `  encodingSpecialization: ${plan.hints.encodingSpecialization.join(", ") || "(none)"}`,
          `  kept despite unseen (24): ${plan.keptDespiteUnseen.join(", ") || "(none)"}`,
          "",
          ...plan.notes.map((n) => `  · ${n}`),
        ].join("\n"),
      };
    }

    return { code: 1, out: `unknown command '${command}' (collect|plan)` };
  } catch (err) {
    return { code: 1, out: `error: ${(err as Error).message}` };
  }
}
