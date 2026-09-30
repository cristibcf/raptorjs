/**
 * Types and utilities common to the launcher's commands.
 *
 * Every command returns the same object: an exit code, a readable text and a
 * structured payload. `--json` prints the payload; without the flag the text is
 * printed. This makes every command testable without a process.
 */
import type { PolicyMode } from "@raptorstack/runtime";
import { isRaptorError } from "@raptorstack/runtime";

export interface CommandResult {
  readonly code: number;
  readonly out: string;
  readonly data: Record<string, unknown>;
}

export interface CommandInput {
  readonly cwd: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly appArgs: readonly string[];
  readonly json: boolean;
  readonly interactive: boolean;
  /** `--policy` overrides the manifest's policy. */
  readonly policyOverride: PolicyMode | null;
}

export function ok(out: string, data: Record<string, unknown>): CommandResult {
  return { code: 0, out, data };
}

export function fail(code: number, out: string, data: Record<string, unknown>): CommandResult {
  return { code, out, data };
}

/** Translates any exception into a command result with a stable code. */
export function fromError(error: unknown): CommandResult {
  if (isRaptorError(error)) {
    const detail = error.detail as Record<string, unknown>;
    const issues = Array.isArray(detail["issues"]) ? (detail["issues"] as string[]) : [];
    const lines = [`error ${error.code}: ${error.message}`, ...issues.map((issue) => `  - ${issue}`)];
    return fail(1, lines.join("\n"), { error: error.toJSON() });
  }
  const message = error instanceof Error ? error.message : String(error);
  return fail(1, `error: ${message}`, { error: { code: "raptor:internal", message } });
}

export function table(rows: readonly (readonly [string, string])[], indent = "  "): string {
  const width = rows.reduce((max, row) => Math.max(max, row[0].length), 0);
  return rows.map(([key, value]) => `${indent}${key.padEnd(width)}  ${value}`).join("\n");
}

export function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}
