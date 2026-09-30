/**
 * A single process serves both the page and RaptorWire: HTTP for index.html +
 * bundle, WebSocket on /raptor for the shared state. One port, one command.
 *
 *   node examples/todo-realtime/src/server.ts
 *   (or: pnpm dev:todo)
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleApp, rewriteHtml } from "@raptorstack/engine/bundle";
import { serveOverWebSocket } from "@raptorstack/wire/server";
import { buildTodoApp } from "./app.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const entry = join(here, "main.tsx");

export interface TodoServer {
  /** The port actually listened on (useful when you start on 0). */
  port: number;
  close(): Promise<void>;
}

/** Starts HTTP + RaptorWire on the same port. `port: 0` picks a free one. */
export function startTodoServer(port = Number(process.env.PORT ?? 5190)): Promise<TodoServer> {
  const app = buildTodoApp();

  const http = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];

    if (url === "/bundle.js") {
      // Rebundle on every request: the example is small, and a refresh grabs the latest code.
      const { code } = bundleApp(entry, { sourceMap: true });
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(code);
      return;
    }

    if (url === "/" || url === "/index.html") {
      const html = rewriteHtml(readFileSync(join(root, "index.html"), "utf8"), "/bundle.js", false);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  const wire = serveOverWebSocket(app, http);

  return new Promise<TodoServer>((resolve) => {
    http.listen(port, () => {
      const bound = (http.address() as { port: number }).port;
      resolve({
        port: bound,
        close: () =>
          new Promise<void>((done) => {
            // Upgraded sockets first: the HTTP server no longer knows about them.
            wire.close();
            http.close(() => done());
          }),
      });
    });
  });
}

if (import.meta.main) {
  const server = await startTodoServer();
  console.log(`todo realtime  →  http://localhost:${server.port}`);
  console.log(`  wire         →  ws://localhost:${server.port}/raptor`);
  console.log(`  Open two windows on the same URL to see them sync.`);
}
