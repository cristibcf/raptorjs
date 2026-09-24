/**
 * Puntea dinspre JavaScript catre host-ul nativ.
 *
 * Regula sectiunii 6 - "JavaScript primeste doar API-uri raptor: si
 * capabilitatile acordate" - se traduce aici in doua lucruri concrete:
 *
 *  1. aplicatia nu primeste niciodata transportul, ci doar acest obiect;
 *  2. fiecare apel este verificat local inainte sa plece, ca refuzul sa fie
 *     imediat si lizibil - dar verificarea reala ramane la host, pentru ca
 *     latura JS poate fi oricand ocolita de cod ostil.
 */
import { requireCapability } from "./capabilities.ts";
import type { HostTarget } from "./capabilities.ts";
import { HostError, isHostErrorCode } from "./errors.ts";
import { capabilityForMethod, decodeFrame, encodeFrame } from "./protocol.ts";
import type { Frame } from "./protocol.ts";
import type { HostTransport } from "./transport.ts";

export interface BridgeOptions {
  readonly target: HostTarget;
  /** Modulele optionale acordate; de obicei `manifest.capabilities`. */
  readonly capabilities?: readonly string[];
  readonly transport: HostTransport;
  /** Implicit 15s. `0` asteapta la nesfarsit (cere deadline la nivel de task). */
  readonly timeoutMs?: number;
}

export interface HostDescription {
  readonly target: HostTarget;
  readonly capabilities: readonly string[];
  /** Metodele pe care adaptorul din spate chiar le implementeaza. */
  readonly implemented: readonly string[];
}

export interface HostBridge {
  readonly target: HostTarget;
  readonly capabilities: readonly string[];
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** `true` daca apelul ar trece de verificarea locala de capabilitate. */
  allows(method: string): boolean;
  /**
   * Ce poate face aplicatia aici, de-a binelea: capabilitate acordata *si*
   * metoda implementata de adaptor. `allows` raspunde doar la prima intrebare,
   * deci o interfata care isi deseneaza singura optiunile pe el ar promite
   * lucruri pe care host-ul curent nu le poate face.
   */
  supported(): Promise<(method: string) => boolean>;
  describe(): Promise<HostDescription>;
  on(event: string, listener: (payload: Record<string, unknown>) => void): void;
  /** Respinge apelurile in zbor si inchide transportul. */
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
      // Un cadru corupt nu are id, deci nu poate fi atribuit unui apel anume:
      // il raportam ca eveniment de protocol si lasam apelurile sa expire.
      emit("host.protocolError", { message: (error as Error).message });
      return;
    }

    if (frame.kind === "result") {
      settle(frame.id, (entry) => entry.resolve(frame.value));
      return;
    }
    if (frame.kind === "failure") {
      // Codul host-ului se pastreaza daca este unul cunoscut: altfel un refuz de
      // capabilitate ar ajunge la aplicatie etichetat "neimplementat", si nu s-ar
      // mai putea deosebi "nu ai voie" de "nu stiu sa fac".
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
    // Un `call` dinspre host catre aplicatie nu face parte din acest contract.
    emit("host.protocolError", { message: `cadru neasteptat dinspre host: ${frame.kind}` });
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
        throw new HostError("raptor:host/transport-closed", "puntea catre host a fost inchisa", { method });
      }
      const capability = capabilityForMethod(method);
      if (capability !== null) requireCapability(options.target, capability, capabilities);

      const id = ++nextId;
      const promise = new Promise<T>((resolve, reject) => {
        const entry: Pending = { method, resolve: resolve as (value: unknown) => void, reject, timer: null };
        if (timeoutMs > 0) {
          entry.timer = setTimeout(() => {
            pending.delete(id);
            reject(
              new HostError("raptor:host/transport-closed", `host-ul nu a raspuns la '${method}' in ${timeoutMs}ms`, {
                method,
                timeoutMs,
              }),
            );
          }, timeoutMs);
          if (typeof (entry.timer as { unref?: () => void }).unref === "function") {
            (entry.timer as { unref: () => void }).unref();
          }
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
            new HostError("raptor:host/transport-closed", `puntea s-a inchis inainte de raspuns: ${reason}`, {
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
