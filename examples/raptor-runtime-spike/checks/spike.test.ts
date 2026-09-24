/**
 * Lista de acceptanta a spike-ului, in formatul nativ RaptorRuntime
 * (spec sectiunea 14). Se ruleaza cu `raptor-runtime test`.
 *
 * Un modul de test exporta `tests`: nume -> functie. Fiecare caz primeste
 * contextul de host, deci ruleaza sub exact aceleasi capabilitati ca aplicatia.
 * Asta este si ideea: daca testul poate face ceva ce aplicatia nu poate, testul
 * nu demonstreaza nimic despre aplicatie.
 */
import { readText } from "raptor:files";
import tasks from "raptor:tasks";
import type { HostContext } from "@raptor/runtime";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function expectDenied(body: () => Promise<unknown>, capability: string): Promise<{ code: string; target: string }> {
  try {
    await body();
  } catch (error) {
    const candidate = error as { code?: unknown; capability?: unknown; target?: unknown };
    assert(typeof candidate.code === "string", `eroare fara cod stabil: ${String(error)}`);
    assert(candidate.capability === capability, `asteptam capability '${capability}', am primit '${String(candidate.capability)}'`);
    return { code: String(candidate.code), target: String(candidate.target ?? "") };
  }
  throw new Error(`accesul la '${capability}' ar fi trebuit refuzat, dar a reusit`);
}

export const tests = {
  /** (2) Modulul TypeScript se evalueaza si raporteaza structurat. */
  async "modulul TypeScript se incarca fara pas de compilare"(context: HostContext): Promise<void> {
    const source = await readText("./src/main.ts");
    assert(source.includes("interface SpikeEvidence"), "sursa de intrare nu a fost citita");
    assert(context.manifest.name === "raptor-runtime-spike", "manifestul nu a ajuns in context");
  },

  /** (3) Citirea in afara domeniului declarat esueaza cu eroare clara. */
  async "citirea in afara proiectului este refuzata"(): Promise<void> {
    const denial = await expectDenied(() => readText("../../package.json"), "files.read");
    assert(denial.code.startsWith("raptor:capability/"), `cod neasteptat: ${denial.code}`);
    assert(denial.target.length > 0, "eroarea nu spune ce tinta a fost refuzata");
  },

  /** (3) Granularitatea conteaza: un fisier din proiect, dar nedeclarat, e refuzat. */
  async "un fisier din proiect nedeclarat este refuzat"(): Promise<void> {
    await expectDenied(() => readText("./raptor.policy.json"), "files.read");
  },

  /** (3) Capabilitatile nedeclarate nu se activeaza accidental. */
  async "reteaua si procesele copil nu sunt disponibile implicit"(context: HostContext): Promise<void> {
    assert(!context.broker.check("net.connect", "example.com:443").granted, "net.connect nu ar trebui acordata");
    assert(!context.broker.check("process.spawn", "git").granted, "process.spawn nu ar trebui acordata");
    assert(!context.broker.check("env.read", "PATH").granted, "env.read nu ar trebui acordata");
  },

  /** (3) Delegarea este explicita: un sub-broker nu mosteneste nimic necerut. */
  async "delegarea nu transmite capabilitati necerute"(context: HostContext): Promise<void> {
    const child = context.broker.delegate(["files.read"], "worker");
    assert(child.check("files.read", "./src/main.ts").granted, "subsetul cerut ar fi trebuit pastrat");
    assert(!child.check("clock.real").granted, "clock.real nu a fost ceruta, deci nu trebuie mostenita");
  },

  /** (4) Anularea ajunge la codul in zbor, nu doar la planificator. */
  async "un task anulat se opreste si raporteaza anularea"(): Promise<void> {
    const controller = new AbortController();
    const started = tasks.spawn(
      async (task) => {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5_000);
          task.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        task.throwIfCancelled();
        return "nu ar fi trebuit sa ajunga aici";
      },
      { name: "cancellable", signal: controller.signal },
    );

    controller.abort();
    try {
      await started;
      throw new Error("task-ul anulat ar fi trebuit sa arunce");
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      assert(code === "raptor:task/cancelled", `asteptam raptor:task/cancelled, am primit ${String(code)}`);
    }
  },

  /** (4) Deadline-ul este aplicat de fabric, nu lasat pe seama aplicatiei. */
  async "un task care depaseste deadline-ul este oprit"(): Promise<void> {
    try {
      await tasks.spawn(
        async (task) => {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 5_000);
            task.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              resolve();
            });
          });
          task.throwIfCancelled();
        },
        { name: "slow", deadlineMs: 20 },
      );
      throw new Error("task-ul ar fi trebuit sa depaseasca deadline-ul");
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      assert(code === "raptor:task/deadline", `asteptam raptor:task/deadline, am primit ${String(code)}`);
    }
  },

  /** Fiecare decizie de capability ajunge in diagnostic (spec sectiunea 7). */
  async "deciziile de capability sunt inregistrate"(context: HostContext): Promise<void> {
    context.broker.check("net.connect", "audit.example.com:443");
    const usage = context.broker.diagnostics().usage;
    const entry = usage.find((item) => item.capability === "net.connect" && item.target === "audit.example.com:443");
    assert(entry !== undefined, "verificarea nu a fost inregistrata in diagnostic");
    assert(entry!.granted === false, "refuzul nu a fost inregistrat ca refuz");
  },
};
