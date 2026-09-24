/**
 * RaptorDev live server (whitepaper RaptorEngine 10, 11, 12).
 *
 * File watching e doar primul nivel (10): pe fiecare edit reparseaza modulul
 * atins, calculeaza graph diff-ul (DevEngine, din @raptor/engine) si trimite
 * update-ul HMR structurat clientilor prin SSE, apoi reface SSR-ul. Logica de
 * baza (`applyChange`) e testabila determinist; `fs.watch` e un adapter subtire
 * peste ea.
 */
import { watch, readFileSync, type FSWatcher } from "node:fs";
import { resolve, join } from "node:path";
import { createServer, get as httpGet, type Server } from "node:http";
import {
  DevEngine,
  formatUpdateLog,
  buildModule,
  type DevUpdate,
} from "@raptor/engine";
import { RaptorRuntime } from "./runtime.ts";
import { renderDocument } from "./ssr.ts";
import type { RouteDef } from "./router.ts";

export interface DevServerOptions {
  /** path -> sursa initiala (.raptor). */
  files: Record<string, string>;
  /** Fisierul a carui componenta se serveste la "/". */
  entry: string;
  routes?: RouteDef[];
  /** Sink pentru log-ul de update (§12). Default: no-op. */
  onLog?: (line: string) => void;
}

const CLIENT_JS = `// RaptorDev HMR client
const es = new EventSource("/@raptor/hmr");
es.onmessage = async (e) => {
  const u = JSON.parse(e.data);
  console.log("[raptor:hmr] #" + u.n, u.kind, u);
  if (u.kind === "noop") return;
  try {
    const html = await fetch(location.pathname).then((r) => r.text());
    const doc = new DOMParser().parseFromString(html, "text/html");
    const next = doc.getElementById("raptor-root");
    const cur = document.getElementById("raptor-root");
    if (next && cur) cur.replaceWith(next);
    else location.reload();
  } catch (err) {
    console.warn("[raptor:hmr] reload fallback", err);
    location.reload();
  }
};
`;

export class RaptorDevServer {
  private readonly dev: DevEngine;
  private readonly sources: Map<string, string>;
  private readonly entry: string;
  private readonly routes: RouteDef[] | undefined;
  private readonly hmrListeners: Set<(u: DevUpdate) => void>;
  private readonly onLog: (line: string) => void;
  private readonly debounce: Map<string, ReturnType<typeof setTimeout>>;
  private runtime: RaptorRuntime;
  private watcher: FSWatcher | null;
  private httpServer: Server | null;

  constructor(options: DevServerOptions) {
    this.dev = new DevEngine();
    this.sources = new Map();
    this.entry = resolve(options.entry);
    this.routes = options.routes;
    this.hmrListeners = new Set();
    this.onLog = options.onLog ?? (() => {});
    this.debounce = new Map();
    this.watcher = null;
    this.httpServer = null;

    for (const [path, source] of Object.entries(options.files)) {
      const abs = resolve(path);
      this.sources.set(abs, source);
      this.dev.update(abs, source); // seed (kind: load)
    }
    this.runtime = this.buildRuntime();
  }

  private buildRuntime(): RaptorRuntime {
    const source = this.sources.get(this.entry);
    if (!source) throw new Error(`[raptor:dev] entry necunoscut: ${this.entry}`);
    const result = buildModule(source, this.entry);
    return this.routes
      ? RaptorRuntime.fromBuild(result, { routes: this.routes })
      : RaptorRuntime.fromBuild(result);
  }

  /** Aboneaza-te la update-uri HMR; intoarce un unsubscribe. */
  onHmr(fn: (u: DevUpdate) => void): () => void {
    this.hmrListeners.add(fn);
    return () => this.hmrListeners.delete(fn);
  }

  /**
   * Aplica un edit (nucleul, determinist): diff incremental -> refresh SSR daca
   * e entry-ul -> broadcast HMR + log. Un no-op nu declanseaza nimic.
   */
  applyChange(path: string, source: string): DevUpdate {
    const abs = resolve(path);
    this.sources.set(abs, source);
    const update = this.dev.update(abs, source);
    if (update.kind === "noop") return update;
    if (abs === this.entry) {
      try {
        this.runtime = this.buildRuntime();
      } catch (err) {
        this.onLog(`[raptor:dev] eroare de build: ${(err as Error).message}`);
      }
    }
    this.onLog(formatUpdateLog(update));
    for (const fn of this.hmrListeners) fn(update);
    return update;
  }

  /** HTML de dev pentru o cale (SSR + scriptul client HMR injectat). */
  render(path: string): string | null {
    const ssr = this.runtime.ssr(path);
    if (!ssr) return null;
    const doc = renderDocument(ssr, ssr.resume.component);
    return doc.replace("</body>", `<script src="/@raptor/client.js"></script></body>`);
  }

  /** Porneste watching-ul pe un director (fs.watch recursiv). */
  watch(root: string): void {
    const base = resolve(root);
    this.watcher = watch(base, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const abs = resolve(join(base, filename.toString()));
      if (!abs.endsWith(".raptor")) return;
      // Debounce: coalescere de evenimente rapide (save = multiple ticks).
      const existing = this.debounce.get(abs);
      if (existing) clearTimeout(existing);
      this.debounce.set(
        abs,
        setTimeout(() => {
          this.debounce.delete(abs);
          try {
            this.applyChange(abs, readFileSync(abs, "utf8"));
          } catch {
            /* fisier in curs de scriere; urmatorul eveniment il prinde */
          }
        }, 30),
      );
    });
  }

  /** Porneste serverul HTTP de dev (SSR + SSE HMR). Rezolva cu portul efectiv. */
  listen(port = 0, host = "127.0.0.1"): Promise<number> {
    this.httpServer = createServer((req, res) => this.onHttp(req.url ?? "/", res));
    return new Promise((resolve2, reject) => {
      this.httpServer!.once("error", reject);
      this.httpServer!.listen(port, host, () => {
        const addr = this.httpServer!.address();
        resolve2(typeof addr === "object" && addr ? addr.port : port);
      });
    });
  }

  private onHttp(url: string, res: import("node:http").ServerResponse): void {
    const path = url.split("?")[0] ?? "/";

    if (path === "/@raptor/hmr") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": raptor hmr connected\n\n");
      const off = this.onHmr((u) => res.write(`data: ${JSON.stringify(u)}\n\n`));
      res.on("close", off);
      return;
    }
    if (path === "/@raptor/client.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(CLIENT_JS);
      return;
    }
    const html = this.render(path);
    if (!html) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  }

  /** Inchide watcher-ul, timerele si serverul HTTP (graceful). */
  close(): Promise<void> {
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
    this.hmrListeners.clear();
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    return new Promise((resolve2) => {
      if (this.httpServer) this.httpServer.close(() => resolve2());
      else resolve2();
    });
  }
}

/** Helper de test/CLI: citeste un SSE si intoarce primul obiect `data:`. */
export function readFirstSseEvent(url: string, timeoutMs = 4000): Promise<unknown> {
  return new Promise((resolve2, reject) => {
    const req = httpGet(url, (res) => {
      res.setEncoding("utf8");
      let buffer = "";
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const match = buffer.match(/data: (.*)\n\n/);
        if (match) {
          res.destroy();
          resolve2(JSON.parse(match[1]!));
        }
      });
    });
    req.on("error", reject);
    setTimeout(() => {
      req.destroy();
      reject(new Error("timeout SSE"));
    }, timeoutMs);
  });
}
