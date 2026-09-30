/**
 * Demo: the same application as a command-line tool.
 *
 *   node examples/cli-shell/src/demo.ts
 *
 * Runs several invocations over a fake terminal, so you can see the output, the
 * exit codes, and the difference between an interactive terminal and one that
 * cannot answer. The real binary is `src/bin.ts`.
 */
import { runOnce } from "./session.ts";
import type { Terminal } from "@raptor/host/cli";

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
  console.log(`  -> exit code ${code}`);
}

console.log("=== RaptorJS as a command-line tool ===");

await invoke("", ["list"]);
await invoke("", ["add", "buy", "milk"]);
await invoke("", ["add", "call", "the", "bank"]);
await invoke("", ["list"]);
await invoke("wrong command", ["write"]);

// The confirmation: the same code, two different terminals.
await invoke("interactive terminal, answer 'no'", ["clear"], { interactive: true, answer: "n" });
await invoke("CI: the input is not a terminal", ["clear"]);
await invoke("non-interactive, but with --yes", ["clear", "--yes"]);
await invoke("", ["list"]);

console.log("\n-> The tool does not touch `process`: arguments, output, terminal");
console.log("   width and the confirmation all come through the same bridge.");
console.log("   Without an interactive terminal, deletion is refused, not assumed.");
