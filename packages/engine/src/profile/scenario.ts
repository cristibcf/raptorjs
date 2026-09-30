/**
 * Profiling scenarios (whitepaper RaptorEngine 22, 23).
 *
 * A deterministic scenario drives the runtime through route visits and server
 * signal updates, feeding the Profiler. It also models "behavior-guided"
 * (23): each session = a representative flow; routes visited together become
 * co-usage. Deterministic = reproducible (no timers, no real network).
 */
import { Writer } from "@raptor/wire/codec";
import { SchemaCodec, type WireValue } from "@raptor/wire";
import type { RaptorRuntime } from "@raptor/engine/run";
import type { Profiler } from "./collector.ts";

export type ScenarioStep =
  | { visit: string }
  | { produce: { address: string; value: WireValue } }
  | { produceMany: { address: string; value: WireValue }[] };

export interface Scenario {
  name?: string;
  /** Each session = a flow (sequence of steps). */
  sessions: ScenarioStep[][];
}

const KNOWN_SCHEMA = new Set([
  "bool",
  "uint",
  "int",
  "percentage",
  "money",
  "enum",
  "float",
  "string",
]);

/** Real wire payload size for a value, per schema (22). */
export function wireByteSize(value: WireValue, schema: string | null): number {
  const w = new Writer();
  const codec = new SchemaCodec(
    schema && KNOWN_SCHEMA.has(schema) ? { v: { type: schema as never } } : {},
  );
  codec.encode(w, "v", value);
  return w.length;
}

/** Runs a scenario on the runtime, feeding the profiler (deterministic). */
export function runScenario(runtime: RaptorRuntime, profiler: Profiler, scenario: Scenario): void {
  for (const session of scenario.sessions) {
    profiler.beginSession();
    for (const step of session) {
      if ("visit" in step) {
        runtime.handleRequest("GET", step.visit);
        profiler.recordRoute(step.visit);
      } else if ("produce" in step) {
        const { address, value } = step.produce;
        runtime.produce(address, value);
        profiler.recordSignalUpdate(address, wireByteSize(value, runtime.schemaFor(address)));
        profiler.recordBurst(1);
      } else {
        const updates = step.produceMany;
        runtime.produceMany(updates);
        for (const u of updates) {
          profiler.recordSignalUpdate(u.address, wireByteSize(u.value, runtime.schemaFor(u.address)));
        }
        profiler.recordBurst(updates.length);
      }
    }
    profiler.endSession();
  }
}
