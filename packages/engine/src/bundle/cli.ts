/**
 * RaptorBundle CLI. Two commands:
 *   raptor-bundle build <entry.tsx> [--out dist/bundle.js] [--html index.html]
 *   raptor-bundle dev   <entry.tsx> [--port 5173] [--host 127.0.0.1] [--root .] [--html index.html]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, cpSync, statSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { bundleApp } from "./bundle.ts";
import { startDevServer } from "./dev-server.ts";
import { rewriteHtml } from "./html.ts";

export interface BundleCliResult {
  ok: boolean;
  message: string;
  /** true if the process must stay alive (dev server). */
  keepAlive?: boolean;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const USAGE =
  "usage:\n" +
  "  raptor-bundle build <entry.tsx> [--out dist/bundle.js] [--html index.html] [--public public] [--no-treeshake]\n" +
  "  raptor-bundle dev   <entry.tsx> [--port 5173] [--host 127.0.0.1] [--root .] [--html index.html]";

export function runBundleCli(argv: string[]): BundleCliResult {
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (cmd === "build") {
    const entry = rest.find((a) => !a.startsWith("-"));
    if (!entry) return { ok: false, message: USAGE };
    const out = resolve(flag(rest, "--out") ?? "dist/bundle.js");
    const outDir = dirname(out);
    const treeshake = !rest.includes("--no-treeshake");
    const { code, files, shaken, css } = bundleApp(resolve(entry), { treeshake });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(out, code);

    // Stylesheet: write a sibling .css and remember its href for the HTML link.
    let cssHref: string | undefined;
    const notes: string[] = [];
    if (css.length > 0) {
      const cssOut = join(outDir, basename(out).replace(/\.[^.]+$/, "") + ".css");
      writeFileSync(cssOut, css);
      cssHref = "./" + basename(cssOut);
      notes.push(`${basename(cssOut)}`);
    }

    let extra = "";
    const htmlArg = flag(rest, "--html");
    if (htmlArg && existsSync(resolve(htmlArg))) {
      const html = rewriteHtml(readFileSync(resolve(htmlArg), "utf8"), "./" + basename(out), false, cssHref);
      const htmlOut = join(outDir, "index.html");
      writeFileSync(htmlOut, html);
      extra = ` + ${htmlOut}`;
    }

    // Static assets: copy the public/ directory verbatim into the output.
    const root = dirname(htmlArg ? resolve(htmlArg) : resolve(entry));
    const publicDir = resolve(flag(rest, "--public") ?? join(root, "public"));
    if (existsSync(publicDir) && statSync(publicDir).isDirectory()) {
      cpSync(publicDir, outDir, { recursive: true });
      notes.push(`public/ → ${outDir}`);
    }

    const shakeNote = shaken > 0 ? ` | tree-shaking: ${shaken} re-exports cut` : "";
    const assetNote = notes.length > 0 ? ` | ${notes.join(", ")}` : "";
    return {
      ok: true,
      message: `bundled ${files.length} modules → ${out} (${code.length} B)${extra}${shakeNote}${assetNote}`,
    };
  }

  if (cmd === "dev") {
    const entry = rest.find((a) => !a.startsWith("-"));
    if (!entry) return { ok: false, message: USAGE };
    const portRaw = flag(rest, "--port");
    startDevServer({
      entry: resolve(entry),
      root: flag(rest, "--root"),
      html: flag(rest, "--html"),
      port: portRaw ? Number(portRaw) : undefined,
      host: flag(rest, "--host"),
    });
    return { ok: true, message: "", keepAlive: true };
  }

  return { ok: false, message: USAGE };
}
