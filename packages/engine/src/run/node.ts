/**
 * Node HTTP target (whitepaper RaptorEngine 19.2: "Node.js - the first
 * compatibility target"). Serves the runtime's request lifecycle over node:http.
 * RaptorWire over WebSocket is a later adapter; the core is transport-agnostic,
 * so another target (Bun/edge) only swaps this thin layer.
 */
import { createServer, type Server } from "node:http";
import type { RaptorRuntime } from "./runtime.ts";

/** Creates a Node HTTP server that delegates to runtime.handleRequest. */
export function createNodeServer(runtime: RaptorRuntime): Server {
  return createServer((req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    const result = runtime.handleRequest(req.method ?? "GET", path);
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  });
}

/** Starts the server; resolves with the effective port (0 = ephemeral port). */
export function listen(server: Server, port = 0, host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
}

/** Stops the server (graceful). */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
