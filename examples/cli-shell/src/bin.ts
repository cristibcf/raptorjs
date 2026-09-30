#!/usr/bin/env node
/**
 * The real binary.
 *
 * The only place in the example that touches `process` - and even here it is not
 * the tool's code that does it, but the adapter: `terminalFromProcess` translates
 * the process into a terminal, and `process.exitCode` takes the value requested
 * through `cli.exit`.
 *
 * The notes are kept between runs in a file in the tool's configuration directory,
 * loaded before and written after - the host's storage is in memory precisely so
 * that persistence is a decision of whoever mounts the host.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createProcessSession } from "./session.ts";

const STORE = join(process.env["RAPTOR_NOTES_HOME"] ?? join(homedir(), ".raptor"), "notes.json");

async function load(): Promise<Map<string, string>> {
  try {
    return new Map(Object.entries(JSON.parse(await readFile(STORE, "utf8")) as Record<string, string>));
  } catch {
    return new Map();
  }
}

async function persist(storage: Map<string, string>): Promise<void> {
  await mkdir(dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify(Object.fromEntries(storage), null, 2) + "\n", "utf8");
}

const storage = await load();
const session = createProcessSession(process, storage);

try {
  const code = await session.cli.run();
  await session.bridge.call("cli.exit", { code });
  process.exitCode = await session.host.finished();
} finally {
  await persist(storage);
  session.close();
}
