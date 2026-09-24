#!/usr/bin/env node
/**
 * Binarul real.
 *
 * Singurul loc din exemplu care atinge `process` - si nici aici nu o face codul
 * uneltei, ci adaptorul: `terminalFromProcess` traduce procesul intr-un terminal,
 * iar `process.exitCode` ia valoarea ceruta prin `cli.exit`.
 *
 * Notele se pastreaza intre rulari intr-un fisier din directorul de configuratie
 * al uneltei, incarcat inainte si scris dupa - stocarea host-ului este in memorie
 * tocmai ca persistenta sa fie o decizie a celui care monteaza host-ul.
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
