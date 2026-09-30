/**
 * RaptorRuntime errors (spec section 3: original implementation, no error text
 * copied from other runtimes). Every error has a stable code
 * `raptor:<scope>/<reason>` that diagnostics and contract tests can check
 * without depending on the wording of the message.
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

/** Capability denial: the only way the host blocks an access. */
export class CapabilityError extends RaptorError {
  readonly capability: string;
  readonly target: string;

  constructor(code: RaptorErrorCode, capability: string, target: string, reason: string) {
    super(code, `capability '${capability}' does not cover '${target}': ${reason}`, { capability, target, reason });
    this.name = "CapabilityError";
    this.capability = capability;
    this.target = target;
  }
}

export function isRaptorError(value: unknown): value is RaptorError {
  return value instanceof RaptorError;
}
