/**
 * `raptor-runtime run` (spec sectiunea 4): transpileaza TypeScript in memorie,
 * incarca modulele si aplica permisiunile.
 *
 * Oprirea curata este parte din contract: la SIGINT/SIGTERM se anuleaza task-urile
 * in zbor, se dreneaza fabricul si abia apoi se iese - niciodata `exit` brutal
 * in mijlocul lucrului.
 */
import { createObserver, createRuntime, loadProject } from "@raptor/runtime";
import type { RaptorRuntimeHost, RuntimeEvent } from "@raptor/runtime";
import { blockingReasons, bypassSeverity, inspectBypasses } from "../bypass.ts";
import { describeUndeclared, loadPolicyFile, profileFor, writeAudit } from "../policy.ts";
import type { CommandInput, CommandResult } from "../shared.ts";
import { fail, formatMs, fromError, ok, table } from "../shared.ts";

export interface RunOptions {
  /** Daca aplicatia tine procesul ocupat, `run` asteapta semnalele de oprire. */
  readonly waitForSignals?: boolean;
  readonly onEvent?: (event: RuntimeEvent) => void;
}

export interface RunOutcome extends CommandResult {
  readonly host: RaptorRuntimeHost | null;
}

export async function runCommand(input: CommandInput, options: RunOptions = {}): Promise<RunOutcome> {
  let host: RaptorRuntimeHost | null = null;
  try {
    const project = await loadProject(input.cwd);
    const mode = input.policyOverride ?? project.manifest.policy;
    const policy = await loadPolicyFile(project.projectRoot);
    const profile = profileFor(policy, mode);
    const undeclared = describeUndeclared(profile, input.interactive);

    const observer = createObserver(options.onEvent ? { sink: options.onEvent } : {});
    const manifest = mode === project.manifest.policy ? project.manifest : { ...project.manifest, policy: mode };

    // Ce ocoleste brokerul se verifica INAINTE de pornire, cu aceeasi regula pe
    // care o foloseste `doctor`. Raportul spune si ce NU a putut fi verificat -
    // un `import()` cu specificator calculat nu apare in graf, deci absenta lui
    // de acolo nu dovedeste nimic.
    const report = await inspectBypasses(project.projectRoot, manifest.entry);
    const severity = bypassSeverity(mode);

    // Tot ce am aflat intra in observer, in ambele politici, deci ajunge si in
    // jurnal oriunde politica cere unul. Altfel jurnalul ar arata doar accesul
    // refuzat la poarta, nu si pe cel care ar fi putut trece pe langa ea - iar
    // cine il citeste ar trage exact concluzia gresita.
    for (const bypass of report.bypasses) {
      observer.record({
        at: 0,
        kind: "capability",
        name: "bypass",
        severity: severity === "error" ? "error" : "warn",
        attributes: {
          specifier: bypass.specifier,
          replacement: bypass.replacement,
          granted: true,
          reason: "import direct de builtin: nu trece prin capability broker",
          policy: mode,
        },
      });
    }
    for (const item of report.unverifiable) {
      observer.record({
        at: 0,
        kind: "capability",
        name: "unverifiable",
        severity: severity === "error" ? "error" : "warn",
        attributes: {
          from: item.from,
          what: item.what,
          granted: true,
          reason: "nu poate fi rezolvat static: un ocol aici nu ar fi vizibil",
          policy: mode,
        },
      });
    }

    const blocking = blockingReasons(report);
    if (severity === "error" && blocking.length > 0) {
      const auditPath = await writeAudit(observer, project.projectRoot, profile.auditLog);
      return {
        ...fail(
          1,
          [
            `${manifest.name}@${manifest.version} nu a pornit: in politica production nimic nu are voie sa`,
            "ocoleasca capability broker-ul, si nimic nu are voie sa fie neverificabil.",
            "",
            ...blocking.map((reason) => `  ${reason}`),
            "",
            "Ruleaza cu --policy development cat timp portezi, sau inlocuieste importurile cu modulele raptor:.",
          ].join("\n"),
          {
            bypasses: report.bypasses.map((bypass) => ({ ...bypass })),
            unverifiable: report.unverifiable.map((item) => ({ ...item })),
            graphError: report.graphError,
            audit: auditPath,
          },
        ),
        host: null,
      };
    }

    host = createRuntime({
      projectRoot: project.projectRoot,
      manifest,
      args: input.appArgs,
      observer,
      strict: undeclared.strict,
    });

    const started = await host.start();

    if (options.waitForSignals) await waitForShutdown(host);
    else await host.shutdown("run-complete");

    const auditPath = await writeAudit(observer, project.projectRoot, profile.auditLog);
    const diagnostics = host.diagnostics();

    const denied = diagnostics.capabilities.usage.filter((usage) => !usage.granted);
    const out = [
      `${manifest.name}@${manifest.version} a rulat (politica ${mode}${undeclared.strict ? ", strict" : ""})`,
      table([
        ["pornire", formatMs(started.startupMs)],
        ["evaluare", formatMs(started.evaluationMs)],
        ["task-uri", `${diagnostics.tasks.completed} terminate, ${diagnostics.tasks.failed} esuate, ${diagnostics.tasks.cancelled} anulate`],
        ["module", String(diagnostics.modules.length)],
        ["capabilitati refuzate", String(denied.length)],
        // Numarul de refuzuri induce in eroare singur: un import direct de
        // builtin ajunge la sistem fara sa fie numarat nicaieri. Daca exista
        // unul, se vede langa refuzuri, nu doar in `doctor`.
        ...(report.bypasses.length > 0
          ? ([["ocolesc brokerul", report.bypasses.map((b) => b.specifier).join(", ")]] as const)
          : []),
        ...(report.unverifiable.length > 0
          ? ([["neverificabil", report.unverifiable.map((u) => u.what).join(", ")]] as const)
          : []),
        ...(auditPath ? ([["audit", auditPath]] as const) : []),
      ]),
    ].join("\n");

    return {
      ...ok(out, {
        started: { ...started, namespace: undefined },
        diagnostics,
        audit: auditPath,
        bypasses: report.bypasses.map((bypass) => ({ ...bypass })),
        unverifiable: report.unverifiable.map((item) => ({ ...item })),
      }),
      host,
    };
  } catch (error) {
    if (host) await host.shutdown("error").catch(() => undefined);
    const result = fromError(error);
    return {
      ...result,
      data: { ...result.data, diagnostics: host ? host.diagnostics() : null },
      host,
    };
  }
}

/**
 * Asteapta fie un semnal de oprire, fie epuizarea lucrului aplicatiei.
 *
 * O aplicatie care deschide un server trebuie sa ramana in viata pana la
 * SIGINT/SIGTERM; una care isi termina treaba trebuie sa iasa singura. `beforeExit`
 * distinge exact intre cele doua cazuri: se emite doar cand nu mai exista lucru
 * programat. In ambele situatii oprirea trece prin `shutdown`, deci task-urile
 * in zbor sunt anulate si drenate inainte de iesire.
 */
async function waitForShutdown(host: RaptorRuntimeHost): Promise<void> {
  await new Promise<void>((resolve) => {
    const detach = (): void => {
      process.off("SIGINT", onInt);
      process.off("SIGTERM", onTerm);
      process.off("beforeExit", onIdle);
    };
    const stop = (reason: string): void => {
      detach();
      void host.shutdown(reason).then(resolve, () => resolve());
    };
    const onInt = (): void => stop("SIGINT");
    const onTerm = (): void => stop("SIGTERM");
    const onIdle = (): void => stop("idle");
    process.on("SIGINT", onInt);
    process.on("SIGTERM", onTerm);
    process.on("beforeExit", onIdle);
    // Aplicatia isi poate cere singura oprirea; atunci nu mai asteptam semnale.
    void host.whenStopped().then(() => {
      detach();
      resolve();
    });
  });
}
