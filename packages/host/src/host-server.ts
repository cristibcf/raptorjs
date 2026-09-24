/**
 * Latura host a puntii: dispecerul care va rula in binarul nativ.
 *
 * Aici este granita reala. Verificarea de capabilitate se repeta, chiar daca
 * puntea din JS a facut-o deja: puntea ruleaza in acelasi izolat cu aplicatia,
 * deci nu poate fi o sursa de adevar pentru securitate. Dispecerul accepta doar
 * metodele pe care adaptorul le implementeaza si le raporteaza pe restul ca
 * neimplementate, in loc sa le ignore tacit.
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
  /** Fiecare apel primit, permis sau refuzat; jurnalul de audit al host-ului. */
  readonly onAudit?: (entry: AuditEntry) => void;
}

export interface AuditEntry {
  readonly method: string;
  readonly granted: boolean;
  readonly reason: string;
  readonly capability: string | null;
}

export interface HostServer {
  /** Trimite un eveniment catre aplicatie (lifecycle, deep link, actualizari). */
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
   * Trimite doar daca mai exista cine asculte. Un canal inchis nu este o eroare
   * a host-ului: aplicatia poate sa dispara oricand (fereastra inchisa, proces
   * terminat), iar un raspuns intarziat sau un eveniment de lifecycle nu are
   * voie sa darame adaptorul care tocmai se opreste.
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
      // Fara id nu exista cui raspunde; cadrul corupt este ignorat, nu ghicit.
      return;
    }
    if (frame.kind !== "call") return;

    void (async (): Promise<void> => {
      let capability: string | null = null;
      try {
        capability = capabilityForMethod(frame.method);
      } catch (error) {
        record({ method: frame.method, granted: false, reason: "metoda necunoscuta", capability: null });
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
              `capabilitatea '${capability}' nu este disponibila: ${verdict.reason}`,
              { capability, method: frame.method, target: options.target },
            ),
          );
          return;
        }
      }

      const handler = Object.prototype.hasOwnProperty.call(options.methods, frame.method)
        ? options.methods[frame.method]
        : undefined;

      // `host.describe` este raspunsul dispecerului despre el insusi, deci il
      // stie fara ajutorul adaptorului - care poate totusi sa il inlocuiasca.
      if (!handler && frame.method === "host.describe") {
        record({ method: frame.method, granted: true, reason: "permisa", capability });
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
        record({ method: frame.method, granted: true, reason: "neimplementata de acest adaptor", capability });
        fail(
          frame.id,
          new HostError("raptor:host/unimplemented", `adaptorul nu implementeaza '${frame.method}'`, {
            method: frame.method,
            target: options.target,
          }),
        );
        return;
      }

      record({ method: frame.method, granted: true, reason: "permisa", capability });
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
