/**
 * Spike-ul de arhitectura RaptorRuntime (spec sectiunea 14).
 *
 * Nu este un runtime de productie si nu incearca sa fie: demonstreaza cele
 * cinci comportamente din lista de acceptanta, fiecare cu dovada verificabila.
 *
 *   1. lansare autonoma        - binarul porneste si evalueaza acest modul
 *   2. modul TypeScript        - tipurile de mai jos nu au pas de compilare separat
 *   3. refuz de permisiune     - o citire in afara domeniului declarat esueaza clar
 *   4. oprire curata           - task-urile in zbor sunt anulate si drenate
 *   5. teste de contract       - ./checks/spike.test.ts si ../tests/spike.test.ts
 */
import { readText } from "raptor:files";
import observe from "raptor:observe";
import { requestExit } from "raptor:process";
import tasks from "raptor:tasks";
import type { HostContext } from "@raptor/runtime";

/** Tipuri reale, sterse la incarcare - asta este verificarea "modul TypeScript". */
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

  // (2) Modulul isi citeste propria sursa: acces permis, in domeniul declarat.
  const source = await readText("./src/main.ts");
  evidence.push({
    check: "typescript-module",
    passed: source.includes("interface SpikeEvidence"),
    detail: `modulul de intrare s-a evaluat si si-a citit sursa (${source.length} octeti)`,
  });

  // (3) Acelasi API, tinta in afara domeniului declarat: trebuie sa fie refuzat.
  let denial: CapabilityFailure | null = null;
  try {
    await readText("../../package.json");
    evidence.push({ check: "permission-denial", passed: false, detail: "citirea in afara proiectului a reusit - regresie de securitate" });
  } catch (error) {
    denial = failureOf(error);
    evidence.push({
      check: "permission-denial",
      passed: denial !== null && denial.capability === "files.read",
      detail: denial ? `${denial.code} pentru ${denial.target}` : `eroare neasteptata: ${String(error)}`,
    });
  }

  // (4) Lucru in zbor la momentul opririi: un task lung, pe care shutdown-ul il anuleaza.
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
        return "nu ar fi trebuit sa ajunga aici";
      },
      { name: "lingering" },
    )
    .then(
      () => undefined,
      (error: unknown) => {
        cancellationObserved = failureOf(error)?.code === "raptor:task/cancelled" || String(error).includes("anulat");
      },
    );

  // Un task care esueaza: oprirea trebuie sa ramana curata si dupa o eroare.
  await tasks
    .spawn(
      () => {
        throw new Error("esec deliberat, pentru a verifica oprirea dupa eroare");
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

  // Nu asteptam `lingering`: ramane in zbor intentionat, ca `shutdown` sa aiba
  // ce anula. Il legam de telemetrie ca dovada sa apara in urma de executie.
  void lingering.then(() => {
    observe.log("info", "spike.lingeringSettled", { cancelled: cancellationObserved });
  });

  observe.metric("spike.checksPassed", evidence.filter((item) => item.passed).length, { total: evidence.length });

  // Verificarea (4): cerem oprirea in timp ce `lingering` este inca in zbor.
  // Runtime-ul trebuie sa o anuleze si sa dreneze, fara sa omoare procesul.
  requestExit(0);
}
