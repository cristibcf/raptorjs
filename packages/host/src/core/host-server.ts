/**
 * The host side of the bridge: the dispatcher that will run in the native binary.
 *
 * This is the real boundary. The capability check is repeated, even though the
 * JS bridge already did it: the bridge runs in the same isolate as the app, so
 * it cannot be a source of truth for security. The dispatcher accepts only the
 * methods the adapter implements and reports the rest as unimplemented, instead
 * of ignoring them silently.
 */
import { decideCapability } from "./capabilities.ts";
import type { HostTarget } from "./capabilities.ts";
import { HostError, isHostError } from "./errors.ts";
import { capabilityForMethod, decodeFrame, encodeFrame } from "./protocol.ts";
import type { EventFrame, Frame } from "./protocol.ts";
import type { HostTransport } from "./transport.ts";

export type MethodHandler = (params: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;

export interface HostServerOptions {
  readonly target: HostTarget;
  readonly capabilities?: readonly string[];
  readonly transport: HostTransport;
  readonly methods: Readonly<Record<string, MethodHandler>>;
  /** Every call received, allowed or denied; the host's audit log. */
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface AuditEntry {
  readonly method: string;
  readonly granted: boolean;
  readonly reason: string;
  readonly capability: string | null;
}

export interface HostServer {
  /** Sends an event to the app (lifecycle, deep link, updates). */
  emit(name: string, payload?: Record<string, unknown>): void;
  readonly audit: readonly AuditEntry[];
  close(): void;
}

export function serveHost(options: HostServerOptions): HostServer {
  const capabilities = [...(options.capabilities ?? [])];
  const audit: AuditEntry[] = [];

  const record = (entry: AuditEntry): void => {
    audit.push(entry);
    options.onAudit?.(entry);
  };

  /**
   * Sends only if there is still someone listening. A closed channel is not a
   * host error: the app can disappear at any time (window closed, process
   * terminated), and a delayed response or a lifecycle event must not bring
   * down the adapter that is shutting down.
   */
  const send = (frame: Frame): void => {
    if (options.transport.closed) return;
    options.transport.send(encodeFrame(frame));
  };

  const fail = (id: number, error: unknown): void => {
    const hostError = isHostError(error)
      ? error
      : new HostError("raptor:host/unimplemented", error instanceof Error ? error.message : String(error), {});
    send({
      kind: "failure",
      id,
      error: { code: hostError.code, message: hostError.message, detail: { ...hostError.detail } },
    });
  };

  options.transport.onMessage((line: string) => {
    let frame: Frame;
    try {
      frame = decodeFrame(line);
    } catch {
      // Without an id there is no one to answer; a corrupt frame is ignored, not guessed.
      return;
    }
    if (frame.kind !== "call") return;

    void (async (): Promise<void> => {
      let capability: string | null = null;
      try {
        capability = capabilityForMethod(frame.method);
      } catch (error) {
        record({ method: frame.method, granted: false, reason: "unknown method", capability: null });
        fail(frame.id, error);
        return;
      }

      if (capability !== null) {
        const verdict = decideCapability(options.target, capability, capabilities);
        if (!verdict.granted) {
          record({ method: frame.method, granted: false, reason: verdict.reason, capability });
          fail(
            frame.id,
            new HostError(
              verdict.availability === "optional"
                ? "raptor:host/capability-undeclared"
                : "raptor:host/capability-unavailable",
              `capability '${capability}' is not available: ${verdict.reason}`,
              { capability, method: frame.method, target: options.target },
            ),
          );
          return;
        }
      }

      const handler = Object.prototype.hasOwnProperty.call(options.methods, frame.method)
        ? options.methods[frame.method]
        : undefined;

      // `host.describe` is the dispatcher's answer about itself, so it knows it
      // without the adapter's help - which can still replace it.
      if (!handler && frame.method === "host.describe") {
        record({ method: frame.method, granted: true, reason: "allowed", capability });
        send({
          kind: "result",
          id: frame.id,
          value: {
            target: options.target,
            capabilities: [...capabilities].sort(),
            implemented: Object.keys(options.methods).concat("host.describe").sort(),
          },
        });
        return;
      }

      if (!handler) {
        record({ method: frame.method, granted: true, reason: "not implemented by this adapter", capability });
        fail(
          frame.id,
          new HostError("raptor:host/unimplemented", `the adapter does not implement '${frame.method}'`, {
            method: frame.method,
            target: options.target,
          }),
        );
        return;
      }

      record({ method: frame.method, granted: true, reason: "allowed", capability });
      try {
        const value = await handler(frame.params);
        send({ kind: "result", id: frame.id, value: value ?? null });
      } catch (error) {
        fail(frame.id, error);
      }
    })();
  });

  return {
    emit(name: string, payload: Record<string, unknown> = {}): void {
      const frame: EventFrame = { kind: "event", name, payload };
      send(frame);
    },
    get audit(): readonly AuditEntry[] {
      return audit;
    },
    close(): void {
      options.transport.close();
    },
  };
}
