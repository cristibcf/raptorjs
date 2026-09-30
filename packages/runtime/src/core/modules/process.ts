/**
 * `raptor:process` (spec section 6): arguments, environment and controlled child
 * processes. No unrestricted access to the host: `env` and `spawn` go through
 * the broker, and `exit` goes through the runtime's clean shutdown.
 */
import { spawn as spawnChild } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { HostContext } from "../context.ts";
import { CapabilityError, RaptorError } from "../errors.ts";
import { containsPath, resolvePath } from "../paths.ts";

/**
 * Resolves a command to an absolute path through the HOST's PATH, before spawn.
 *
 * The child's environment is restricted on purpose: it contains `PATH` only if
 * the application explicitly requested it through `env.read`. On Linux, `spawn`
 * looks for the binary in the CHILD's PATH, so an allowed command like "node"
 * would give `ENOENT` even though it exists on the host (on Windows libuv looks
 * in the parent's PATH, hence the difference). The command is already authorized
 * by the broker by name; finding the binary is separate from what environment
 * the child sees, and setting its `PATH` on the child is denied anyway. If we do
 * not find it, we leave it as is: `spawn` will give the same `ENOENT`, correct
 * for a command that is genuinely missing.
 */
function resolveOnHostPath(command: string): string {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) return command;
  const dirs = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

/**
 * Environment variables that make a process load code before it reaches `main`.
 * They cannot be set for a child **even with `env.set` granted**.
 *
 * Without them, the `process.spawn: ["node"]` capability - which promises *which
 * commands* - becomes *any code*: `NODE_OPTIONS=--require ./payload.js` runs the
 * payload before the allowed command's arguments. Same with `LD_PRELOAD` for any
 * binary on Linux, `DYLD_INSERT_LIBRARIES` on macOS, `JAVA_TOOL_OPTIONS` for any
 * JVM, `BASH_ENV` for any shell, `GIT_SSH_COMMAND` for git.
 *
 * **This list is not a boundary, and must not be mistaken for one.** Its first
 * version looked complete and the second audit pass walked right past it with
 * `NODE_PATH`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `RUBYOPT`, `PYTHONHOME` and
 * `CLASSPATH`. Each ecosystem has its own code-loading variables, and new ones
 * appear. The boundary is `env.set`: by default NOTHING can be set, and what is
 * declared there is a conscious choice. The list here is the second stage, for
 * the obvious mistakes.
 */
const CODE_LOADING_ENV: readonly RegExp[] = [
  // Node
  /^NODE_OPTIONS$/i,
  /^NODE_PATH$/i,
  /^NODE_REPL_EXTERNAL_MODULE$/i,
  // Dynamic loader (Linux / macOS / AIX)
  /^LD_/i,
  /^DYLD_/i,
  /^LDR_/i,
  // JVM
  /^JAVA_TOOL_OPTIONS$/i,
  /^_?JAVA_OPTIONS$/i,
  /^JDK_JAVA_OPTIONS$/i,
  /^CLASSPATH$/i,
  // Python
  /^PYTHON(STARTUP|PATH|HOME)$/i,
  // Ruby / Perl
  /^RUBY(OPT|LIB)$/i,
  /^PERL5(OPT|LIB)$/i,
  // Shell
  /^BASH_ENV$/i,
  /^ENV$/i,
  /^ZDOTDIR$/i,
  // git and tools that call other programs
  /^GIT_SSH(_COMMAND)?$/i,
  /^GIT_EXTERNAL_DIFF$/i,
  /^GIT_PAGER$/i,
  /^PAGER$/i,
  /^EDITOR$/i,
  /^VISUAL$/i,
  // Looking up the binary itself
  /^PATH$/i,
];

function isCodeLoading(name: string): boolean {
  return CODE_LOADING_ENV.some((pattern) => pattern.test(name));
}

/** Cap per stream captured from a child (see `collect` in `spawn`). */
const MAX_CAPTURED_BYTES = 8 * 1024 * 1024;

/** How long we wait after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 2_000;

export interface SpawnResult {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** `true` if the output exceeded the cap and was truncated. */
  readonly truncated: boolean;
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
  /** Only the variables covered by `env.read`; the rest are not even listed. */
  envKeys(): readonly string[];
  spawn(command: string, options?: SpawnChildOptions): Promise<SpawnResult>;
  /** Requests a clean shutdown; does not kill the process on the spot. */
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

      // The working directory is disk access, so it goes through the same
      // capability as a read. Without this, an allowed command could be started
      // anywhere on the machine, outside the project.
      const cwd = options.cwd === undefined ? host.projectRoot : resolvePath(host.projectRoot, options.cwd);
      if (options.cwd !== undefined && !containsPath(host.projectRoot, cwd)) {
        host.broker.require("files.read", cwd);
      }

      const span = host.observer.startSpan("process.spawn", { command, args: options.args ?? [], cwd });

      // The child's environment contains only the variables the application can read.
      const childEnv: Record<string, string> = {};
      for (const key of this.envKeys()) {
        const value = source[key];
        if (value !== undefined) childEnv[key] = value;
      }

      // ...and that is all. Whatever the caller wants to add on top of the
      // filtered environment requires `env.set`, declared by name - reading and
      // writing are not the same thing, and writing is what can change what code
      // the child runs.
      for (const [key, value] of Object.entries(options.env ?? {})) {
        if (isCodeLoading(key)) {
          throw new CapabilityError(
            "raptor:capability/denied",
            "env.set",
            key,
            `'${key}' loads code into the process before the command, so it would bypass the list of allowed commands`,
          );
        }
        host.broker.require("env.set", key);
        childEnv[key] = value;
      }

      return await host.tasks.spawn<SpawnResult>(
        (context) =>
          new Promise<SpawnResult>((resolve, reject) => {
            const child = spawnChild(resolveOnHostPath(command), [...(options.args ?? [])], {
              cwd,
              env: childEnv,
              shell: false,
            });

            // The child's streams are uncontrolled data: without a cap, a
            // talkative child fills the runtime's memory. Past the limit we
            // truncate and mark it, so the caller knows it is seeing truncated output.
            let stdout = "";
            let stderr = "";
            let truncated = false;
            const collect = (current: string, chunk: Buffer): string => {
              if (current.length >= MAX_CAPTURED_BYTES) {
                truncated = true;
                return current;
              }
              const next = current + chunk.toString("utf8");
              if (next.length <= MAX_CAPTURED_BYTES) return next;
              truncated = true;
              return next.slice(0, MAX_CAPTURED_BYTES);
            };
            child.stdout?.on("data", (chunk: Buffer) => {
              stdout = collect(stdout, chunk);
            });
            child.stderr?.on("data", (chunk: Buffer) => {
              stderr = collect(stderr, chunk);
            });

            // Stopping has two stages: first we ask, then we insist. A child
            // that ignores SIGTERM would survive the task's deadline.
            let escalation: NodeJS.Timeout | null = null;
            const abort = (): void => {
              child.kill();
              escalation = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
              escalation.unref();
            };
            context.signal.addEventListener("abort", abort, { once: true });

            const done = (): void => {
              context.signal.removeEventListener("abort", abort);
              if (escalation) clearTimeout(escalation);
            };

            child.on("error", (error) => {
              done();
              span.end({ error: String(error) });
              reject(new RaptorError("raptor:module/unsupported", `could not start '${command}'`, { command, cause: String(error) }));
            });

            child.on("close", (code, signal) => {
              done();
              span.end({ code, signal, truncated });
              resolve({ code, signal, stdout, stderr, truncated });
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
