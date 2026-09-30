/**
 * `raptor-runtime run` (spec section 4): transpiles TypeScript in memory, loads
 * the modules and applies the permissions.
 *
 * Clean shutdown is part of the contract: on SIGINT/SIGTERM the in-flight tasks
 * are cancelled, the fabric is drained and only then does it exit - never a
 * brutal `exit` in the middle of the work.
 */
import { createObserver, createRuntime, loadProject } from "@raptor/runtime";
import type { RaptorRuntimeHost, RuntimeEvent } from "@raptor/runtime";
import { blockingReasons, bypassSeverity, inspectBypasses } from "../bypass.ts";
import { describeUndeclared, loadPolicyFile, profileFor, writeAudit } from "../policy.ts";
import type { CommandInput, CommandResult } from "../shared.ts";
import { fail, formatMs, fromError, ok, table } from "../shared.ts";

export interface RunOptions {
  /** If the application keeps the process busy, `run` waits for the shutdown signals. */
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

    // What bypasses the broker is checked BEFORE startup, with the same rule
    // that `doctor` uses. The report also says what could NOT be verified - an
    // `import()` with a computed specifier does not appear in the graph, so its
    // absence from there proves nothing.
    const report = await inspectBypasses(project.projectRoot, manifest.entry);
    const severity = bypassSeverity(mode);

    // Everything we found enters the observer, in both policies, so it also
    // reaches the log wherever the policy requires one. Otherwise the log would
    // show only the access denied at the gate, not the one that could have
    // slipped past it - and whoever reads it would draw exactly the wrong conclusion.
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
          reason: "direct builtin import: does not go through the capability broker",
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
          reason: "cannot be resolved statically: a bypass here would not be visible",
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
            `${manifest.name}@${manifest.version} did not start: under the production policy nothing may`,
            "bypass the capability broker, and nothing may be unverifiable.",
            "",
            ...blocking.map((reason) => `  ${reason}`),
            "",
            "Run with --policy development while porting, or replace the imports with the raptor: modules.",
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
      `${manifest.name}@${manifest.version} ran (policy ${mode}${undeclared.strict ? ", strict" : ""})`,
      table([
        ["startup", formatMs(started.startupMs)],
        ["evaluation", formatMs(started.evaluationMs)],
        ["tasks", `${diagnostics.tasks.completed} completed, ${diagnostics.tasks.failed} failed, ${diagnostics.tasks.cancelled} cancelled`],
        ["modules", String(diagnostics.modules.length)],
        ["denied capabilities", String(denied.length)],
        // The number of denials is misleading on its own: a direct builtin
        // import reaches the system without being counted anywhere. If there is
        // one, it shows next to the denials, not just in `doctor`.
        ...(report.bypasses.length > 0
          ? ([["bypass the broker", report.bypasses.map((b) => b.specifier).join(", ")]] as const)
          : []),
        ...(report.unverifiable.length > 0
          ? ([["unverifiable", report.unverifiable.map((u) => u.what).join(", ")]] as const)
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
 * Waits for either a shutdown signal or the exhaustion of the application's work.
 *
 * An application that opens a server must stay alive until SIGINT/SIGTERM; one
 * that finishes its work must exit on its own. `beforeExit` distinguishes
 * exactly between the two cases: it is emitted only when there is no more
 * scheduled work. In both situations shutdown goes through `shutdown`, so the
 * in-flight tasks are cancelled and drained before exit.
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
    // The application can request its own shutdown; then we no longer wait for signals.
    void host.whenStopped().then(() => {
      detach();
      resolve();
    });
  });
}
