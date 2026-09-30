/**
 * The listening socket, as an interface.
 *
 * The idea that matters here is that **the app does not open the port**. The
 * host opens it and gives the app a handler. That is also how a well-placed
 * service works in reality: the socket can come already open from the
 * supervisor (systemd socket activation, a load balancer, a sidecar), and the
 * process that serves need not have the right to bind ports.
 *
 * The practical consequence for tests: the same app code runs both over a real
 * `node:http` listener and over an in-memory one.
 */

export type ServeHandler = (request: Request) => Response | Promise<Response>;

export interface Listener {
  readonly name: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

export interface ListenerFactory {
  /** Opens the socket and binds the handler; `port: 0` picks a free port. */
  open(name: string, port: number, handler: ServeHandler): Promise<Listener>;
}

/**
 * A real listener over `node:http`.
 *
 * The translation to/from `Request`/`Response` is the same one that
 * `raptor:serve` in the runtime does: the app's contract stays Web-standard,
 * and the host's server types never surface.
 */
export function nodeListeners(): ListenerFactory {
  return {
    async open(name: string, port: number, handler: ServeHandler): Promise<Listener> {
      const { createServer } = await import("node:http");
      const { Readable } = await import("node:stream");

      const server = createServer((incoming, outgoing) => {
        void (async (): Promise<void> => {
          const host = incoming.headers.host ?? "localhost";
          const url = `http://${host}${incoming.url ?? "/"}`;
          const method = incoming.method ?? "GET";
          const headers = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (typeof value === "string") headers.set(key, value);
            else if (Array.isArray(value)) for (const entry of value) headers.append(key, entry);
          }

          const hasBody = method !== "GET" && method !== "HEAD";
          const request = new Request(url, {
            method,
            headers,
            ...(hasBody
              ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" }
              : {}),
          } as RequestInit);

          let response: Response;
          try {
            response = await handler(request);
          } catch (error) {
            // A handler that throws must not leave the connection hanging.
            response = new Response(`internal error: ${(error as Error).message}`, { status: 500 });
          }

          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
          outgoing.end(body ?? undefined);
        })();
      });

      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });

      const address = server.address();
      const boundPort = typeof address === "object" && address !== null ? address.port : port;

      return {
        name,
        port: boundPort,
        url: `http://127.0.0.1:${boundPort}`,
        close: () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            // Keep-alive connections would hold the server open forever.
            server.closeIdleConnections();
          }),
      };
    },
  };
}
