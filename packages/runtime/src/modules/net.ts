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
  /** Cate redirect-uri urmam, fiecare re-verificat prin broker. Implicit 5. */
  readonly maxRedirects?: number;
}

/**
 * Cate salturi acceptam implicit. Acelasi numar ca in `fetch`-ul browserului:
 * destul pentru lanturile reale (http -> https -> cu slash final), prea putin
 * pentru o bucla.
 */
const DEFAULT_MAX_REDIRECTS = 5;

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Anteturi care poarta autoritate si NU au ce cauta pe alta gazda.
 *
 * Un token pentru `api.example.com` nu trebuie sa ajunga la `cdn.example.com`
 * doar pentru ca prima a raspuns cu 302. Browserele fac exact asta la un
 * redirect cross-origin; noi il faceam la prima trecere si nu-l faceam la a
 * doua - a fost gasit la re-audit.
 */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/** Anteturile trimise mai departe, fara cele de autoritate. */
function withoutCredentials(headers: HeadersInit | undefined): Headers {
  const next = new Headers(headers ?? {});
  for (const name of CREDENTIAL_HEADERS) next.delete(name);
  return next;
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
      const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
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
        delete (init as Record<string, unknown>)["maxRedirects"];

        // Urmarim redirect-urile noi, nu `fetch`.
        //
        // Cu `redirect: "follow"` (implicitul), brokerul vede doar primul URL:
        // o gazda permisa raspunde 302 si urmatorul salt pleaca spre orice, fara
        // sa mai treaca pe la nimeni. Asa se citeste `169.254.169.254` cu o
        // allowlist care nu-l contine. Deci cerem raspunsul brut si punem
        // fiecare salt prin `require`, ca si pe primul.
        init.redirect = "manual";

        // Anteturile efective sunt adunate ACUM, fiindca un `Request` si le
        // poarta pe ale lui: dupa primul salt continuam cu un URL simplu, si
        // fara pasul asta anteturile cererii initiale s-ar pierde toate, nu doar
        // cele de autoritate.
        if (input instanceof Request) {
          const merged = new Headers(input.headers);
          for (const [name, value] of new Headers(options.headers ?? {})) merged.set(name, value);
          init.headers = merged;
          if (init.method === undefined) init.method = input.method;
        }

        // Limita asumata: daca `input` a fost un `Request` cu corp, corpul nu
        // se retrimite dupa un 307/308 - continuam de la URL-ul nou, cu `init`.
        // Pentru cererile cu corp care chiar trebuie sa supravietuiasca unui
        // redirect, da `body` in `options`, nu in `Request`.
        let current: RequestInfo = input as RequestInfo;
        let hops = 0;
        let credentialsDropped = false;
        for (;;) {
          const response = await fetch(current, init);
          if (!REDIRECT_STATUS.has(response.status)) {
            span.end({ status: response.status, hops, credentialsDropped });
            return response;
          }

          const location = response.headers.get("location");
          if (location === null) {
            // Un 3xx fara `Location` nu e un redirect, e raspunsul final.
            span.end({ status: response.status, hops, credentialsDropped });
            return response;
          }

          if (hops >= maxRedirects) {
            throw new RaptorError("raptor:module/unsupported", `prea multe redirect-uri de la ${destination}`, {
              destination,
              maxRedirects,
            });
          }

          const base = typeof current === "string" ? current : current instanceof Request ? current.url : String(current);
          const next = new URL(location, base).href;
          const nextDestination = destinationOf(next);
          // Aici e toata reparatia: saltul urmator e o destinatie noua.
          host.broker.require("net.connect", nextDestination);

          // Si daca e alta gazda, pleaca fara credentiale. Capabilitatea spune
          // doar ca putem VORBI cu ea, nu ca are voie sa auda token-ul nostru.
          if (nextDestination !== destinationOf(base)) {
            init.headers = withoutCredentials(init.headers);
            credentialsDropped = true;
            host.observer.log("debug", "net.redirect.credentialsDropped", {
              from: destinationOf(base),
              to: nextDestination,
            });
          }

          // 303, si 301/302 pe non-GET, continua cu GET fara corp (RFC 9110).
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && (init.method ?? "GET").toUpperCase() !== "GET")) {
            init.method = "GET";
            delete (init as Record<string, unknown>)["body"];
          }
          await response.body?.cancel();
          current = next;
          hops += 1;
        }
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
