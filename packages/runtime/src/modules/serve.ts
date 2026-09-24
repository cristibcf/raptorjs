/**
 * `raptor:serve` (spec sectiunea 6): server HTTP cu contract fetch-native
 * (Request -> Response), rutare simpla si oprire gratioasa.
 *
 * Suprafata publica nu expune tipuri de server ale host-ului: in bootstrap
 * traducem din/in `node:http`, iar in host-ul nativ aceeasi interfata va fi
 * implementata direct peste stiva proprie.
 */
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { HostContext } from "../context.ts";

export type Handler = (request: Request, info: RequestInfoContext) => Response | Promise<Response>;

export interface RequestInfoContext {
  readonly signal: AbortSignal;
  readonly remoteAddress: string | null;
  readonly params: Readonly<Record<string, string>>;
}

export interface RouteDefinition {
  readonly method: string;
  readonly pattern: string;
  readonly handler: Handler;
}

export interface ServeOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly fetch?: Handler;
  readonly routes?: readonly RouteDefinition[];
  readonly onError?: (error: unknown, request: Request) => Response | Promise<Response>;
}

export interface RunningServer {
  readonly port: number;
  readonly hostname: string;
  readonly url: string;
  /** Oprire gratioasa: nu mai accepta conexiuni, dreneaza ce e in zbor. */
  close(): Promise<void>;
}

export interface RaptorServe {
  serve(options: ServeOptions): Promise<RunningServer>;
  /** Rutare pura, testabila fara socket. */
  route(routes: readonly RouteDefinition[], fallback?: Handler): Handler;
}

interface CompiledRoute {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: Handler;
}

function compile(pattern: string): readonly string[] {
  return pattern.split("/").filter((segment) => segment.length > 0);
}

function matchRoute(route: CompiledRoute, method: string, path: string): Record<string, string> | null {
  if (route.method !== "*" && route.method !== method) return null;
  const parts = path.split("/").filter((segment) => segment.length > 0);
  const params: Record<string, string> = {};
  const last = route.segments[route.segments.length - 1];

  if (last === "*") {
    if (parts.length < route.segments.length - 1) return null;
  } else if (parts.length !== route.segments.length) {
    return null;
  }

  for (let i = 0; i < route.segments.length; i += 1) {
    const expected = route.segments[i]!;
    if (expected === "*") {
      params["rest"] = parts.slice(i).join("/");
      return params;
    }
    const actual = parts[i];
    if (actual === undefined) return null;
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export function createServe(host: HostContext): RaptorServe {
  const route = (routes: readonly RouteDefinition[], fallback?: Handler): Handler => {
    const compiled: CompiledRoute[] = routes.map((definition) => ({
      method: definition.method.toUpperCase(),
      segments: compile(definition.pattern),
      handler: definition.handler,
    }));

    return async (request: Request, info: RequestInfoContext): Promise<Response> => {
      const url = new URL(request.url);
      for (const candidate of compiled) {
        const params = matchRoute(candidate, request.method.toUpperCase(), url.pathname);
        if (!params) continue;
        return await candidate.handler(request, { ...info, params });
      }
      if (fallback) return await fallback(request, info);
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    };
  };

  return {
    route,

    async serve(options: ServeOptions): Promise<RunningServer> {
      const hostname = options.hostname ?? "127.0.0.1";

      // A deschide un port e un acces la exterior, la fel ca o conexiune de
      // iesire - doar ca in sens invers. Verificarea se face INAINTE de `bind`:
      // un refuz dupa ce socket-ul e deja deschis nu mai e un refuz.
      //
      // Cu portul 0 tinta ramane `gazda:0`, deci o regula care fixeaza un port
      // anume nu acopera un port efemer. Cine vrea "orice port pe loopback"
      // scrie `127.0.0.1:*`.
      host.broker.require("net.listen", `${hostname.toLowerCase()}:${options.port ?? 0}`);

      const handler = options.fetch ?? route(options.routes ?? []);
      const inFlight = new Set<Promise<void>>();

      const server: Server = createServer((incoming: IncomingMessage, outgoing: ServerResponse) => {
        const work = handleRequest(handler, options.onError, host, hostname, incoming, outgoing);
        inFlight.add(work);
        void work.finally(() => inFlight.delete(work));
      });

      const port = await new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 0, hostname, () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : (options.port ?? 0));
        });
      });

      host.observer.log("info", "serve.listening", { hostname, port });

      return {
        port,
        hostname,
        url: `http://${hostname}:${port}`,
        async close(): Promise<void> {
          await new Promise<void>((resolve) => server.close(() => resolve()));
          await Promise.allSettled([...inFlight]);
          host.observer.log("info", "serve.closed", { hostname, port });
        },
      };
    },
  };
}

async function handleRequest(
  handler: Handler,
  onError: ServeOptions["onError"],
  host: HostContext,
  hostname: string,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const controller = new AbortController();
  incoming.on("aborted", () => controller.abort());

  const url = `http://${incoming.headers.host ?? hostname}${incoming.url ?? "/"}`;
  const method = incoming.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { duplex?: string } = {
    method,
    headers: toHeaders(incoming),
    signal: controller.signal,
  };
  if (hasBody) {
    init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  const request = new Request(url, init as RequestInit);

  const span = host.observer.startSpan("serve.request", { method, path: new URL(url).pathname });
  let response: Response;
  try {
    response = await handler(request, {
      signal: controller.signal,
      remoteAddress: incoming.socket.remoteAddress ?? null,
      params: {},
    });
  } catch (error) {
    host.observer.log("error", "serve.handlerFailed", { error: String(error) });
    response = onError
      ? await onError(error, request)
      : new Response("internal error", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));
  if (response.body) {
    await new Promise<void>((resolve, reject) => {
      Readable.fromWeb(response.body as never)
        .on("error", reject)
        .on("end", resolve)
        .pipe(outgoing);
    }).catch(() => undefined);
  } else {
    outgoing.end();
  }
  span.end({ status: response.status });
}

function toHeaders(incoming: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
  return headers;
}
