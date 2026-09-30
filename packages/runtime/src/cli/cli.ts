/**
 * The `raptor-runtime` launcher dispatcher (spec section 4).
 *
 * `runCli` never touches `process`: it receives the arguments and the
 * environment, and returns a `CommandResult`. `main` is the only place that
 * writes to output and sets the process code, so every command can be tested
 * in-process, without starting a shell.
 */
import { RUNTIME_VERSION } from "@raptorstack/runtime";
import type { PolicyMode } from "@raptorstack/runtime";
import { flagBool, flagString, parseArgs } from "./args.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { initCommand } from "./commands/init.ts";
import { packCommand } from "./commands/pack.ts";
import { runCommand } from "./commands/run.ts";
import { testCommand } from "./commands/test.ts";
import { traceCommand } from "./commands/trace.ts";
import type { CommandInput, CommandResult } from "./shared.ts";
import { fail, fromError, ok } from "./shared.ts";

export interface CliOptions {
  readonly cwd?: string;
  /** Without an interactive terminal, the `prompt` policy degrades to `deny`. */
  readonly interactive?: boolean;
  /** `run` waits for shutdown signals only in the binary, not in tests. */
  readonly waitForSignals?: boolean;
}

const USAGE = [
  `RaptorRuntime ${RUNTIME_VERSION}`,
  "",
  "  raptor-runtime init [directory]       create a new project",
  "  raptor-runtime run [-- args...]       run the project in the current directory",
  "  raptor-runtime doctor                 check manifest, policies and static graph",
  "  raptor-runtime test [--filter text]   run the project's *.test.ts files",
  "  raptor-runtime pack [--out dir]       package a reproducible unit with a lockfile",
  "  raptor-runtime trace [--out file]     run and write an OpenTelemetry-compatible trace",
  "",
  "  --policy development|production       override the manifest's policy",
  "  --cwd <path>                          start from another directory",
  "  --json                                structured output for automation",
  "  --version, --help",
].join("\n");

function policyFrom(value: string | undefined): PolicyMode | null {
  if (value === "development" || value === "production") return value;
  return null;
}

export async function runCli(argv: readonly string[], options: CliOptions = {}): Promise<CommandResult> {
  const parsed = parseArgs(argv);
  const json = flagBool(parsed.flags, "json");

  if (flagBool(parsed.flags, "version") || parsed.command === "version") {
    return ok(RUNTIME_VERSION, { version: RUNTIME_VERSION });
  }
  if (flagBool(parsed.flags, "help") || parsed.command === null || parsed.command === "help") {
    return ok(USAGE, { usage: USAGE, commands: ["init", "run", "doctor", "test", "pack", "trace"] });
  }

  const policyFlag = flagString(parsed.flags, "policy");
  if (policyFlag !== undefined && policyFrom(policyFlag) === null) {
    return fail(2, `unknown policy: ${policyFlag} (expected development or production)`, {
      error: { code: "raptor:cli/bad-flag", flag: "policy", value: policyFlag },
    });
  }

  const cwdFlag = flagString(parsed.flags, "cwd");
  const input: CommandInput = {
    cwd: cwdFlag ?? options.cwd ?? process.cwd(),
    positionals: parsed.positionals,
    flags: parsed.flags,
    appArgs: parsed.appArgs,
    json,
    interactive: options.interactive ?? false,
    policyOverride: policyFrom(policyFlag),
  };

  try {
    switch (parsed.command) {
      case "init":
        return await initCommand(input);
      case "run": {
        const waitForSignals = options.waitForSignals ?? false;
        const { host: _host, ...result } = await runCommand(input, { waitForSignals });
        return result;
      }
      case "doctor":
        return await doctorCommand(input);
      case "test":
        return await testCommand(input);
      case "pack":
        return await packCommand(input);
      case "trace":
        return await traceCommand(input);
      default:
        return fail(2, `unknown command: ${parsed.command}\n\n${USAGE}`, {
          error: { code: "raptor:cli/unknown-command", command: parsed.command },
        });
    }
  } catch (error) {
    return fromError(error);
  }
}

/** The binary's entry point: the only place with process side effects. */
export async function main(argv: readonly string[]): Promise<number> {
  const json = argv.includes("--json");
  const result = await runCli(argv, {
    interactive: Boolean(process.stdout.isTTY && process.stdin.isTTY),
    waitForSignals: true,
  });
  const text = json ? JSON.stringify(result.data, null, 2) : result.out;
  if (result.code === 0) process.stdout.write(text + "\n");
  else process.stderr.write(text + "\n");
  return result.code;
}
