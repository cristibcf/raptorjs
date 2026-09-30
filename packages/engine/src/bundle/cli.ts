/**
 * RaptorBundle CLI. Two commands:
 *   raptor-bundle build <entry.tsx> [--out dist/bundle.js] [--html index.html]
 *   raptor-bundle dev   <entry.tsx> [--port 5173] [--host 127.0.0.1] [--root .] [--html index.html]
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
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
  "  raptor-bundle build <entry.tsx> [--out dist/bundle.js] [--html index.html] [--no-treeshake]\n" +
  "  raptor-bundle dev   <entry.tsx> [--port 5173] [--host 127.0.0.1] [--root .] [--html index.html]";

export function runBundleCli(argv: string[]): BundleCliResult {
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (cmd === "build") {
    const entry = rest.find((a) => !a.startsWith("-"));
    if (!entry) return { ok: false, message: USAGE };
    const out = resolve(flag(rest, "--out") ?? "dist/bundle.js");
    const treeshake = !rest.includes("--no-treeshake");
    const { code, files, shaken } = bundleApp(resolve(entry), { treeshake });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, code);

    let extra = "";
    const htmlArg = flag(rest, "--html");
    if (htmlArg && existsSync(resolve(htmlArg))) {
      const html = rewriteHtml(readFileSync(resolve(htmlArg), "utf8"), "./" + basename(out), false);
      const htmlOut = join(dirname(out), "index.html");
      writeFileSync(htmlOut, html);
      extra = ` + ${htmlOut}`;
    }
    const shakeNote = shaken > 0 ? ` | tree-shaking: ${shaken} re-exports cut` : "";
    return { ok: true, message: `bundled ${files.length} modules → ${out} (${code.length} B)${extra}${shakeNote}` };
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
