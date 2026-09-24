/**
 * Dispecerul launcher-ului `raptor-runtime` (spec sectiunea 4).
 *
 * `runCli` nu atinge niciodata `process`: primeste argumentele si mediul, si
 * intoarce un `CommandResult`. `main` este singurul loc care scrie la iesire si
 * seteaza codul de proces, deci fiecare comanda poate fi testata in proces, fara
 * sa porneasca un shell.
 */
import { RUNTIME_VERSION } from "@raptor/runtime";
import type { PolicyMode } from "@raptor/runtime";
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
  /** Fara terminal interactiv, politica `prompt` degradeaza la `deny`. */
  readonly interactive?: boolean;
  /** `run` asteapta semnalele de oprire doar in binar, nu in teste. */
  readonly waitForSignals?: boolean;
}

const USAGE = [
  `RaptorRuntime ${RUNTIME_VERSION}`,
  "",
  "  raptor-runtime init [director]        creeaza un proiect nou",
  "  raptor-runtime run [-- args...]       ruleaza proiectul din directorul curent",
  "  raptor-runtime doctor                 verifica manifest, politici si graf static",
  "  raptor-runtime test [--filter text]   ruleaza fisierele *.test.ts ale proiectului",
  "  raptor-runtime pack [--out dir]       ambaleaza o unitate reproductibila cu lockfile",
  "  raptor-runtime trace [--out fisier]   ruleaza si scrie urmarire compatibila OpenTelemetry",
  "",
  "  --policy development|production       suprascrie politica din manifest",
  "  --cwd <cale>                          porneste din alt director",
  "  --json                                iesire structurata pentru automatizare",
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
    return fail(2, `politica necunoscuta: ${policyFlag} (asteptat development sau production)`, {
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
        return fail(2, `comanda necunoscuta: ${parsed.command}\n\n${USAGE}`, {
          error: { code: "raptor:cli/unknown-command", command: parsed.command },
        });
    }
  } catch (error) {
    return fromError(error);
  }
}

/** Punctul de intrare al binarului: singurul loc cu efecte pe proces. */
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
