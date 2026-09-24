import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runOnce } from "../src/session.ts";
import type { Terminal } from "@raptor/cli-host";

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** O invocare completa a uneltei peste un terminal controlat de test. */
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

test("fara argumente, unealta arata ajutorul si iese cu cod de utilizare", async () => {
  const empty = await invoke([]);
  assert.equal(empty.code, 1);
  assert.match(empty.out, /raptor-notes list/);

  const help = await invoke(["list", "--help"]);
  assert.equal(help.code, 0, "ajutorul cerut explicit nu este o eroare");
});

test("add scrie prin stocarea host-ului, list o citeste", async () => {
  const storage = new Map<string, string>();
  const added = await invoke(["add", "de", "cumparat", "lapte"], { storage });
  assert.equal(added.code, 0);
  assert.match(added.out, /adaugat \(1 note\)/);
  assert.match(storage.get("notes") ?? "", /de cumparat lapte/);

  const listed = await invoke(["list"], { storage });
  assert.match(listed.out, /1\. de cumparat lapte/);
});

test("notele supravietuiesc intre invocari, pentru ca traiesc la host", async () => {
  const storage = new Map<string, string>();
  await invoke(["add", "prima"], { storage });
  await invoke(["add", "a doua"], { storage });
  const listed = await invoke(["list"], { storage });
  assert.match(listed.out, /1\. prima/);
  assert.match(listed.out, /2\. a doua/);
});

test("iesirea se aseaza dupa latimea raportata de terminal", async () => {
  const storage = new Map<string, string>();
  await invoke(["add", "o".repeat(200)], { storage });
  const listed = await invoke(["list"], { storage });
  for (const line of listed.out.trimEnd().split("\n")) {
    assert.ok(line.length <= 40, `linia depaseste latimea terminalului: ${line.length}`);
  }
  assert.match(listed.out, /…$/m, "textul taiat este marcat, nu trunchiat pe tacute");
});

test("intrarile gresite au coduri de iesire distincte", async () => {
  assert.equal((await invoke(["add"])).code, 2, "lipseste textul");
  assert.equal((await invoke(["scrie"])).code, 2, "comanda necunoscuta");
  assert.match((await invoke(["scrie"])).err, /comanda necunoscuta/);
  assert.equal((await invoke(["list"])).code, 0);
});

test("clear cere confirmare, iar un raspuns negativ nu sterge nimic", async () => {
  const storage = new Map<string, string>();
  await invoke(["add", "importanta"], { storage });

  const refuzat = await invoke(["clear"], { storage, interactive: true, answer: "n" });
  assert.equal(refuzat.code, 0);
  assert.match(refuzat.out, /anulat/);
  assert.match(storage.get("notes") ?? "", /importanta/, "nota este tot acolo");

  const acceptat = await invoke(["clear"], { storage, interactive: true, answer: "da" });
  assert.equal(acceptat.code, 0);
  assert.match(acceptat.out, /sters/);
  assert.equal(storage.get("notes"), "[]");
});

test("fara terminal interactiv, stergerea este refuzata cu un mesaj actionabil", async () => {
  // Cazul din CI: nu exista cine sa confirme. Unealta nu presupune "da" si nici
  // nu crapa - spune cum poate fi rulata.
  const storage = new Map<string, string>();
  await invoke(["add", "importanta"], { storage });

  const refuzat = await invoke(["clear"], { storage, interactive: false });
  assert.equal(refuzat.code, 3);
  assert.match(refuzat.err, /--yes/);
  assert.match(storage.get("notes") ?? "", /importanta/, "nimic nu s-a sters");

  const fortat = await invoke(["clear", "--yes"], { storage, interactive: false });
  assert.equal(fortat.code, 0);
  assert.equal(storage.get("notes"), "[]");
});

test("fara capabilitatea tty.interact, unealta nici nu incearca sa intrebe", async () => {
  const storage = new Map<string, string>();
  await invoke(["add", "importanta"], { storage, capabilities: [] });

  const refuzat = await invoke(["clear"], { storage, capabilities: [], interactive: true, answer: "da" });
  assert.equal(refuzat.code, 3, "manifestul nu ii da voie, deci nu intreaba nici pe un terminal bun");
  assert.match(refuzat.err, /nu are voie sa intrebe/);
});

test("clear pe o lista goala nu cere confirmare degeaba", async () => {
  const gol = await invoke(["clear"], { interactive: false });
  assert.equal(gol.code, 0);
  assert.match(gol.out, /nimic de sters/);
});

test("binarul real ruleaza ca proces separat si pastreaza notele pe disc", async () => {
  const run = promisify(execFile);
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "bin.ts");
  const home = mkdtempSync(join(tmpdir(), "raptor-notes-"));
  const env = { ...process.env, RAPTOR_NOTES_HOME: home };

  try {
    const added = await run(process.execPath, [bin, "add", "din alt proces"], { env });
    assert.match(added.stdout, /adaugat \(1 note\)/);

    const listed = await run(process.execPath, [bin, "list"], { env });
    assert.match(listed.stdout, /1\. din alt proces/, "a doua invocare vede ce a scris prima");

    // stdin-ul unui proces copil nu este terminal, deci confirmarea pica - exact
    // comportamentul din CI, verificat pe un proces adevarat.
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
