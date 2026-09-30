/**
 * `raptor:net` (spec section 6): outbound fetch, with a destination allowlist
 * and timeout as first-class citizens. The contract is Web-standard
 * (Request/Response/AbortSignal), not a proprietary HTTP client.
 */
import type { HostContext } from "../context.ts";
import { RaptorError } from "../errors.ts";

export interface FetchOptions extends RequestInit {
  /** Default 30s; `0` disables the timeout (request a task-level deadline). */
  readonly timeoutMs?: number;
  /** How many redirects we follow, each re-checked through the broker. Default 5. */
  readonly maxRedirects?: number;
}

/**
 * How many hops we accept by default. The same number as the browser's `fetch`:
 * enough for real chains (http -> https -> with trailing slash), too few for a
 * loop.
 */
const DEFAULT_MAX_REDIRECTS = 5;

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Headers that carry authority and have NO business on another host.
 *
 * A token for `api.example.com` must not reach `cdn.example.com` just because
 * the first responded with a 302. Browsers do exactly that on a cross-origin
 * redirect; we did it on the first pass and did not do it on the second - it was
 * found during the re-audit.
 */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/** The headers forwarded onward, without the authority ones. */
function withoutCredentials(headers: HeadersInit | undefined): Headers {
  const next = new Headers(headers ?? {});
  for (const name of CREDENTIAL_HEADERS) next.delete(name);
  return next;
}

export interface RaptorNet {
  fetch(input: string | URL | Request, options?: FetchOptions): Promise<Response>;
  /** Checks the destination without issuing the request (useful in `doctor`). */
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
    throw new RaptorError("raptor:module/unsupported", "raptor:net requires an absolute URL", { input: raw });
  }
  const port = url.port || DEFAULT_PORTS[url.protocol] || "";
  if (!port) {
    throw new RaptorError("raptor:module/unsupported", `protocol not supported by raptor:net: ${url.protocol}`, { input: raw });
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
              () => controller.abort(new RaptorError("raptor:task/deadline", `fetch to ${destination} timed out`, { destination, timeoutMs })),
              timeoutMs,
            )
          : null;

      try {
        const init: RequestInit = { ...options, signal: controller.signal };
        delete (init as Record<string, unknown>)["timeoutMs"];
        delete (init as Record<string, unknown>)["maxRedirects"];

        // We follow the redirects ourselves, not `fetch`.
        //
        // With `redirect: "follow"` (the default), the broker sees only the
        // first URL: an allowed host responds 302 and the next hop leaves toward
        // anything, without passing by anyone. That is how `169.254.169.254`
        // gets read with an allowlist that does not contain it. So we request
        // the raw response and put every hop through `require`, like the first.
        init.redirect = "manual";

        // The effective headers are gathered NOW, because a `Request` carries
        // its own: after the first hop we continue with a plain URL, and without
        // this step all the initial request's headers would be lost, not just
        // the authority ones.
        if (input instanceof Request) {
          const merged = new Headers(input.headers);
          for (const [name, value] of new Headers(options.headers ?? {})) merged.set(name, value);
          init.headers = merged;
          if (init.method === undefined) init.method = input.method;
        }

        // Assumed limitation: if `input` was a `Request` with a body, the body
        // is not resent after a 307/308 - we continue from the new URL, with
        // `init`. For requests with a body that must actually survive a
        // redirect, pass `body` in `options`, not in `Request`.
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
            // A 3xx without `Location` is not a redirect, it is the final response.
            span.end({ status: response.status, hops, credentialsDropped });
            return response;
          }

          if (hops >= maxRedirects) {
            throw new RaptorError("raptor:module/unsupported", `too many redirects from ${destination}`, {
              destination,
              maxRedirects,
            });
          }

          const base = typeof current === "string" ? current : current instanceof Request ? current.url : String(current);
          const next = new URL(location, base).href;
          const nextDestination = destinationOf(next);
          // Here is the whole fix: the next hop is a new destination.
          host.broker.require("net.connect", nextDestination);

          // And if it is another host, it leaves without credentials. The
          // capability says only that we may TALK to it, not that it is allowed
          // to hear our token.
          if (nextDestination !== destinationOf(base)) {
            init.headers = withoutCredentials(init.headers);
            credentialsDropped = true;
            host.observer.log("debug", "net.redirect.credentialsDropped", {
              from: destinationOf(base),
              to: nextDestination,
            });
          }

          // 303, and 301/302 on non-GET, continue with GET without a body (RFC 9110).
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
