/**
 * Target Node HTTP (whitepaper RaptorEngine 19.2: "Node.js - primul target de
 * compatibilitate"). Serveste request lifecycle-ul runtime-ului peste node:http.
 * RaptorWire peste WebSocket este un adapter ulterior; nucleul e transport-
 * agnostic, deci un alt target (Bun/edge) doar schimba acest strat subtire.
 */
import { createServer, type Server } from "node:http";
import type { RaptorRuntime } from "./runtime.ts";

/** Creeaza un server HTTP Node care deleaga la runtime.handleRequest. */
export function createNodeServer(runtime: RaptorRuntime): Server {
  return createServer((req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    const result = runtime.handleRequest(req.method ?? "GET", path);
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  });
}

/** Porneste serverul; rezolva cu portul efectiv (0 = port efemer). */
export function listen(server: Server, port = 0, host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
}

/** Opreste serverul (graceful). */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
