/**
 * Erorile granitei native (`raptor:host/*`).
 *
 * Spatiul de coduri este separat de cel al runtime-ului: un refuz al host-ului
 * nativ nu trebuie confundat cu un refuz al capability broker-ului din runtime.
 * Amandoua sunt stabile si verificabile din teste, fara sa depinda de text.
 */

export const HOST_ERROR_CODES = [
  "raptor:host/capability-undeclared",
  "raptor:host/capability-unavailable",
  "raptor:host/manifest-invalid",
  "raptor:host/method-unknown",
  "raptor:host/protocol",
  "raptor:host/lifecycle",
  "raptor:host/transport-closed",
  "raptor:host/unimplemented",
] as const;

export type HostErrorCode = (typeof HOST_ERROR_CODES)[number];

/** Codurile care traverseaza puntea sunt date, deci se valideaza la intrare. */
export function isHostErrorCode(value: unknown): value is HostErrorCode {
  return typeof value === "string" && (HOST_ERROR_CODES as readonly string[]).includes(value);
}

export class HostError extends Error {
  readonly code: HostErrorCode;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(code: HostErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "HostError";
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }

  toJSON(): { name: string; code: HostErrorCode; message: string; detail: Record<string, unknown> } {
    return { name: this.name, code: this.code, message: this.message, detail: { ...this.detail } };
  }
}

export function isHostError(value: unknown): value is HostError {
  return value instanceof HostError;
}
