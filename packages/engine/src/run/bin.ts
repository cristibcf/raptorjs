#!/usr/bin/env node
/**
 * Entry point `raptor-run`. `ssr`/`info` delegate to runRunCli; `serve` starts
 * a persistent Node server (blocking, with graceful shutdown on SIGINT).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { buildModule } from "@raptor/engine";
import { RaptorRuntime } from "./runtime.ts";
import { createNodeServer, listen, closeServer } from "./node.ts";
import { RaptorDevServer } from "./dev-server.ts";
import { runRunCli } from "./cli.ts";

const argv = process.argv.slice(2);

function portFrom(args: string[], fallback: number): number {
  const i = args.indexOf("--port");
  return i >= 0 ? Number(args[i + 1]) : fallback;
}

if (argv[0] === "dev") {
  const file = argv[1];
  if (!file) {
    process.stdout.write("error: dev requires <file.raptor>\n");
    process.exit(1);
  }
  const abs = resolve(file);
  const server = new RaptorDevServer({
    files: { [abs]: readFileSync(abs, "utf8") },
    entry: abs,
    onLog: (line) => process.stdout.write(line + "\n"),
  });
  server.watch(dirname(abs));
  const port = await server.listen(portFrom(argv, 5173));
  process.stdout.write(`RaptorDev live on http://127.0.0.1:${port}  (watch ${abs})\n`);

  const stop = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else if (argv[0] === "serve") {
  const file = argv[1];
  if (!file) {
    process.stdout.write("error: serve requires <file.raptor>\n");
    process.exit(1);
  }
  const portFlag = argv.indexOf("--port");
  const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : 3000;

  const result = buildModule(readFileSync(file, "utf8"), file);
  const runtime = RaptorRuntime.fromBuild(result);
  const server = createNodeServer(runtime);
  const actualPort = await listen(server, port);
  process.stdout.write(`RaptorRun serving ${file} on http://127.0.0.1:${actualPort}\n`);

  const stop = async (): Promise<void> => {
    runtime.shutdown();
    await closeServer(server);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else {
  const result = runRunCli(argv);
  process.stdout.write(result.out + "\n");
  process.exit(result.code);
}
