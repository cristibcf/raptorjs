/**
 * RaptorReplay - capsula de executie deterministica (whitepaper §20). Un bug
 * devine un artefact executabil (.raptorcap), nu o descriere: contine tot ce
 * trebuie ca sa reproduca aceeasi executie (action log, network schedule, seed,
 * build fingerprint, oracle-ul esuat). Reproducerea bate screenshot-ul.
 */
import { type Capsule } from "./types.ts";

export function serializeCapsule(capsule: Capsule): string {
  return JSON.stringify(capsule, null, 2);
}

export function parseCapsule(text: string): Capsule {
  const c = JSON.parse(text) as Capsule;
  if (!Array.isArray(c.actionLog) || !c.networkSchedule) {
    throw new Error("[raptor-test] capsula invalida");
  }
  return c;
}
