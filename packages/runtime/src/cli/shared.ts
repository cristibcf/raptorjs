/**
 * Tipuri si utilitare comune comenzilor launcher-ului.
 *
 * Fiecare comanda intoarce acelasi obiect: un cod de iesire, un text lizibil si
 * o incarcatura structurata. `--json` tipareste incarcatura; fara flag se
 * tipareste textul. Asta face ca fiecare comanda sa fie testabila fara proces.
 */
import type { PolicyMode } from "@raptor/runtime";
import { isRaptorError } from "@raptor/runtime";

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
  /** `--policy` suprascrie politica din manifest. */
  readonly policyOverride: PolicyMode | null;
}

export function ok(out: string, data: Record<string, unknown>): CommandResult {
  return { code: 0, out, data };
}

export function fail(code: number, out: string, data: Record<string, unknown>): CommandResult {
  return { code, out, data };
}

/** Traduce orice exceptie intr-un rezultat de comanda cu cod stabil. */
export function fromError(error: unknown): CommandResult {
  if (isRaptorError(error)) {
    const detail = error.detail as Record<string, unknown>;
    const issues = Array.isArray(detail["issues"]) ? (detail["issues"] as string[]) : [];
    const lines = [`eroare ${error.code}: ${error.message}`, ...issues.map((issue) => `  - ${issue}`)];
    return fail(1, lines.join("\n"), { error: error.toJSON() });
  }
  const message = error instanceof Error ? error.message : String(error);
  return fail(1, `eroare: ${message}`, { error: { code: "raptor:internal", message } });
}

export function table(rows: readonly (readonly [string, string])[], indent = "  "): string {
  const width = rows.reduce((max, row) => Math.max(max, row[0].length), 0);
  return rows.map(([key, value]) => `${indent}${key.padEnd(width)}  ${value}`).join("\n");
}

export function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}
