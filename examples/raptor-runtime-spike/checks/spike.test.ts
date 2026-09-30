/**
 * The spike's acceptance list, in the native RaptorRuntime format
 * (spec section 14). Run with `raptor-runtime test`.
 *
 * A test module exports `tests`: name -> function. Each case receives the host
 * context, so it runs under exactly the same capabilities as the application.
 * That is the whole point: if the test can do something the application cannot,
 * the test proves nothing about the application.
 */
import { readText } from "raptor:files";
import tasks from "raptor:tasks";
import type { HostContext } from "@raptorstack/runtime";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function expectDenied(body: () => Promise<unknown>, capability: string): Promise<{ code: string; target: string }> {
  try {
    await body();
  } catch (error) {
    const candidate = error as { code?: unknown; capability?: unknown; target?: unknown };
    assert(typeof candidate.code === "string", `error without a stable code: ${String(error)}`);
    assert(candidate.capability === capability, `expected capability '${capability}', got '${String(candidate.capability)}'`);
    return { code: String(candidate.code), target: String(candidate.target ?? "") };
  }
  throw new Error(`access to '${capability}' should have been denied, but it succeeded`);
}

export const tests = {
  /** (2) The TypeScript module evaluates and reports in a structured way. */
  async "the TypeScript module loads with no compile step"(context: HostContext): Promise<void> {
    const source = await readText("./src/main.ts");
    assert(source.includes("interface SpikeEvidence"), "the entry source was not read");
    assert(context.manifest.name === "raptor-runtime-spike", "the manifest did not reach the context");
  },

  /** (3) A read outside the declared scope fails with a clear error. */
  async "a read outside the project is denied"(): Promise<void> {
    const denial = await expectDenied(() => readText("../../package.json"), "files.read");
    assert(denial.code.startsWith("raptor:capability/"), `unexpected code: ${denial.code}`);
    assert(denial.target.length > 0, "the error does not say which target was denied");
  },

  /** (3) Granularity matters: a file inside the project, but undeclared, is denied. */
  async "an undeclared file inside the project is denied"(): Promise<void> {
    await expectDenied(() => readText("./raptor.policy.json"), "files.read");
  },

  /** (3) Undeclared capabilities are not enabled by accident. */
  async "the network and child processes are not available by default"(context: HostContext): Promise<void> {
    assert(!context.broker.check("net.connect", "example.com:443").granted, "net.connect should not be granted");
    assert(!context.broker.check("process.spawn", "git").granted, "process.spawn should not be granted");
    assert(!context.broker.check("env.read", "PATH").granted, "env.read should not be granted");
  },

  /** (3) Delegation is explicit: a sub-broker inherits nothing that was not requested. */
  async "delegation does not pass on unrequested capabilities"(context: HostContext): Promise<void> {
    const child = context.broker.delegate(["files.read"], "worker");
    assert(child.check("files.read", "./src/main.ts").granted, "the requested subset should have been kept");
    assert(!child.check("clock.real").granted, "clock.real was not requested, so it must not be inherited");
  },

  /** (4) Cancellation reaches the in-flight code, not just the scheduler. */
  async "a cancelled task stops and reports the cancellation"(): Promise<void> {
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
        return "should not have reached here";
      },
      { name: "cancellable", signal: controller.signal },
    );

    controller.abort();
    try {
      await started;
      throw new Error("the cancelled task should have thrown");
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      assert(code === "raptor:task/cancelled", `expected raptor:task/cancelled, got ${String(code)}`);
    }
  },

  /** (4) The deadline is enforced by the fabric, not left to the application. */
  async "a task that exceeds its deadline is stopped"(): Promise<void> {
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
      throw new Error("the task should have exceeded its deadline");
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      assert(code === "raptor:task/deadline", `expected raptor:task/deadline, got ${String(code)}`);
    }
  },

  /** Every capability decision reaches diagnostics (spec section 7). */
  async "capability decisions are recorded"(context: HostContext): Promise<void> {
    context.broker.check("net.connect", "audit.example.com:443");
    const usage = context.broker.diagnostics().usage;
    const entry = usage.find((item) => item.capability === "net.connect" && item.target === "audit.example.com:443");
    assert(entry !== undefined, "the check was not recorded in diagnostics");
    assert(entry!.granted === false, "the denial was not recorded as a denial");
  },
};
