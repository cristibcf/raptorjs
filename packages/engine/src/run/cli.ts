/**
 * RaptorRun CLI (whitepaper RaptorEngine 5: `raptor run` / `raptor preview`).
 *
 * `ssr`/`info` are pure and testable (return { code, out }); `serve` (blocking)
 * lives in bin.ts. RaptorRun consumes a RaptorEngine build and runs it.
 */
import { readFileSync } from "node:fs";
import { buildModule } from "@raptor/engine";
import { RaptorRuntime } from "./runtime.ts";
import { renderDocument } from "./ssr.ts";

export interface RunCliResult {
  code: number;
  out: string;
}

export function runRunCli(argv: string[], readFile: (p: string) => string = defaultRead): RunCliResult {
  const command = argv[0];
  const file = argv[1];

  if (!command || command === "--help") {
    return {
      code: 0,
      out: [
        "raptor-run - RaptorRun (whitepaper RaptorEngine 19-21)",
        "  raptor-run ssr   <file.raptor> [path]   render SSR for a path",
        "  raptor-run info  <file.raptor>          runtime summary (routes, server signals)",
        "  raptor-run serve <file.raptor> [--port N]   start the Node server",
      ].join("\n"),
    };
  }

  if (!file) return { code: 1, out: `error: ${command} requires <file.raptor>` };

  try {
    const result = buildModule(readFile(file), file);
    const runtime = RaptorRuntime.fromBuild(result);

    if (command === "ssr") {
      const path = argv[2] ?? "/";
      const ssr = runtime.ssr(path);
      if (!ssr) return { code: 1, out: `404: no route for '${path}'` };
      return { code: 0, out: renderDocument(ssr, ssr.resume.component) };
    }

    if (command === "info") {
      const producers = result.server.producers.map((p) => `${p.address}[${p.schema ?? "any"}]`);
      const addresses = result.wire.addresses.map((a) => `${a.logical}=${a.ras}`);
      return {
        code: 0,
        out: [
          `RaptorRun - ${file} (build ${result.manifest.engineVersion})`,
          `  components: ${result.ir.components.map((c) => c.name).join(", ")}`,
          `  server signals: ${producers.join(", ") || "(none)"}`,
          `  RAS addresses: ${addresses.join(", ") || "(none)"}`,
          `  chunks: ${result.chunks.map((c) => c.name).join(", ")}`,
        ].join("\n"),
      };
    }

    return { code: 1, out: `unknown command '${command}' (ssr|info|serve)` };
  } catch (err) {
    return { code: 1, out: `error: ${(err as Error).message}` };
  }
}

function defaultRead(path: string): string {
  return readFileSync(path, "utf8");
}
