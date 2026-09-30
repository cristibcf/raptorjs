import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createCliHost, terminalFromProcess } from "../../src/cli/index.ts";
import type { CliHost, ProcessLike, Terminal } from "../../src/cli/index.ts";

const BASE = {
  target: "cli",
  bundleId: "com.example.tool",
  displayName: "example",
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

test("the adapter rejects a manifest that is not for cli", () => {
  const desktop = requireHostManifest(JSON.stringify({ ...BASE, target: "desktop", capabilities: [] }));
  assert.throws(
    () => createCliHost({ manifest: desktop, transport: createMemoryChannel().host, terminal: fakeTerminal().terminal }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("a tool has no windows, screens, camera or service sockets", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    for (const method of ["window.open", "menu.set", "camera.capture", "notify.show", "config.get"]) {
      assert.equal(link.app.allows(method), false, `${method} has no place in a tool`);
    }
    await assert.rejects(
      link.app.call("window.open", {}),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-unavailable",
    );
  } finally {
    link.dispose();
  }
});

test("the arguments and streams come from the host, not from process", async () => {
  const link = connect(manifestWith(), fakeTerminal(["add", "something"]));
  try {
    assert.deepEqual(await link.app.call("cli.args"), ["add", "something"]);

    await link.app.call("cli.write", { text: "done\n" });
    await link.app.call("cli.write", { stream: "err", text: "warning\n" });
    assert.deepEqual(link.fake.out, ["done\n"]);
    assert.deepEqual(link.fake.err, ["warning\n"]);
  } finally {
    link.dispose();
  }
});

test("the terminal info is reported, not guessed", async () => {
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

test("the exit code is requested by the app and held by the host", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    assert.equal(link.host.exitCode, null, "while it works, there is no code");
    await link.app.call("cli.exit", { code: 3 });
    assert.equal(link.host.exitCode, 3);
    assert.equal(await link.host.finished(), 3);
    assert.equal(link.host.lifecycle.state, "stopped");
  } finally {
    link.dispose();
  }
});

test("an invalid exit code is rejected before it reaches the process", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    for (const code of [-1, 256, 1.5]) {
      await assert.rejects(link.app.call("cli.exit", { code }), /integer between 0 and 255/);
    }
    assert.equal(link.host.exitCode, null);
    await link.app.call("cli.exit", {});
    assert.equal(link.host.exitCode, 0, "without an explicit code, the exit succeeds");
  } finally {
    link.dispose();
  }
});

test("the first requested code is the one that counts", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    await link.app.call("cli.exit", { code: 2 });
    await link.app.call("cli.exit", { code: 0 });
    assert.equal(link.host.exitCode, 2);
  } finally {
    link.dispose();
  }
});

test("questions require the tty.interact capability", async () => {
  const link = connect(manifestWith({ capabilities: [] }), fakeTerminal([], { interactive: true, answer: "da" }));
  try {
    assert.equal(link.app.allows("cli.prompt"), false);
    await assert.rejects(
      link.app.call("cli.prompt", { question: "What is your name?" }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
  } finally {
    link.dispose();
  }
});

test("without an interactive terminal, the question is denied - not assumed", async () => {
  // The case that matters: the capability exists in the manifest, but the
  // terminal cannot read (CI, pipe, cron). An assumed "yes" here would be a
  // grave mistake.
  const link = connect(manifestWith(), fakeTerminal([], { interactive: false }));
  try {
    assert.equal(link.app.allows("cli.confirm"), true, "the manifest allows it");
    await assert.rejects(
      link.app.call("cli.confirm", { question: "Delete everything?" }),
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

test("confirmation accepts only explicit affirmative answers", async () => {
  for (const [answer, expected] of [["da", true], ["d", true], ["y", true], ["yes", true], ["", false], ["n", false], ["maybe", false]] as const) {
    const link = connect(manifestWith(), fakeTerminal([], { interactive: true, answer }));
    try {
      const result = (await link.app.call("cli.confirm", { question: "Delete everything?" })) as { confirmed: boolean };
      assert.equal(result.confirmed, expected, `the answer '${answer}' should give ${expected}`);
      assert.match(link.fake.asked[0] ?? "", /\[y\/N\]/, "the question shows which is the default");
    } finally {
      link.dispose();
    }
  }
});

test("Ctrl-C notifies the app; the second press stops it", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    const seen: number[] = [];
    link.app.on("cli.interrupt", (payload) => seen.push(Number(payload["attempt"])));

    link.fake.fireInterrupt();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(seen, [1], "the first interrupt only notifies");
    assert.equal(link.host.exitCode, null, "the app gets to clean up");

    link.fake.fireInterrupt();
    assert.equal(link.host.exitCode, 130, "the second interrupt stops it, with the usual code");
    assert.equal(await link.host.finished(), 130);
  } finally {
    link.dispose();
  }
});

test("an interrupt after exit no longer changes anything", async () => {
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

test("the tool's storage honors the same key policy", async () => {
  const storage = new Map<string, string>();
  const link = connect(manifestWith(), fakeTerminal(), storage);
  try {
    await link.app.call("storage.set", { key: "notes", value: "[]" });
    assert.equal(storage.get("notes"), "[]");
    for (const key of ["../other", "sub/path", ".hidden", ""]) {
      await assert.rejects(link.app.call("storage.get", { key }), /invalid storage key|is not a string/);
    }
  } finally {
    link.dispose();
  }
});

test("a tool updates through the package manager", async () => {
  const link = connect(manifestWith(), fakeTerminal());
  try {
    assert.deepEqual(await link.app.call("update.check"), {
      available: false,
      version: "1.0.0",
      managedBy: "package-manager",
    });
    await assert.rejects(link.app.call("update.apply"), /package manager/);
  } finally {
    link.dispose();
  }
});

test("the real terminal reads the arguments, the TTY and the NO_COLOR convention", () => {
  const written: string[] = [];
  const base: ProcessLike = {
    argv: ["/usr/bin/node", "/loc/bin.ts", "add", "something"],
    env: {},
    stdout: { write: (text: string) => written.push(text), isTTY: true, columns: 120 },
    stderr: { write: (text: string) => written.push(text), isTTY: true },
    stdin: { isTTY: true },
    on: () => undefined,
  };

  const terminal = terminalFromProcess(base);
  assert.deepEqual(terminal.args, ["add", "something"], "the interpreter and the script are not the tool's arguments");
  assert.equal(terminal.columns, 120);
  assert.equal(terminal.interactive, true);
  assert.equal(terminal.color, true);
  assert.equal(typeof terminal.ask, "function");

  const noColor = terminalFromProcess({ ...base, env: { NO_COLOR: "1" } });
  assert.equal(noColor.color, false, "NO_COLOR turns off color even on a TTY");

  const piped = terminalFromProcess({ ...base, stdout: { write: () => undefined }, stdin: {} });
  assert.equal(piped.isTTY, false);
  assert.equal(piped.interactive, false);
  assert.equal(piped.color, false);
  assert.equal(piped.ask, undefined, "a terminal that cannot read does not pretend it can");
  assert.equal(piped.columns, 80, "a reasonable default width when it is unknown");
});
