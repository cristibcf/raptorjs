/**
 * Dev server zero-dep (node:http): serveste index.html cu scriptul rescris spre
 * bundle, construieste bundle-ul la cerere, serveste asset-uri statice, face
 * fallback history pentru rutele SPA si live-reload prin SSE cand fs.watch
 * detecteaza o schimbare. Inlocuieste `vite`.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { join, extname, resolve, dirname } from "node:path";
import { bundleApp } from "./bundle.ts";
import { rewriteHtml } from "./html.ts";

export interface DevServerOptions {
  /** Entry .tsx/.ts (cale absoluta sau relativa la cwd). */
  entry: string;
  /** Radacina pentru index.html si asset-uri statice (implicit dirul entry-ului). */
  root?: string;
  /** Calea index.html (implicit <root>/index.html). */
  html?: string;
  /** Portul (implicit 5173). */
  port?: number;
  /**
   * Interfata pe care asculta (implicit `127.0.0.1`).
   *
   * Implicitul e deliberat local: un server de dezvoltare compileaza si serveste
   * fisiere din directorul tau de lucru, deci a-l lega pe toate interfetele il
   * expune retelei fara ca nimeni sa fi cerut asta. Cine chiar vrea sa-l
   * deschida (test pe telefon, container) trece `"0.0.0.0"` explicit.
   */
  host?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

const BUNDLE_PATH = "/__raptor_bundle.js";
const RELOAD_PATH = "/__raptor_reload";

export function startDevServer(options: DevServerOptions): Server {
  const entry = resolve(options.entry);
  const root = resolve(options.root ?? dirname(entry));
  const htmlPath = resolve(options.html ?? join(root, "index.html"));
  const port = options.port ?? 5173;
  const host = options.host ?? "127.0.0.1";
  const clients: ServerResponse[] = [];

  const sendIndex = (res: ServerResponse): void => {
    if (!existsSync(htmlPath)) {
      res.writeHead(404, { "content-type": MIME[".html"] });
      res.end(`<pre>index.html negasit la ${htmlPath}</pre>`);
      return;
    }
    const html = rewriteHtml(readFileSync(htmlPath, "utf8"), BUNDLE_PATH + "?t=" + Date.now(), true);
    res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
    res.end(html);
  };

  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0] ?? "/";

    if (url === RELOAD_PATH) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.push(res);
      req.on("close", () => {
        const i = clients.indexOf(res);
        if (i >= 0) clients.splice(i, 1);
      });
      return;
    }

    if (url === BUNDLE_PATH) {
      try {
        const { code } = bundleApp(entry, { sourceMap: true });
        res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-store" });
        res.end(code);
      } catch (err) {
        const msg = String((err as Error)?.stack ?? err);
        res.writeHead(200, { "content-type": MIME[".js"] });
        res.end(
          `document.body.innerHTML='<pre style="color:#b00;white-space:pre-wrap;padding:1rem">'+` +
            `${JSON.stringify(msg)}.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})+'</pre>';` +
            `console.error(${JSON.stringify(msg)});`,
        );
      }
      return;
    }

    if (url === "/" || url === "/index.html") {
      sendIndex(res);
      return;
    }

    // Asset static (nu servim surse .ts/.tsx: acelea trec prin bundle).
    const filePath = join(root, url);
    if (
      filePath.startsWith(root) &&
      existsSync(filePath) &&
      statSync(filePath).isFile() &&
      !/\.(tsx?|jsx?)$/.test(filePath)
    ) {
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(readFileSync(filePath));
      return;
    }

    // Fallback history: o ruta de client (`/learn`) primeste index.html, ca
    // deep-link-urile si refresh-ul pe subpagini sa nu cada pe 404. Cerem accept
    // text/html si absenta extensiei, ca un asset lipsa (`/logo.png`, un import
    // gresit) sa ramana 404 vizibil in loc sa primeasca HTML.
    const wantsHtml = (req.headers.accept ?? "").includes("text/html");
    const looksLikeFile = /\.[^/]+$/.test(url);
    if ((req.method === "GET" || req.method === "HEAD") && wantsHtml && !looksLikeFile) {
      sendIndex(res);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  // Live-reload: urmareste dirul entry-ului (recursiv) + radacina.
  const notify = (): void => {
    for (const c of clients) {
      try {
        c.write("data: reload\n\n");
      } catch {
        /* client inchis */
      }
    }
  };
  const watchers: FSWatcher[] = [];
  for (const dir of new Set([dirname(entry), root])) {
    try {
      watchers.push(watch(dir, { recursive: true }, notify));
    } catch {
      /* fs.watch recursiv indisponibil pe unele platforme */
    }
  }
  // Fara asta watcher-ele tin procesul viu dupa server.close().
  server.on("close", () => {
    for (const w of watchers) w.close();
  });

  server.listen(port, host, () => {
    // Nu `port`: cu 0 sistemul alege unul, si vrem sa-l tiparim pe cel real.
    const bound = (server.address() as { port: number } | null)?.port ?? port;
    const shown = host === "127.0.0.1" ? "localhost" : host;
    console.log(`RaptorBundle dev  →  http://${shown}:${bound}`);
    console.log(`  entry: ${entry}`);
    console.log(`  root : ${root}`);
    if (host !== "127.0.0.1") console.log(`  atentie: expus pe ${host}, nu doar local`);
  });
  return server;
}
