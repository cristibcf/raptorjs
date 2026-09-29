/**
 * `raptor:process` (spec sectiunea 6): argumente, mediu si procese copil
 * controlate. Fara acces nerestrictionat la host: `env` si `spawn` trec prin
 * broker, iar `exit` merge prin oprirea curata a runtime-ului.
 */
import { spawn as spawnChild } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { HostContext } from "../context.ts";
import { CapabilityError, RaptorError } from "../errors.ts";
import { containsPath, resolvePath } from "../paths.ts";

/**
 * Rezolva o comanda la o cale absoluta prin PATH-ul HOST-ului, inainte de spawn.
 *
 * Mediul copilului e restrictionat intentionat: nu contine `PATH` decat daca
 * aplicatia l-a cerut explicit prin `env.read`. Pe Linux, `spawn` cauta binarul
 * in PATH-ul COPILULUI, deci o comanda permisa ca "node" ar da `ENOENT` desi
 * exista pe host (pe Windows libuv cauta in PATH-ul parintelui, de aici
 * diferenta). Comanda e deja autorizata de broker pe nume; a gasi binarul e o
 * treaba separata de ce mediu vede copilul, iar setarea lui `PATH` pe copil e
 * oricum refuzata. Daca nu o gasim, o lasam asa: `spawn` va da acelasi `ENOENT`,
 * corect pentru o comanda care chiar lipseste.
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
 * Variabile de mediu care fac un proces sa incarce cod inainte sa ajunga la
 * `main`. Nu pot fi setate pentru un copil **nici macar cu `env.set` acordata**.
 *
 * Fara ele, capabilitatea `process.spawn: ["node"]` - care promite *care
 * comenzi* - devine *orice cod*: `NODE_OPTIONS=--require ./payload.js` ruleaza
 * payload-ul inainte de argumentele comenzii permise. La fel `LD_PRELOAD` pentru
 * orice binar pe Linux, `DYLD_INSERT_LIBRARIES` pe macOS, `JAVA_TOOL_OPTIONS`
 * pentru orice JVM, `BASH_ENV` pentru orice shell, `GIT_SSH_COMMAND` pentru git.
 *
 * **Lista asta nu este granita, si nu trebuie confundata cu una.** Prima
 * versiune a ei parea completa si a doua trecere de audit a trecut pe langa ea
 * cu `NODE_PATH`, `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `RUBYOPT`, `PYTHONHOME`
 * si `CLASSPATH`. Fiecare ecosistem isi are propriile variabile care incarca
 * cod, si apar altele noi. Granita e `env.set`: implicit nu se poate seta
 * NIMIC, iar ce se declara acolo e o alegere constienta. Lista de aici e a doua
 * treapta, pentru greselile evidente.
 */
const CODE_LOADING_ENV: readonly RegExp[] = [
  // Node
  /^NODE_OPTIONS$/i,
  /^NODE_PATH$/i,
  /^NODE_REPL_EXTERNAL_MODULE$/i,
  // Incarcator dinamic (Linux / macOS / AIX)
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
  // git si unelte care cheama alte programe
  /^GIT_SSH(_COMMAND)?$/i,
  /^GIT_EXTERNAL_DIFF$/i,
  /^GIT_PAGER$/i,
  /^PAGER$/i,
  /^EDITOR$/i,
  /^VISUAL$/i,
  // Cautarea binarului insusi
  /^PATH$/i,
];

function isCodeLoading(name: string): boolean {
  return CODE_LOADING_ENV.some((pattern) => pattern.test(name));
}

/** Plafon per flux capturat de la un copil (vezi `collect` in `spawn`). */
const MAX_CAPTURED_BYTES = 8 * 1024 * 1024;

/** Cat asteptam dupa SIGTERM inainte de SIGKILL. */
const KILL_GRACE_MS = 2_000;

export interface SpawnResult {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** `true` daca iesirea a depasit plafonul si a fost taiata. */
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

      // Directorul de lucru este acces la disc, deci trece prin aceeasi
      // capability ca o citire. Fara asta, o comanda permisa poate fi pornita
      // oriunde pe masina, in afara proiectului.
      const cwd = options.cwd === undefined ? host.projectRoot : resolvePath(host.projectRoot, options.cwd);
      if (options.cwd !== undefined && !containsPath(host.projectRoot, cwd)) {
        host.broker.require("files.read", cwd);
      }

      const span = host.observer.startSpan("process.spawn", { command, args: options.args ?? [], cwd });

      // Mediul copilului contine doar variabilele pe care aplicatia le poate citi.
      const childEnv: Record<string, string> = {};
      for (const key of this.envKeys()) {
        const value = source[key];
        if (value !== undefined) childEnv[key] = value;
      }

      // ...si atat. Ce vrea apelantul sa adauge peste mediul filtrat cere
      // `env.set`, declarata pe nume - a citi si a scrie nu sunt acelasi lucru,
      // iar scrierea e cea care poate schimba ce cod ruleaza copilul.
      for (const [key, value] of Object.entries(options.env ?? {})) {
        if (isCodeLoading(key)) {
          throw new CapabilityError(
            "raptor:capability/denied",
            "env.set",
            key,
            `'${key}' incarca cod in proces inainte de comanda, deci ar ocoli lista de comenzi permise`,
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

            // Fluxurile copilului sunt date necontrolate: fara plafon, un copil
            // vorbaret umple memoria runtime-ului. Peste limita taiem si
            // marcam, ca apelantul sa stie ca vede o iesire trunchiata.
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

            // Oprirea are doua trepte: intai cerem, apoi insistam. Un copil
            // care ignora SIGTERM ar supravietui deadline-ului task-ului.
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
              reject(new RaptorError("raptor:module/unsupported", `nu am putut porni '${command}'`, { command, cause: String(error) }));
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
