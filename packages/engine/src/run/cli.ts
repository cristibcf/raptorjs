/**
 * CLI RaptorRun (whitepaper RaptorEngine 5: `raptor run` / `raptor preview`).
 *
 * `ssr`/`info` sunt pure si testabile (intorc { code, out }); `serve` (blocking)
 * traieste in bin.ts. RaptorRun consuma un build RaptorEngine si il ruleaza.
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
        "  raptor-run ssr   <file.raptor> [path]   randeaza SSR pentru o cale",
        "  raptor-run info  <file.raptor>          sumar runtime (routes, server signals)",
        "  raptor-run serve <file.raptor> [--port N]   porneste server-ul Node",
      ].join("\n"),
    };
  }

  if (!file) return { code: 1, out: `eroare: ${command} cere <file.raptor>` };

  try {
    const result = buildModule(readFile(file), file);
    const runtime = RaptorRuntime.fromBuild(result);

    if (command === "ssr") {
      const path = argv[2] ?? "/";
      const ssr = runtime.ssr(path);
      if (!ssr) return { code: 1, out: `404: niciun route pentru '${path}'` };
      return { code: 0, out: renderDocument(ssr, ssr.resume.component) };
    }

    if (command === "info") {
      const producers = result.server.producers.map((p) => `${p.address}[${p.schema ?? "any"}]`);
      const addresses = result.wire.addresses.map((a) => `${a.logical}=${a.ras}`);
      return {
        code: 0,
        out: [
          `RaptorRun - ${file} (build ${result.manifest.engineVersion})`,
          `  componente: ${result.ir.components.map((c) => c.name).join(", ")}`,
          `  server signals: ${producers.join(", ") || "(niciunul)"}`,
          `  RAS addresses: ${addresses.join(", ") || "(niciuna)"}`,
          `  chunks: ${result.chunks.map((c) => c.name).join(", ")}`,
        ].join("\n"),
      };
    }

    return { code: 1, out: `comanda necunoscuta '${command}' (ssr|info|serve)` };
  } catch (err) {
    return { code: 1, out: `eroare: ${(err as Error).message}` };
  }
}

function defaultRead(path: string): string {
  return readFileSync(path, "utf8");
}
