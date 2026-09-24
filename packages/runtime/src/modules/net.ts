/**
 * `raptor:net` (spec sectiunea 6): fetch spre exterior, cu allowlist de
 * destinatii si timeout ca cetateni de rang intai. Contractul este Web-standard
 * (Request/Response/AbortSignal), nu un client HTTP proprietar.
 */
import type { HostContext } from "../context.ts";
import { RaptorError } from "../errors.ts";

export interface FetchOptions extends RequestInit {
  /** Implicit 30s; `0` dezactiveaza timeout-ul (cere deadline la nivel de task). */
  readonly timeoutMs?: number;
}

export interface RaptorNet {
  fetch(input: string | URL | Request, options?: FetchOptions): Promise<Response>;
  /** Verifica destinatia fara sa emita cererea (util in `doctor`). */
  allows(target: string | URL): boolean;
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443" };

/** `https://api.example.com/x` -> `api.example.com:443`. */
export function destinationOf(input: string | URL | Request): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RaptorError("raptor:module/unsupported", "raptor:net cere un URL absolut", { input: raw });
  }
  const port = url.port || DEFAULT_PORTS[url.protocol] || "";
  if (!port) {
    throw new RaptorError("raptor:module/unsupported", `protocol nesuportat de raptor:net: ${url.protocol}`, { input: raw });
  }
  return `${url.hostname.toLowerCase()}:${port}`;
}

export function createNet(host: HostContext): RaptorNet {
  return {
    allows(target: string | URL): boolean {
      return host.broker.check("net.connect", destinationOf(target)).granted;
    },

    async fetch(input: string | URL | Request, options: FetchOptions = {}): Promise<Response> {
      const destination = destinationOf(input);
      host.broker.require("net.connect", destination);

      const timeoutMs = options.timeoutMs ?? 30_000;
      const span = host.observer.startSpan("net.fetch", { destination, timeoutMs });
      const controller = new AbortController();
      const forward = (): void => controller.abort(options.signal?.reason);
      if (options.signal) {
        if (options.signal.aborted) forward();
        else options.signal.addEventListener("abort", forward, { once: true });
      }
      const timer =
        timeoutMs > 0
          ? setTimeout(
              () => controller.abort(new RaptorError("raptor:task/deadline", `fetch catre ${destination} a expirat`, { destination, timeoutMs })),
              timeoutMs,
            )
          : null;

      try {
        const init: RequestInit = { ...options, signal: controller.signal };
        delete (init as Record<string, unknown>)["timeoutMs"];
        const response = await fetch(input as RequestInfo, init);
        span.end({ status: response.status });
        return response;
      } catch (error) {
        span.end({ error: String(error) });
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", forward);
      }
    },
  };
}
