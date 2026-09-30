/**
 * The RaptorRuntime architecture spike (spec section 14).
 *
 * It is not a production runtime and does not try to be: it demonstrates the
 * five behaviors from the acceptance list, each with verifiable evidence.
 *
 *   1. autonomous launch       - the binary starts and evaluates this module
 *   2. TypeScript module       - the types below have no separate compile step
 *   3. permission denial       - a read outside the declared scope fails clearly
 *   4. clean shutdown          - in-flight tasks are cancelled and drained
 *   5. contract tests          - ./checks/spike.test.ts and ../tests/spike.test.ts
 */
import { readText } from "raptor:files";
import observe from "raptor:observe";
import { requestExit } from "raptor:process";
import tasks from "raptor:tasks";
import type { HostContext } from "@raptorstack/runtime";

/** Real types, erased at load time - this is the "TypeScript module" check. */
interface SpikeEvidence {
  readonly check: string;
  readonly passed: boolean;
  readonly detail: string;
}

type CapabilityFailure = { readonly code: string; readonly capability: string; readonly target: string };

function failureOf(error: unknown): CapabilityFailure | null {
  const candidate = error as { code?: unknown; capability?: unknown; target?: unknown };
  if (typeof candidate?.code !== "string" || typeof candidate.capability !== "string") return null;
  return { code: candidate.code, capability: candidate.capability, target: String(candidate.target ?? "") };
}

export default async function main(context: HostContext): Promise<void> {
  const evidence: SpikeEvidence[] = [];

  // (2) The module reads its own source: access allowed, within the declared scope.
  const source = await readText("./src/main.ts");
  evidence.push({
    check: "typescript-module",
    passed: source.includes("interface SpikeEvidence"),
    detail: `the entry module evaluated and read its own source (${source.length} bytes)`,
  });

  // (3) The same API, target outside the declared scope: must be denied.
  let denial: CapabilityFailure | null = null;
  try {
    await readText("../../package.json");
    evidence.push({ check: "permission-denial", passed: false, detail: "the read outside the project succeeded - a security regression" });
  } catch (error) {
    denial = failureOf(error);
    evidence.push({
      check: "permission-denial",
      passed: denial !== null && denial.capability === "files.read",
      detail: denial ? `${denial.code} for ${denial.target}` : `unexpected error: ${String(error)}`,
    });
  }

  // (4) In-flight work at shutdown time: a long task that the shutdown cancels.
  let cancellationObserved = false;
  const lingering = tasks
    .spawn(
      async (task) => {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 60_000);
          task.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        task.throwIfCancelled();
        return "should not have reached here";
      },
      { name: "lingering" },
    )
    .then(
      () => undefined,
      (error: unknown) => {
        cancellationObserved = failureOf(error)?.code === "raptor:task/cancelled" || String(error).includes("cancelled");
      },
    );

  // A failing task: shutdown must stay clean even after an error.
  await tasks
    .spawn(
      () => {
        throw new Error("deliberate failure, to verify shutdown after an error");
      },
      { name: "deliberate-failure" },
    )
    .catch(() => undefined);

  context.observer.log("info", "spike.evidence", {
    project: context.manifest.name,
    policy: context.manifest.policy,
    strict: context.broker.strict,
    checks: evidence,
    denial,
  });

  // We do not await `lingering`: it stays in flight on purpose, so `shutdown`
  // has something to cancel. We hook it to telemetry so the evidence shows up
  // in the execution trace.
  void lingering.then(() => {
    observe.log("info", "spike.lingeringSettled", { cancelled: cancellationObserved });
  });

  observe.metric("spike.checksPassed", evidence.filter((item) => item.passed).length, { total: evidence.length });

  // Check (4): we request shutdown while `lingering` is still in flight.
  // The runtime must cancel and drain it, without killing the process.
  requestExit(0);
}
