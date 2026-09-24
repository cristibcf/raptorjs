/**
 * Demo: aceeasi aplicatie ca unealta de linie de comanda.
 *
 *   node examples/cli-shell/src/demo.ts
 *
 * Ruleaza mai multe invocari peste un terminal fals, ca sa se vada si iesirea,
 * si codurile de iesire, si diferenta dintre un terminal interactiv si unul care
 * nu poate raspunde. Binarul adevarat este `src/bin.ts`.
 */
import { runOnce } from "./session.ts";
import type { Terminal } from "@raptor/cli-host";

interface Recorder {
  readonly terminal: Terminal;
  readonly out: string[];
  readonly err: string[];
}

function terminal(args: readonly string[], options: { interactive?: boolean; answer?: string } = {}): Recorder {
  const out: string[] = [];
  const err: string[] = [];
  const interactive = options.interactive ?? false;
  const base: Record<string, unknown> = {
    args,
    isTTY: interactive,
    interactive,
    columns: 60,
    color: false,
    write: (stream: "out" | "err", text: string) => (stream === "err" ? err : out).push(text.trimEnd()),
  };
  if (interactive) base["ask"] = async (): Promise<string> => options.answer ?? "n";
  return { terminal: base as unknown as Terminal, out, err };
}

const storage = new Map<string, string>();

async function invoke(label: string, args: readonly string[], options: { interactive?: boolean; answer?: string } = {}): Promise<void> {
  const recorder = terminal(args, options);
  const code = await runOnce({ terminal: recorder.terminal, storage });
  console.log(`\n$ raptor-notes ${args.join(" ")}${label ? `   (${label})` : ""}`);
  for (const line of recorder.out) console.log(`  ${line}`);
  for (const line of recorder.err) console.log(`  [err] ${line}`);
  console.log(`  -> cod de iesire ${code}`);
}

console.log("=== RaptorJS ca unealta de linie de comanda ===");

await invoke("", ["list"]);
await invoke("", ["add", "de", "cumparat", "lapte"]);
await invoke("", ["add", "de", "sunat", "la", "banca"]);
await invoke("", ["list"]);
await invoke("comanda gresita", ["scrie"]);

// Confirmarea: acelasi cod, doua terminale diferite.
await invoke("terminal interactiv, raspuns 'nu'", ["clear"], { interactive: true, answer: "n" });
await invoke("CI: intrarea nu e un terminal", ["clear"]);
await invoke("neinteractiv, dar cu --yes", ["clear", "--yes"]);
await invoke("", ["list"]);

console.log("\n-> Unealta nu atinge `process`: argumente, iesire, latimea");
console.log("   terminalului si confirmarea vin toate prin aceeasi punte.");
console.log("   Fara terminal interactiv, stergerea este refuzata, nu presupusa.");
