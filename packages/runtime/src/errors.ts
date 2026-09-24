/**
 * Erori RaptorRuntime (spec sectiunea 3: implementare originala, fara text de
 * eroare copiat din alte runtime-uri). Fiecare eroare are un cod stabil
 * `raptor:<domeniu>/<motiv>` pe care diagnosticele si testele de contract il pot
 * verifica fara sa depinda de formularea mesajului.
 */

export type RaptorErrorCode =
  | "raptor:capability/denied"
  | "raptor:capability/undeclared"
  | "raptor:capability/revoked"
  | "raptor:manifest/invalid"
  | "raptor:manifest/missing"
  | "raptor:module/not-found"
  | "raptor:module/unsupported"
  | "raptor:task/cancelled"
  | "raptor:task/deadline"
  | "raptor:task/quota"
  | "raptor:engine/evaluation";

export class RaptorError extends Error {
  readonly code: RaptorErrorCode;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(code: RaptorErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "RaptorError";
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }

  toJSON(): { name: string; code: RaptorErrorCode; message: string; detail: Record<string, unknown> } {
    return { name: this.name, code: this.code, message: this.message, detail: { ...this.detail } };
  }
}

/** Refuz de capability: singura cale prin care host-ul blocheaza un acces. */
export class CapabilityError extends RaptorError {
  readonly capability: string;
  readonly target: string;

  constructor(code: RaptorErrorCode, capability: string, target: string, reason: string) {
    super(code, `capability '${capability}' nu acopera '${target}': ${reason}`, { capability, target, reason });
    this.name = "CapabilityError";
    this.capability = capability;
    this.target = target;
  }
}

export function isRaptorError(value: unknown): value is RaptorError {
  return value instanceof RaptorError;
}
