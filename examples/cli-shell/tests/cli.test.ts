import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runOnce } from "../src/session.ts";
import type { Terminal } from "@raptor/host/cli";

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** A complete invocation of the tool over a test-controlled terminal. */
async function invoke(
  args: readonly string[],
  options: { interactive?: boolean; answer?: string; storage?: Map<string, string>; capabilities?: readonly string[] } = {},
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const interactive = options.interactive ?? false;
  const terminal: Record<string, unknown> = {
    args,
    isTTY: interactive,
    interactive,
    columns: 40,
    color: false,
    write: (stream: "out" | "err", text: string) => (stream === "err" ? err : out).push(text),
  };
  if (interactive) terminal["ask"] = async (): Promise<string> => options.answer ?? "n";

  const code = await runOnce({
    terminal: terminal as unknown as Terminal,
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
  });
  return { code, out: out.join(""), err: err.join("") };
}

test("without arguments, the tool shows help and exits with a usage code", async () => {
  const empty = await invoke([]);
  assert.equal(empty.code, 1);
  assert.match(empty.out, /raptor-notes list/);

  const help = await invoke(["list", "--help"]);
  assert.equal(help.code, 0, "help requested explicitly is not an error");
});

test("add writes through the host's storage, list reads it back", async () => {
  const storage = new Map<string, string>();
  const added = await invoke(["add", "buy", "milk"], { storage });
  assert.equal(added.code, 0);
  assert.match(added.out, /added \(1 notes\)/);
  assert.match(storage.get("notes") ?? "", /buy milk/);

  const listed = await invoke(["list"], { storage });
  assert.match(listed.out, /1\. buy milk/);
});

test("notes survive between invocations, because they live at the host", async () => {
  const storage = new Map<string, string>();
  await invoke(["add", "first"], { storage });
  await invoke(["add", "second"], { storage });
  const listed = await invoke(["list"], { storage });
  assert.match(listed.out, /1\. first/);
  assert.match(listed.out, /2\. second/);
});

test("the output lays out according to the width reported by the terminal", async () => {
  const storage = new Map<string, string>();
  await invoke(["add", "o".repeat(200)], { storage });
  const listed = await invoke(["list"], { storage });
  for (const line of listed.out.trimEnd().split("\n")) {
    assert.ok(line.length <= 40, `the line exceeds the terminal width: ${line.length}`);
  }
  assert.match(listed.out, /…$/m, "the truncated text is marked, not silently cut off");
});

test("wrong inputs have distinct exit codes", async () => {
  assert.equal((await invoke(["add"])).code, 2, "the text is missing");
  assert.equal((await invoke(["write"])).code, 2, "unknown command");
  assert.match((await invoke(["write"])).err, /unknown command/);
  assert.equal((await invoke(["list"])).code, 0);
});

test("clear asks for confirmation, and a negative answer deletes nothing", async () => {
  const storage = new Map<string, string>();
  await invoke(["add", "important"], { storage });

  const refuzat = await invoke(["clear"], { storage, interactive: true, answer: "n" });
  assert.equal(refuzat.code, 0);
  assert.match(refuzat.out, /cancelled/);
  assert.match(storage.get("notes") ?? "", /important/, "the note is still there");

  const acceptat = await invoke(["clear"], { storage, interactive: true, answer: "yes" });
  assert.equal(acceptat.code, 0);
  assert.match(acceptat.out, /deleted/);
  assert.equal(storage.get("notes"), "[]");
});

test("without an interactive terminal, deletion is refused with an actionable message", async () => {
  // The CI case: there is no one to confirm. The tool does not assume "yes" and
  // does not crash - it says how it can be run.
  const storage = new Map<string, string>();
  await invoke(["add", "important"], { storage });

  const refuzat = await invoke(["clear"], { storage, interactive: false });
  assert.equal(refuzat.code, 3);
  assert.match(refuzat.err, /--yes/);
  assert.match(storage.get("notes") ?? "", /important/, "nothing was deleted");

  const fortat = await invoke(["clear", "--yes"], { storage, interactive: false });
  assert.equal(fortat.code, 0);
  assert.equal(storage.get("notes"), "[]");
});

test("without the tty.interact capability, the tool does not even try to ask", async () => {
  const storage = new Map<string, string>();
  await invoke(["add", "important"], { storage, capabilities: [] });

  const refuzat = await invoke(["clear"], { storage, capabilities: [], interactive: true, answer: "yes" });
  assert.equal(refuzat.code, 3, "the manifest does not allow it, so it does not ask even on a good terminal");
  assert.match(refuzat.err, /not allowed to ask/);
});

test("clear on an empty list does not ask for confirmation for nothing", async () => {
  const gol = await invoke(["clear"], { interactive: false });
  assert.equal(gol.code, 0);
  assert.match(gol.out, /nothing to delete/);
});

test("the real binary runs as a separate process and keeps the notes on disk", async () => {
  const run = promisify(execFile);
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "bin.ts");
  const home = mkdtempSync(join(tmpdir(), "raptor-notes-"));
  const env = { ...process.env, RAPTOR_NOTES_HOME: home };

  try {
    const added = await run(process.execPath, [bin, "add", "from another process"], { env });
    assert.match(added.stdout, /added \(1 notes\)/);

    const listed = await run(process.execPath, [bin, "list"], { env });
    assert.match(listed.stdout, /1\. from another process/, "the second invocation sees what the first wrote");

    // A child process's stdin is not a terminal, so the confirmation fails - exactly
    // the CI behavior, verified on a real process.
    await assert.rejects(
      run(process.execPath, [bin, "clear"], { env }),
      (error: unknown) => {
        const failure = error as { code?: number; stderr?: string };
        assert.equal(failure.code, 3);
        assert.match(failure.stderr ?? "", /--yes/);
        return true;
      },
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
