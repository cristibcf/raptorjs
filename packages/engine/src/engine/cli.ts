/**
 * raptor CLI (RaptorEngine whitepaper 5 + Appendix A).
 *
 * The public contract is the CLI, not the internal bundler. `runCli` is
 * testable: it takes argv + a file reader and returns { code, out }. `bin.ts`
 * wires it to process.argv and stdout.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildModule, buildModuleAsync } from "./build.ts";
import { DevEngine, formatUpdateLog } from "./dev.ts";
import { inspectGraph, formatOptimizationTrace, analyzeReport, invalidationTrace } from "./inspect.ts";
import { ENGINE_VERSION } from "./cache.ts";
import { loadLowLevelEngine, detectToolchain, type EngineName } from "./lowlevel.ts";
import type { UserConfig, BuildProfileValue, BuildTarget } from "./config.ts";

export interface CliResult {
  code: number;
  out: string;
}

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  const BOOL = new Set(["report", "no-fusion", "help", "minify"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOL.has(key)) flags.set(key, true);
      else flags.set(key, argv[++i] ?? "");
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function configFromFlags(flags: Map<string, string | boolean>): UserConfig {
  const cfg: UserConfig = {};
  const profile = flags.get("profile");
  if (typeof profile === "string" && profile) cfg.profile = profile as BuildProfileValue;
  const target = flags.get("target");
  if (typeof target === "string" && target) cfg.target = target as BuildTarget;
  if (flags.get("no-fusion")) cfg.build = { disableFusion: true };
  return cfg;
}

const HELP = `raptor v${ENGINE_VERSION} - RaptorEngine CLI

  raptor build <file.raptor> [--profile <name>] [--target web|server|edge] [--out <dir>] [--no-fusion]
                             [--engine naive|rolldown|auto] [--minify]
  raptor dev <file.raptor>            simulate a load cycle (dev engine)
  raptor inspect graph <file>         dump of the semantic graph
  raptor inspect optim <file>         optimization trace (DSE, Fusion)
  raptor inspect invalidate <file> <nodeId>   blast radius of a change
  raptor analyze <file>               bundle/signals/wire/cost summary
  raptor toolchain                    detect the low-level engine (Rolldown/Oxc)
  raptor --version`;

export function runCli(argv: string[], readFile: (p: string) => string = defaultRead): CliResult {
  const { positional, flags } = parseArgs(argv);

  if (flags.has("version") || positional[0] === "--version") {
    return { code: 0, out: `raptor ${ENGINE_VERSION}` };
  }
  if (flags.get("help") || positional.length === 0) {
    return { code: 0, out: HELP };
  }

  const command = positional[0];

  try {
    if (command === "build") {
      const file = positional[1];
      if (!file) return { code: 1, out: "error: build requires <file.raptor>" };
      const source = readFile(file);
      const result = buildModule(source, file, { config: configFromFlags(flags) });
      const out = flags.get("out");
      if (typeof out === "string" && out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/${result.ir.name}.browser.js`, result.browser);
        writeFileSync(`${out}/${result.ir.name}.server.js`, result.server.code);
        writeFileSync(`${out}/manifest.json`, JSON.stringify(result.manifest, null, 2));
        writeFileSync(`${out}/ras.manifest.json`, JSON.stringify(result.wire, null, 2));
      }
      const report = [
        `✓ build ${file} (profile ${result.config.profile}, target ${result.config.target})`,
        `  chunks: ${result.chunks.map((c) => c.name).join(", ")}`,
        `  eliminated ${result.manifest.metrics.eliminated}, fused ${result.manifest.metrics.fused}, DOM bindings ${result.manifest.metrics.domBindings}`,
        `  wire: ${result.wire.addresses.length} RAS addresses, ${result.wire.schemas.length} schemas`,
        `  inputsHash ${result.manifest.inputsHash.slice(0, 12)}…`,
      ];
      if (flags.get("report")) report.push("", formatOptimizationTrace(result.optimization));
      return { code: 0, out: report.join("\n") };
    }

    if (command === "dev") {
      const file = positional[1];
      if (!file) return { code: 1, out: "error: dev requires <file.raptor>" };
      const engine = new DevEngine();
      const update = engine.update(file, readFile(file));
      return { code: 0, out: formatUpdateLog(update) };
    }

    if (command === "inspect") {
      const sub = positional[1];
      const file = positional[2];
      if (!file) return { code: 1, out: "error: inspect requires <file.raptor>" };
      const result = buildModule(readFile(file), file);
      if (sub === "graph") return { code: 0, out: inspectGraph(result.graph) };
      if (sub === "optim") return { code: 0, out: formatOptimizationTrace(result.optimization) };
      if (sub === "invalidate") {
        const nodeId = positional[3];
        if (!nodeId) return { code: 1, out: "error: invalidate requires <nodeId>" };
        const trace = invalidationTrace(result.graph, nodeId);
        return { code: 0, out: `invalidate ${nodeId} -> ${trace.join(", ") || "(no nodes)"}` };
      }
      return { code: 1, out: "error: inspect <graph|optim|invalidate> <file>" };
    }

    if (command === "analyze") {
      const file = positional[1];
      if (!file) return { code: 1, out: "error: analyze requires <file.raptor>" };
      const result = buildModule(readFile(file), file);
      return { code: 0, out: analyzeReport(result) };
    }

    return { code: 1, out: `unknown command '${command}'\n\n${HELP}` };
  } catch (err) {
    return { code: 1, out: `error: ${(err as Error).message}` };
  }
}

function defaultRead(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Async variant: handles `raptor toolchain` and `raptor build` with the
 * low-level Rolldown/Oxc engine (`--engine`/`--minify`); the rest delegates to
 * the synchronous runCli.
 */
export async function runCliAsync(
  argv: string[],
  readFile: (p: string) => string = defaultRead,
): Promise<CliResult> {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0];

  if (command === "toolchain") {
    const tc = await detectToolchain();
    return {
      code: 0,
      out: [
        "raptor toolchain (low-level engine, §37)",
        `  rolldown: ${tc.rolldown ?? "absent (npm i -D rolldown)"}`,
        `  oxc:      ${tc.oxc ?? "absent (npm i -D oxc-minify)"}`,
        tc.rolldown ? "  -> production build uses Rolldown/Oxc" : "  -> fallback: naive engine (zero-dep)",
      ].join("\n"),
    };
  }

  const wantsLowLevel = command === "build" && (flags.has("engine") || flags.get("minify") === true);
  if (!wantsLowLevel) return runCli(argv, readFile);

  const file = positional[1];
  if (!file) return { code: 1, out: "error: build requires <file.raptor>" };
  try {
    const engineName = (typeof flags.get("engine") === "string" ? flags.get("engine") : "auto") as EngineName;
    const minify = flags.get("minify") === true;
    const engine = await loadLowLevelEngine(engineName, { minify, fallback: true });
    const result = await buildModuleAsync(readFile(file), file, {
      config: configFromFlags(flags),
      engine,
    });
    const out = flags.get("out");
    if (typeof out === "string" && out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(`${out}/${result.ir.name}.bundle.js`, result.bundleCode);
      writeFileSync(`${out}/manifest.json`, JSON.stringify(result.manifest, null, 2));
    }
    const tc = result.manifest.toolchain;
    return {
      code: 0,
      out: [
        `✓ build ${file} (engine ${engine.name}, minify ${minify})`,
        `  toolchain: ${Object.entries(tc).map(([k, v]) => `${k}=${v}`).join(", ")}`,
        `  bundle: ${result.bundleCode.length} bytes`,
        `  eliminated ${result.manifest.metrics.eliminated}, fused ${result.manifest.metrics.fused}`,
      ].join("\n"),
    };
  } catch (err) {
    return { code: 1, out: `error: ${(err as Error).message}` };
  }
}
