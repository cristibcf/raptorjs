/**
 * The bridge from JavaScript to the native host.
 *
 * The section 6 rule - "JavaScript only gets raptor: APIs and the granted
 * capabilities" - translates here into two concrete things:
 *
 *  1. the app never receives the transport, only this object;
 *  2. every call is checked locally before it leaves, so a denial is
 *     immediate and readable - but the real check stays at the host, because
 *     the JS side can always be bypassed by hostile code.
 */
import { requireCapability } from "./capabilities.ts";
import type { HostTarget } from "./capabilities.ts";
import { HostError, isHostErrorCode } from "./errors.ts";
import { capabilityForMethod, decodeFrame, encodeFrame } from "./protocol.ts";
import type { Frame } from "./protocol.ts";
import type { HostTransport } from "./transport.ts";

export interface BridgeOptions {
  readonly target: HostTarget;
  /** The granted optional modules; usually `manifest.capabilities`. */
  readonly capabilities?: readonly string[];
  readonly transport: HostTransport;
  /** Defaults to 15s. `0` waits forever (ask for a deadline at the task level). */
  readonly timeoutMs?: number;
}

export interface HostDescription {
  readonly target: HostTarget;
  readonly capabilities: readonly string[];
  /** The methods the backing adapter actually implements. */
  readonly implemented: readonly string[];
}

export interface HostBridge {
  readonly target: HostTarget;
  readonly capabilities: readonly string[];
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** `true` if the call would pass the local capability check. */
  allows(method: string): boolean;
  /**
   * What the app can genuinely do here: granted capability *and* method
   * implemented by the adapter. `allows` only answers the first question, so
   * an interface that draws its own options off it would promise things the
   * current host cannot do.
   */
  supported(): Promise<(method: string) => boolean>;
  describe(): Promise<HostDescription>;
  on(event: string, listener: (payload: Record<string, unknown>) => void): void;
  /** Rejects in-flight calls and closes the transport. */
  dispose(reason?: string): void;
}

interface Pending {
  readonly method: string;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createBridge(options: BridgeOptions): HostBridge {
  const capabilities = [...(options.capabilities ?? [])];
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, Array<(payload: Record<string, unknown>) => void>>();
  let nextId = 0;
  let disposed = false;

  const settle = (id: number, apply: (entry: Pending) => void): void => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    apply(entry);
  };

  options.transport.onMessage((line: string) => {
    let frame: Frame;
    try {
      frame = decodeFrame(line);
    } catch (error) {
      // A corrupt frame has no id, so it cannot be tied to a specific call:
      // we report it as a protocol event and let the calls time out.
      emit("host.protocolError", { message: (error as Error).message });
      return;
    }

    if (frame.kind === "result") {
      settle(frame.id, (entry) => entry.resolve(frame.value));
      return;
    }
    if (frame.kind === "failure") {
      // The host's code is kept if it is a known one: otherwise a capability
      // denial would reach the app labeled "unimplemented", and you could no
      // longer tell "you are not allowed" from "I don't know how to do it".
      const code = isHostErrorCode(frame.error.code) ? frame.error.code : "raptor:host/unimplemented";
      settle(frame.id, (entry) =>
        entry.reject(
          new HostError(code, frame.error.message, {
            ...(frame.error.detail ?? {}),
            hostCode: frame.error.code,
            method: entry.method,
          }),
        ),
      );
      return;
    }
    if (frame.kind === "event") {
      emit(frame.name, frame.payload as Record<string, unknown>);
      return;
    }
    // A `call` from the host to the app is not part of this contract.
    emit("host.protocolError", { message: `unexpected frame from host: ${frame.kind}` });
  });

  function emit(name: string, payload: Record<string, unknown>): void {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(payload);
  }

  return {
    target: options.target,
    capabilities,

    allows(method: string): boolean {
      try {
        const capability = capabilityForMethod(method);
        if (capability === null) return true;
        requireCapability(options.target, capability, capabilities);
        return true;
      } catch {
        return false;
      }
    },

    async describe(): Promise<HostDescription> {
      return await this.call<HostDescription>("host.describe");
    },

    async supported(): Promise<(method: string) => boolean> {
      const description = await this.describe();
      const implemented = new Set(description.implemented);
      return (method: string): boolean => implemented.has(method) && this.allows(method);
    },

    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      if (disposed) {
        throw new HostError("raptor:host/transport-closed", "the bridge to the host was closed", { method });
      }
      const capability = capabilityForMethod(method);
      if (capability !== null) requireCapability(options.target, capability, capabilities);

      const id = ++nextId;
      const promise = new Promise<T>((resolve, reject) => {
        const entry: Pending = { method, resolve: resolve as (value: unknown) => void, reject, timer: null };
        if (timeoutMs > 0) {
          // No `unref`: an in-flight call keeps the event loop alive until it
          // resolves or times out (at most `timeoutMs`). With `unref`, an
          // `await call()` on an otherwise idle loop would exit without the
          // promise ever resolving - no response, no timeout. The timer is
          // cleared on the response and on `dispose` anyway, so nothing lingers.
          entry.timer = setTimeout(() => {
            pending.delete(id);
            reject(
              new HostError("raptor:host/transport-closed", `the host did not respond to '${method}' within ${timeoutMs}ms`, {
                method,
                timeoutMs,
              }),
            );
          }, timeoutMs);
        }
        pending.set(id, entry);
      });

      options.transport.send(encodeFrame({ kind: "call", id, method, params }));
      return promise;
    },

    on(event: string, listener: (payload: Record<string, unknown>) => void): void {
      const bucket = listeners.get(event);
      if (bucket) bucket.push(listener);
      else listeners.set(event, [listener]);
    },

    dispose(reason = "dispose"): void {
      if (disposed) return;
      disposed = true;
      for (const [id] of [...pending]) {
        settle(id, (entry) =>
          entry.reject(
            new HostError("raptor:host/transport-closed", `the bridge closed before a response: ${reason}`, {
              method: entry.method,
              reason,
            }),
          ),
        );
      }
      options.transport.close();
    },
  };
}
