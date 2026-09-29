import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createCliHost, terminalFromProcess } from "../../src/cli/index.ts";
import type { CliHost, ProcessLike, Terminal } from "../../src/cli/index.ts";

const BASE = {
  target: "cli",
  bundleId: "com.exemplu.unealta",
  displayName: "exemplu",
  version: "1.0.0",
  entry: "./src/bin.ts",
  capabilities: ["tty.interact"] as string[],
  allowedOrigins: [] as string[],
  deepLinkSchemes: [] as string[],
  update: { feed: null, channel: "stable" },
};

function manifestWith(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(JSON.stringify({ ...BASE, ...patch }));
}

interface Fake {
  readonly terminal: Terminal;
  readonly out: string[];
  readonly err: string[];
  readonly asked: string[];
  fireInterrupt(): void;
}

function fakeTerminal(args: readonly string[] = [], options: { interactive?: boolean; answer?: string } = {}): Fake {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const interrupts: Array<() => void> = [];
  const interactive = options.interactive ?? false;

  const terminal: Record<string, unknown> = {
    args,
    isTTY: interactive,
    interactive,
    columns: 72,
    color: false,
    write: (stream: "out" | "err", text: string) => (stream === "err" ? err : out).push(text),
    onInterrupt: (listener: () => void) => interrupts.push(listener),
  };
  if (interactive) {
    terminal["ask"] = async (question: string): Promise<string> => {
      asked.push(question);
      return options.answer ?? "";
    };
  }

  return {
    terminal: terminal as unknown as Terminal,
    out,
    err,
    asked,
    fireInterrupt: () => {
      for (const listener of [...interrupts]) listener();
    },
  };
}

interface Link {
  readonly app: HostBridge;
  readonly host: CliHost;
  readonly fake: Fake;
  dispose(): void;
}

function connect(manifest: HostManifest, fake: Fake, storage?: Map<string, string>): Link {
  const channel = createMemoryChannel();
  const host = createCliHost({
    manifest,
    transport: channel.host,
    terminal: fake.terminal,
    ...(storage ? { storage } : {}),
  });
  const app = createBridge({
    target: "cli",
    capabilities: manifest.capabilities,
    transport: channel.app,
    timeoutMs: 2000,
  });
  return {
    app,
    host,
    fake,
    dispose: () => {
      host.close();
      app.dispose("test");
    },
  };
}

test("adaptorul refuza un manifest care nu este de cli", () => {
  const desktop = requireHostManifest(JSON.stringify({ ...BASE, target: "desktop", capabilities: [] }));
  assert.throws(
    () => createCliHost({ manifest: desktop, transport: createMemoryChannel().host, terminal: fakeTerminal().terminal }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("o unealta nu are ferestre, ecrane, camera sau socketi de serviciu", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    for (const method of ["window.open", "menu.set", "camera.capture", "notify.show", "config.get"]) {
      assert.equal(link.app.allows(method), false, `${method} nu are ce cauta intr-o unealta`);
    }
    await assert.rejects(
      link.app.call("window.open", {}),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
  } finally {
    link.dispose();
  }
});

test("argumentele si fluxurile vin de la host, nu din process", async () => {
  const link = connect(manifestWith(), fakeTerminal(["add", "ceva"]));
  try {
    assert.deepEqual(await link.app.call("cli.args"), ["add", "ceva"]);

    await link.app.call("cli.write", { text: "gata\n" });
    await link.app.call("cli.write", { stream: "err", text: "atentie\n" });
    assert.deepEqual(link.fake.out, ["gata\n"]);
    assert.deepEqual(link.fake.err, ["atentie\n"]);
  } finally {
    link.dispose();
  }
});

test("informatiile despre terminal sunt raportate, nu ghicite", async () => {
  const link = connect(manifestWith(), fakeTerminal([], { interactive: true }));
  try {
    assert.deepEqual(await link.app.call("tty.info"), {
      isTTY: true,
      interactive: true,
      columns: 72,
      color: false,
    });
  } finally {
    link.dispose();
  }
});

test("codul de iesire il cere aplicatia si il tine host-ul", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    assert.equal(link.host.exitCode, null, "cat timp lucreaza, nu exista cod");
    await link.app.call("cli.exit", { code: 3 });
    assert.equal(link.host.exitCode, 3);
    assert.equal(await link.host.finished(), 3);
    assert.equal(link.host.lifecycle.state, "stopped");
  } finally {
    link.dispose();
  }
});

test("un cod de iesire invalid este refuzat inainte sa ajunga la proces", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    for (const code of [-1, 256, 1.5]) {
      await assert.rejects(link.app.call("cli.exit", { code }), /intreg intre 0 si 255/);
    }
    assert.equal(link.host.exitCode, null);
    await link.app.call("cli.exit", {});
    assert.equal(link.host.exitCode, 0, "fara cod explicit, iesirea este reusita");
  } finally {
    link.dispose();
  }
});

test("primul cod cerut este cel care conteaza", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    await link.app.call("cli.exit", { code: 2 });
    await link.app.call("cli.exit", { code: 0 });
    assert.equal(link.host.exitCode, 2);
  } finally {
    link.dispose();
  }
});

test("intrebarile cer capabilitatea tty.interact", async () => {
  const link = connect(manifestWith({ capabilities: [] }), fakeTerminal([], { interactive: true, answer: "da" }));
  try {
    assert.equal(link.app.allows("cli.prompt"), false);
    await assert.rejects(
      link.app.call("cli.prompt", { question: "Cum te cheama?" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
  } finally {
    link.dispose();
  }
});

test("fara terminal interactiv, intrebarea este refuzata - nu presupusa", async () => {
  // Cazul care conteaza: capabilitatea exista in manifest, dar terminalul nu
  // poate citi (CI, pipe, cron). Un "da" presupus aici ar fi o greseala grava.
  const link = connect(manifestWith(), fakeTerminal([], { interactive: false }));
  try {
    assert.equal(link.app.allows("cli.confirm"), true, "manifestul o permite");
    await assert.rejects(
      link.app.call("cli.confirm", { question: "Sterg tot?" }),
      (error: unknown) => {
        const hostError = error as { code: string; detail: Record<string, unknown> };
        assert.equal(hostError.code, "raptor:host/capability-unavailable");
        assert.equal(hostError.detail["interactive"], false);
        return true;
      },
    );
  } finally {
    link.dispose();
  }
});

test("confirmarea accepta doar raspunsuri afirmative explicite", async () => {
  for (const [answer, expected] of [["da", true], ["d", true], ["y", true], ["yes", true], ["", false], ["n", false], ["poate", false]] as const) {
    const link = connect(manifestWith(), fakeTerminal([], { interactive: true, answer }));
    try {
      const result = (await link.app.call("cli.confirm", { question: "Sterg tot?" })) as { confirmed: boolean };
      assert.equal(result.confirmed, expected, `raspunsul '${answer}' ar trebui sa dea ${expected}`);
      assert.match(link.fake.asked[0] ?? "", /\[d\/N\]/, "intrebarea arata care este implicitul");
    } finally {
      link.dispose();
    }
  }
});

test("Ctrl-C anunta aplicatia; a doua apasare opreste", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    const seen: number[] = [];
    link.app.on("cli.interrupt", (payload) => seen.push(Number(payload["attempt"])));

    link.fake.fireInterrupt();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(seen, [1], "prima intrerupere doar anunta");
    assert.equal(link.host.exitCode, null, "aplicatia apuca sa curete");

    link.fake.fireInterrupt();
    assert.equal(link.host.exitCode, 130, "a doua intrerupere opreste, cu codul obisnuit");
    assert.equal(await link.host.finished(), 130);
  } finally {
    link.dispose();
  }
});

test("o intrerupere dupa iesire nu mai schimba nimic", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    await link.app.call("cli.exit", { code: 0 });
    link.fake.fireInterrupt();
    link.fake.fireInterrupt();
    assert.equal(link.host.exitCode, 0);
  } finally {
    link.dispose();
  }
});

test("stocarea uneltei respecta aceeasi politica de chei", async () => {
  const storage = new Map<string, string>();
  const link = connect(manifestWith(), fakeTerminal(), storage);
  try {
    await link.app.call("storage.set", { key: "notes", value: "[]" });
    assert.equal(storage.get("notes"), "[]");
    for (const key of ["../alta", "sub/cale", ".ascuns", ""]) {
      await assert.rejects(link.app.call("storage.get", { key }), /cheie de stocare invalida|nu este sir/);
    }
  } finally {
    link.dispose();
  }
});

test("o unealta se actualizeaza prin managerul de pachete", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    assert.deepEqual(await link.app.call("update.check"), {
      available: false,
      version: "1.0.0",
      managedBy: "package-manager",
    });
    await assert.rejects(link.app.call("update.apply"), /managerul de pachete/);
  } finally {
    link.dispose();
  }
});

test("terminalul real citeste argumentele, TTY-ul si conventia NO_COLOR", () => {
  const written: string[] = [];
  const base: ProcessLike = {
    argv: ["/usr/bin/node", "/loc/bin.ts", "add", "ceva"],
    env: {},
    stdout: { write: (text: string) => written.push(text), isTTY: true, columns: 120 },
    stderr: { write: (text: string) => written.push(text), isTTY: true },
    stdin: { isTTY: true },
    on: () => undefined,
  };

  const terminal = terminalFromProcess(base);
  assert.deepEqual(terminal.args, ["add", "ceva"], "interpretorul si scriptul nu sunt argumente ale uneltei");
  assert.equal(terminal.columns, 120);
  assert.equal(terminal.interactive, true);
  assert.equal(terminal.color, true);
  assert.equal(typeof terminal.ask, "function");

  const noColor = terminalFromProcess({ ...base, env: { NO_COLOR: "1" } });
  assert.equal(noColor.color, false, "NO_COLOR stinge culoarea chiar si pe TTY");

  const piped = terminalFromProcess({ ...base, stdout: { write: () => undefined }, stdin: {} });
  assert.equal(piped.isTTY, false);
  assert.equal(piped.interactive, false);
  assert.equal(piped.color, false);
  assert.equal(piped.ask, undefined, "un terminal care nu poate citi nu pretinde ca poate");
  assert.equal(piped.columns, 80, "latime implicita rezonabila cand nu se stie");
});
