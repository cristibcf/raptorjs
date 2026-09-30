/**
 * Zero-dep dev server (node:http): serves index.html with the script rewritten to
 * the bundle, builds the bundle on demand, serves static assets, does history
 * fallback for SPA routes and live-reload over SSE when fs.watch detects a change.
 * Replaces `vite`.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { join, extname, resolve, dirname, sep } from "node:path";
import { bundleApp } from "./bundle.ts";
import { rewriteHtml } from "./html.ts";

export interface DevServerOptions {
  /** Entry .tsx/.ts (absolute path or relative to cwd). */
  entry: string;
  /** Root for index.html and static assets (defaults to the entry's directory). */
  root?: string;
  /** The index.html path (defaults to <root>/index.html). */
  html?: string;
  /** The port (defaults to 5173). */
  port?: number;
  /**
   * The interface it listens on (defaults to `127.0.0.1`).
   *
   * The default is deliberately local: a dev server compiles and serves files
   * from your working directory, so binding it on all interfaces exposes it to
   * the network without anyone having asked for that. Whoever actually wants to
   * open it up (testing on a phone, a container) passes `"0.0.0.0"` explicitly.
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

/** Windows compares paths case-insensitively. */
const CASE_INSENSITIVE = sep === "\\";

/**
 * The on-disk path of a requested asset, or `null` if the request is not allowed.
 *
 * Three rules, each for a real hole:
 *
 * 1. **We decode the path.** `req.url` is the raw target from the request,
 *    undecoded. Without this step, `/logo%20mic.png` looks for a file with `%20`
 *    in its name and returns 404.
 *
 * 2. **Containment is checked per segment, not by string prefix.** `startsWith`
 *    looked correct and wasn't: with root `.../site`, the request `/../site-private/.env`
 *    yields a path that does start with the root, so it passed. This is exactly the
 *    mistake fixed in `server/store.ts` at the previous audit, resurfaced here.
 *
 * 3. **We serve nothing that starts with a dot, and no source.** `.env`, `.git/`
 *    and the `raptor.runtime.json` with capabilities have no business on the wire,
 *    not even on `localhost`; `.ts`/`.tsx` sources go through the bundle anyway.
 */
function resolveAsset(root: string, url: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // Invalid percent sequence: a malformed request, not an asset.
    return null;
  }
  // NUL truncates the string in system calls: `/a.png\0.ts` would bypass the filter.
  if (decoded.includes("\0")) return null;

  const segments = decoded.split(/[/\\]+/).filter((part) => part.length > 0);
  if (segments.some((part) => part.startsWith("."))) return null;
  if (/\.(tsx?|jsx?)$/.test(decoded)) return null;

  const candidate = resolve(root, ...segments);
  const scope = CASE_INSENSITIVE ? root.toLowerCase() : root;
  const target = CASE_INSENSITIVE ? candidate.toLowerCase() : candidate;
  if (target !== scope && !target.startsWith(scope.endsWith(sep) ? scope : scope + sep)) return null;
  return candidate;
}

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
      res.end(`<pre>index.html not found at ${htmlPath}</pre>`);
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

    // Static asset (we don't serve .ts/.tsx sources: those go through the bundle).
    const filePath = resolveAsset(root, url);
    if (filePath !== null && existsSync(filePath) && statSync(filePath).isFile()) {
      res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(readFileSync(filePath));
      return;
    }

    // History fallback: a client route (`/learn`) gets index.html, so that
    // deep-links and refreshes on subpages don't fall to 404. We require an
    // accept of text/html and the absence of an extension, so that a missing
    // asset (`/logo.png`, a wrong import) stays a visible 404 instead of getting HTML.
    const wantsHtml = (req.headers.accept ?? "").includes("text/html");
    const looksLikeFile = /\.[^/]+$/.test(url);
    if ((req.method === "GET" || req.method === "HEAD") && wantsHtml && !looksLikeFile) {
      sendIndex(res);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  // Live-reload: watches the entry's directory (recursively) + the root.
  const notify = (): void => {
    for (const c of clients) {
      try {
        c.write("data: reload\n\n");
      } catch {
        /* client closed */
      }
    }
  };
  const watchers: FSWatcher[] = [];
  for (const dir of new Set([dirname(entry), root])) {
    try {
      watchers.push(watch(dir, { recursive: true }, notify));
    } catch {
      /* recursive fs.watch unavailable on some platforms */
    }
  }
  // Without this the watchers keep the process alive after server.close().
  server.on("close", () => {
    for (const w of watchers) w.close();
  });

  server.listen(port, host, () => {
    // Not `port`: with 0 the system picks one, and we want to print the real one.
    const bound = (server.address() as { port: number } | null)?.port ?? port;
    const shown = host === "127.0.0.1" ? "localhost" : host;
    console.log(`RaptorBundle dev  →  http://${shown}:${bound}`);
    console.log(`  entry: ${entry}`);
    console.log(`  root : ${root}`);
    if (host !== "127.0.0.1") console.log(`  warning: exposed on ${host}, not just local`);
  });
  return server;
}
