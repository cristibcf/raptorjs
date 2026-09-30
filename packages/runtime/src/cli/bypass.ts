/**
 * Detecting access that bypasses the capability broker.
 *
 * On the bootstrap engine, the broker is **advisory**: `import fs from
 * "node:fs"` reaches the disk without passing by it. Real isolation belongs to
 * the native host, where `node:*` simply does not exist.
 *
 * Until then, the rule lives here, in one place, so that `doctor` and `run` say
 * the same thing.
 *
 * **There are TWO kinds of problems, and we learned the second one the hard
 * way.** The first audit pass closed the visible bypass - a `node:fs` `import`
 * that the static graph sees. The second pass showed that the gate is trivially
 * bypassed:
 *
 * ```js
 * const name = ["node", "fs"].join(":");
 * const fs = await import(name);      // the graph sees no `node:`
 * ```
 *
 * The computed specifier does not appear in `hostImports`, so the application
 * ran under the `production` policy with an empty manifest and read anything.
 * `doctor` reported it (as an error!), `run` did not look at it.
 *
 * That is why the contract here is no longer "the list of bypasses", but "what I
 * **know** and what I **cannot know**". An import I cannot resolve is not proof
 * that everything is fine; it is the absence of proof, and in strict mode the
 * absence of proof is not enough.
 */
import { buildStaticGraph } from "@raptorstack/runtime";
import type { PolicyMode } from "@raptorstack/runtime";

export interface BypassFinding {
  /** The imported specifier, e.g. `node:fs`. */
  readonly specifier: string;
  /** The equivalent in the `raptor:` namespace, if there is one. */
  readonly replacement: string | null;
  readonly message: string;
}

/** Something we cannot check statically - so we cannot declare it in a rule either. */
export interface Unverifiable {
  readonly from: string;
  readonly what: string;
  readonly message: string;
}

export interface BypassReport {
  /** Proven bypasses: `node:` imports visible in the graph. */
  readonly bypasses: readonly BypassFinding[];
  /** Places where we cannot prove that NO bypass exists. */
  readonly unverifiable: readonly Unverifiable[];
  /** The graph could not be built at all; the message says why. */
  readonly graphError: string | null;
}

/**
 * Which `raptor:` module covers each builtin used in practice.
 *
 * The list is short and honest: we propose a replacement only where one actually
 * exists. For `node:worker_threads` we do not write `raptor:tasks`, because
 * `tasks` is not yet bound to the isolate in the native host.
 */
const REPLACEMENTS: Readonly<Record<string, string>> = {
  "node:fs": "raptor:files",
  "node:fs/promises": "raptor:files",
  "node:path": "raptor:files",
  "node:http": "raptor:serve",
  "node:https": "raptor:net",
  "node:net": "raptor:net",
  "node:child_process": "raptor:process",
  "node:process": "raptor:process",
  "node:os": "raptor:process",
};

/** `true` if the specifier reaches the system without passing through the broker. */
export function isBypass(specifier: string): boolean {
  return specifier.startsWith("node:");
}

export function describeBypass(specifier: string): BypassFinding {
  const replacement = REPLACEMENTS[specifier] ?? null;
  const suffix = replacement === null ? "" : `; use ${replacement}`;
  return {
    specifier,
    replacement,
    message: `${specifier} bypasses the capability broker and will not exist in the native host${suffix}`,
  };
}

/**
 * What is known about bypasses in the application's static graph.
 *
 * It does not swallow errors: if the graph cannot be built, that goes into the
 * report as `graphError`, and the caller decides. A `catch` that returned an
 * empty list said "I found nothing" when the truth was "I could not look".
 */
export async function inspectBypasses(projectRoot: string, entry: string): Promise<BypassReport> {
  try {
    const graph = await buildStaticGraph(projectRoot, entry);
    return {
      bypasses: graph.hostImports.filter(isBypass).map(describeBypass),
      unverifiable: graph.unresolved.map((problem) => ({
        from: problem.from,
        what: problem.specifier,
        message: `${problem.from}: ${problem.specifier} - ${problem.reason}`,
      })),
      graphError: null,
    };
  } catch (error) {
    return { bypasses: [], unverifiable: [], graphError: (error as Error).message };
  }
}

/**
 * What `run` does with what it found, depending on the policy.
 *
 * In `production` we reject both the proven bypass and the inability to verify:
 * the whole point of strict mode is that nothing passes undeclared, and an
 * import we cannot read is exactly an undeclared access that could succeed.
 * In `development` we go ahead, but say what we saw - otherwise porting would be
 * impossible before the native host is ready.
 */
export function bypassSeverity(policy: PolicyMode): "error" | "warn" {
  return policy === "production" ? "error" : "warn";
}

/** All the reasons the `production` policy would stop startup. */
export function blockingReasons(report: BypassReport): readonly string[] {
  const reasons = report.bypasses.map((bypass) => bypass.message);
  for (const item of report.unverifiable) {
    reasons.push(`${item.message} - I cannot prove it does not bypass the broker`);
  }
  if (report.graphError !== null) {
    reasons.push(`the static graph could not be built: ${report.graphError}`);
  }
  return reasons;
}
