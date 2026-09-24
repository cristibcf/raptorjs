/**
 * Un singur proces serveste si pagina, si RaptorWire: HTTP pentru index.html +
 * bundle, WebSocket pe /raptor pentru starea partajata. Un port, o comanda.
 *
 *   node examples/todo-realtime/src/server.ts
 *   (sau: pnpm dev:todo)
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleApp, rewriteHtml } from "@raptor/bundle";
import { serveOverWebSocket } from "@raptor/server";
import { buildTodoApp } from "./app.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const entry = join(here, "main.tsx");

export interface TodoServer {
  /** Portul chiar ascultat (util cand pornesti pe 0). */
  port: number;
  close(): Promise<void>;
}

/** Porneste HTTP + RaptorWire pe acelasi port. `port: 0` alege unul liber. */
export function startTodoServer(port = Number(process.env.PORT ?? 5190)): Promise<TodoServer> {
  const app = buildTodoApp();

  const http = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];

    if (url === "/bundle.js") {
      // Rebundle la fiecare cerere: exemplul e mic, iar un refresh ia ultimul cod.
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
            // Intai socket-urile upgradate: serverul HTTP nu le mai stie.
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
  console.log(`  Deschide doua ferestre pe acelasi URL ca sa vezi sincronizarea.`);
}
