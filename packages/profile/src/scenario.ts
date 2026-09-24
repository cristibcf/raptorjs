/**
 * Scenarii de profilare (whitepaper RaptorEngine 22, 23).
 *
 * Un scenariu determinist conduce runtime-ul prin vizite de routes si update-uri
 * de server signals, alimentand Profiler-ul. Modeleaza si "behavior-guided"
 * (23): fiecare sesiune = un flow reprezentativ; routes vizitate impreuna devin
 * co-usage. Determinist = reproductibil (fara timere, fara retea reala).
 */
import { Writer } from "@raptor/wire-codec";
import { SchemaCodec, type WireValue } from "@raptor/wire-core";
import type { RaptorRuntime } from "@raptor/run";
import type { Profiler } from "./collector.ts";

export type ScenarioStep =
  | { visit: string }
  | { produce: { address: string; value: WireValue } }
  | { produceMany: { address: string; value: WireValue }[] };

export interface Scenario {
  name?: string;
  /** Fiecare sesiune = un flow (secventa de pasi). */
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

/** Marimea reala a payload-ului wire pentru o valoare, dupa schema (22). */
export function wireByteSize(value: WireValue, schema: string | null): number {
  const w = new Writer();
  const codec = new SchemaCodec(
    schema && KNOWN_SCHEMA.has(schema) ? { v: { type: schema as never } } : {},
  );
  codec.encode(w, "v", value);
  return w.length;
}

/** Ruleaza un scenariu pe runtime, alimentand profiler-ul (determinist). */
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
