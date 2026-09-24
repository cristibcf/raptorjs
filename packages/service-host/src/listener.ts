/**
 * Socketul de ascultare, ca interfata.
 *
 * Ideea care conteaza aici este ca **aplicatia nu deschide portul**. Il deschide
 * host-ul si ii da aplicatiei un handler. Asa functioneaza si in realitate un
 * serviciu bine asezat: socketul poate veni gata deschis de la supervizor
 * (systemd socket activation, un load balancer, un sidecar), iar procesul care
 * serveste nu trebuie sa aiba dreptul sa lege porturi.
 *
 * Consecinta practica pentru teste: acelasi cod de aplicatie merge si peste un
 * listener real de `node:http`, si peste unul in memorie.
 */

export type ServeHandler = (request: Request) => Response | Promise<Response>;

export interface Listener {
  readonly name: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

export interface ListenerFactory {
  /** Deschide socketul si leaga handler-ul; `port: 0` alege un port liber. */
  open(name: string, port: number, handler: ServeHandler): Promise<Listener>;
}

/**
 * Listener real peste `node:http`.
 *
 * Traducerea din/in `Request`/`Response` este aceeasi pe care o face si
 * `raptor:serve` din runtime: contractul aplicatiei ramane Web-standard, iar
 * tipurile de server ale host-ului nu ies niciodata la suprafata.
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
            // Un handler care arunca nu are voie sa lase conexiunea agatata.
            response = new Response(`eroare interna: ${(error as Error).message}`, { status: 500 });
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
            // Conexiunile keep-alive ar tine serverul deschis la nesfarsit.
            server.closeIdleConnections();
          }),
      };
    },
  };
}
