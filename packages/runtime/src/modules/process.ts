/**
 * `raptor:process` (spec sectiunea 6): argumente, mediu si procese copil
 * controlate. Fara acces nerestrictionat la host: `env` si `spawn` trec prin
 * broker, iar `exit` merge prin oprirea curata a runtime-ului.
 */
import { spawn as spawnChild } from "node:child_process";
import type { HostContext } from "../context.ts";
import { RaptorError } from "../errors.ts";

export interface SpawnResult {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SpawnChildOptions {
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly input?: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface RaptorProcess {
  readonly args: readonly string[];
  readonly platform: string;
  readonly pid: number;
  env(name: string): string | undefined;
  /** Doar variabilele acoperite de `env.read`; restul nu sunt nici listate. */
  envKeys(): readonly string[];
  spawn(command: string, options?: SpawnChildOptions): Promise<SpawnResult>;
  /** Cere oprirea curata; nu omoara procesul pe loc. */
  requestExit(code?: number): void;
  onExitRequest(listener: (code: number) => void): void;
}

export function createProcess(host: HostContext, source: NodeJS.ProcessEnv = process.env): RaptorProcess {
  const listeners: Array<(code: number) => void> = [];

  return {
    args: [...host.args],
    platform: process.platform,
    pid: process.pid,

    env(name: string): string | undefined {
      host.broker.require("env.read", name);
      return source[name];
    },

    envKeys(): readonly string[] {
      return Object.keys(source)
        .filter((key) => host.broker.check("env.read", key).granted)
        .sort();
    },

    async spawn(command: string, options: SpawnChildOptions = {}): Promise<SpawnResult> {
      host.broker.require("process.spawn", command);
      const span = host.observer.startSpan("process.spawn", { command, args: options.args ?? [] });

      // Mediul copilului contine doar variabilele pe care aplicatia le poate citi.
      const childEnv: Record<string, string> = {};
      for (const key of this.envKeys()) {
        const value = source[key];
        if (value !== undefined) childEnv[key] = value;
      }
      Object.assign(childEnv, options.env ?? {});

      return await host.tasks.spawn<SpawnResult>(
        (context) =>
          new Promise<SpawnResult>((resolve, reject) => {
            const child = spawnChild(command, [...(options.args ?? [])], {
              cwd: options.cwd ?? host.projectRoot,
              env: childEnv,
              shell: false,
            });

            let stdout = "";
            let stderr = "";
            child.stdout?.on("data", (chunk: Buffer) => {
              stdout += chunk.toString("utf8");
            });
            child.stderr?.on("data", (chunk: Buffer) => {
              stderr += chunk.toString("utf8");
            });

            const abort = (): void => {
              child.kill();
            };
            context.signal.addEventListener("abort", abort, { once: true });

            child.on("error", (error) => {
              context.signal.removeEventListener("abort", abort);
              span.end({ error: String(error) });
              reject(new RaptorError("raptor:module/unsupported", `nu am putut porni '${command}'`, { command, cause: String(error) }));
            });

            child.on("close", (code, signal) => {
              context.signal.removeEventListener("abort", abort);
              span.end({ code, signal });
              resolve({ code, signal, stdout, stderr });
            });

            if (options.input !== undefined) child.stdin?.end(options.input);
          }),
        options.timeoutMs !== undefined
          ? { name: `spawn:${command}`, deadlineMs: options.timeoutMs }
          : { name: `spawn:${command}` },
      );
    },

    requestExit(code = 0): void {
      host.observer.log("info", "process.exitRequested", { code });
      for (const listener of listeners) listener(code);
    },

    onExitRequest(listener: (code: number) => void): void {
      listeners.push(listener);
    },
  };
}
