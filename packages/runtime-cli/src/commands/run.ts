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
import { describeUndeclared, loadPolicyFile, profileFor, writeAudit } from "../policy.ts";
import type { CommandInput, CommandResult } from "../shared.ts";
import { formatMs, fromError, ok, table } from "../shared.ts";

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
        ...(auditPath ? ([["audit", auditPath]] as const) : []),
      ]),
    ].join("\n");

    return { ...ok(out, { started: { ...started, namespace: undefined }, diagnostics, audit: auditPath }), host };
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
