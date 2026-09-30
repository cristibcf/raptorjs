/**
 * The launcher's argument parser.
 *
 * Spec section 4: every command supports both readable output and `--json` for
 * automation. The `--` separator passes the rest of the arguments to the
 * application, so that `raptor-runtime run app.ts -- --port 8080` is unambiguous.
 */
export interface ParsedArgs {
  readonly command: string | null;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  /** The arguments after `--`, intended for the application. */
  readonly appArgs: readonly string[];
}

const VALUE_FLAGS = new Set(["policy", "cwd", "out", "port", "filter", "output", "reporter"]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  const appArgs: string[] = [];
  let command: string | null = null;
  let afterSeparator = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (afterSeparator) {
      appArgs.push(token);
      continue;
    }
    if (token === "--") {
      afterSeparator = true;
      continue;
    }

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const equals = body.indexOf("=");
      if (equals >= 0) {
        flags[body.slice(0, equals)] = body.slice(equals + 1);
        continue;
      }
      if (VALUE_FLAGS.has(body)) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[body] = next;
          i += 1;
          continue;
        }
      }
      flags[body] = true;
      continue;
    }

    if (command === null) command = token;
    else positionals.push(token);
  }

  return { command, positionals, flags, appArgs };
}

export function flagString(flags: Readonly<Record<string, string | boolean>>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function flagBool(flags: Readonly<Record<string, string | boolean>>, name: string): boolean {
  return flags[name] === true || flags[name] === "true";
}
