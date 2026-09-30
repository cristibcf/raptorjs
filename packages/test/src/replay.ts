/**
 * RaptorReplay - the deterministic execution capsule (whitepaper §20). A bug
 * becomes an executable artifact (.raptorcap), not a description: it contains
 * everything needed to reproduce the same execution (action log, network
 * schedule, seed, build fingerprint, the failed oracle). Reproduction beats a
 * screenshot.
 */
import { type Capsule } from "./types.ts";

export function serializeCapsule(capsule: Capsule): string {
  return JSON.stringify(capsule, null, 2);
}

export function parseCapsule(text: string): Capsule {
  const c = JSON.parse(text) as Capsule;
  if (!Array.isArray(c.actionLog) || !c.networkSchedule) {
    throw new Error("[raptor-test] invalid capsule");
  }
  return c;
}
