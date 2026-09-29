import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createDeviceHost } from "../../src/device/index.ts";
import type { Board, DeviceHost, DeviceHostOptions } from "../../src/device/index.ts";

const BASE = {
  target: "embedded",
  bundleId: "com.exemplu.placheta",
  displayName: "Exemplu Placheta",
  version: "1.0.0",
  entry: "./src/app.ts",
  capabilities: ["hw.gpio", "hw.bus", "power.sleep"] as string[],
  allowedOrigins: [] as string[],
  deepLinkSchemes: [] as string[],
  update: { feed: null, channel: "stable" },
};

function manifestWith(patch: Record<string, unknown> = {}): HostManifest {
  return requireHostManifest(JSON.stringify({ ...BASE, ...patch }));
}

interface Fake extends Board {
  readonly writes: Array<{ pin: number; value: boolean }>;
  readonly resets: string[];
  readonly sleeps: number[];
  /** Termina somnul in curs; disponibil doar cu `blockSleep`. */
  finishSleep(): void;
}

/**
 * `blockSleep` face somnul sa tina pana cand testul il termina explicit - fara
 * el, placheta s-ar trezi in aceeasi microtask si nu s-ar putea observa deloc
 * ce se intampla *in timpul* somnului.
 */
function fakeBoard(options: { blockSleep?: boolean } = {}): Fake {
  const writes: Array<{ pin: number; value: boolean }> = [];
  const resets: string[] = [];
  const sleeps: number[] = [];
  let release: ((reason: "timer" | "external") => void) | null = null;
  return {
    writes,
    resets,
    sleeps,
    finishSleep: () => {
      release?.("timer");
      release = null;
    },
    identity: { chip: "sim32", firmware: "1.0.0", resetReason: "power-on" },
    readNextPin: () => true,
    writePin: (pin, value) => {
      writes.push({ pin, value });
    },
    transfer: (_bus, _address, _write, readLength) => new Uint8Array(readLength).fill(0x2a),
    freeHeap: () => 40_000,
    reset: (reason) => {
      resets.push(reason);
    },
    sleep: async (durationMs) => {
      sleeps.push(durationMs);
      if (!options.blockSleep) return "timer";
      return await new Promise<"timer" | "external">((resolve) => {
        release = resolve;
      });
    },
  };
}

interface Link {
  readonly app: HostBridge;
  readonly host: DeviceHost;
  readonly board: Fake;
  dispose(): void;
}

function connect(manifest: HostManifest, options: Partial<DeviceHostOptions> = {}): Link {
  const channel = createMemoryChannel();
  const board = (options.board as Fake | undefined) ?? fakeBoard();
  const host = createDeviceHost({
    // Ceas inghetat: singura sursa de timp ramane `host.tick(ms)`.
    //
    // Fara asta, `now()` este `Date.now() + offset`, deci milisecundele reale
    // scurse intre doua linii de test intra in socoteala watchdog-ului. Testul
    // "watchdog-ul nu curge in somn" cerea exact 1000 ms ramasi dupa trezire si
    // primea 999 ori de cate ori masina era ocupata - o picare care nu are nimic
    // de-a face cu ce verifica testul.
    now: () => 0,
    pins: [
      { pin: 2, direction: "out", label: "led" },
      { pin: 5, direction: "in", label: "buton" },
    ],
    buses: [{ bus: "i2c0", addresses: [0x48] }],
    watchdogMs: 1000,
    ...options,
    manifest,
    transport: channel.host,
    board,
  });
  const app = createBridge({
    target: "embedded",
    capabilities: manifest.capabilities,
    transport: channel.app,
    timeoutMs: 2000,
  });
  return { app, host, board, dispose: () => { host.close(); app.dispose("test"); } };
}

test("adaptorul refuza un manifest care nu este de embedded", () => {
  const cli = requireHostManifest(JSON.stringify({ ...BASE, target: "cli", capabilities: [] }));
  assert.throws(
    () => createDeviceHost({ manifest: cli, transport: createMemoryChannel().host, board: fakeBoard() }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("o placheta nu are ferestre, procese, terminal sau notificari", async () => {
  const link = connect(manifestWith());
  try {
    for (const method of ["window.open", "process.spawn", "cli.prompt", "notify.show", "config.get"]) {
      assert.equal(link.app.allows(method), false, `${method} nu are ce cauta pe o placheta`);
    }
  } finally {
    link.dispose();
  }
});

test("un pin nedeclarat nu poate fi atins, in nicio directie", async () => {
  const link = connect(manifestWith());
  try {
    await assert.rejects(link.app.call("hw.gpio.write", { pin: 13, value: true }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/capability-undeclared");
      assert.deepEqual(hostError.detail["declared"], [2, 5]);
      return true;
    });
    await assert.rejects(link.app.call("hw.gpio.read", { pin: 13 }), /nu este in harta de hardware/);
    assert.deepEqual(link.board.writes, [], "nimic nu a ajuns la hardware");
  } finally {
    link.dispose();
  }
});

test("directia pinului este respectata: o intrare nu poate fi scrisa", async () => {
  const link = connect(manifestWith());
  try {
    await assert.rejects(link.app.call("hw.gpio.write", { pin: 5, value: true }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/capability-unavailable");
      assert.equal(hostError.detail["label"], "buton");
      return true;
    });
    await assert.rejects(link.app.call("hw.gpio.read", { pin: 2 }), /declarat ca 'out'/);
    assert.deepEqual(link.board.writes, []);

    await link.app.call("hw.gpio.write", { pin: 2, value: true });
    assert.deepEqual(link.board.writes, [{ pin: 2, value: true }]);
    assert.equal(link.host.pinState(2), true);
  } finally {
    link.dispose();
  }
});

test("fara capabilitatea hw.gpio, pinii nu exista deloc", async () => {
  const link = connect(manifestWith({ capabilities: ["hw.bus"] }));
  try {
    assert.equal(link.app.allows("hw.gpio.write"), false);
    await assert.rejects(
      link.app.call("hw.gpio.write", { pin: 2, value: true }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
  } finally {
    link.dispose();
  }
});

test("pe magistrala se atinge doar adresa declarata", async () => {
  const link = connect(manifestWith());
  try {
    const answer = (await link.app.call("hw.bus.transfer", {
      bus: "i2c0",
      address: 0x48,
      write: [0x00],
      readLength: 2,
    })) as { read: number[] };
    assert.deepEqual(answer.read, [0x2a, 0x2a]);

    await assert.rejects(
      link.app.call("hw.bus.transfer", { bus: "i2c0", address: 0x50, readLength: 1 }),
      /adresa 0x50 nu este declarata/,
    );
    await assert.rejects(link.app.call("hw.bus.transfer", { bus: "spi0", address: 0x48 }), /nu este declarata/);
  } finally {
    link.dispose();
  }
});

test("watchdog-ul reseteaza placheta cand aplicatia nu mai da semne de viata", async () => {
  const link = connect(manifestWith(), { watchdogMs: 1000 });
  try {
    await link.app.call("watchdog.pet");
    assert.equal(link.host.watchdogRemainingMs, 1000);

    link.host.tick(600);
    assert.equal(link.host.watchdogRemainingMs, 400, "fereastra se consuma");
    assert.deepEqual(link.board.resets, []);

    link.host.tick(500);
    assert.deepEqual(link.board.resets, ["watchdog"], "placheta chiar a fost resetata");
    assert.equal(link.host.lifecycle.state, "stopped");
    assert.equal(link.host.watchdogRemainingMs, null);
  } finally {
    link.dispose();
  }
});

test("o aplicatie care da semne de viata nu este resetata", async () => {
  const link = connect(manifestWith(), { watchdogMs: 1000 });
  try {
    for (let step = 0; step < 5; step += 1) {
      link.host.tick(600);
      await link.app.call("watchdog.pet");
    }
    assert.deepEqual(link.board.resets, []);
    assert.equal(link.host.lifecycle.state, "launching", "nimeni nu a cerut altceva");
  } finally {
    link.dispose();
  }
});

test("watchdog-ul avertizeaza inainte sa reseteze", async () => {
  const link = connect(manifestWith(), { watchdogMs: 1000 });
  try {
    const warnings: number[] = [];
    link.app.on("watchdog.warning", (payload) => warnings.push(Number(payload["remainingMs"])));

    await link.app.call("watchdog.pet");
    link.host.tick(800);
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(warnings, [200], "ultimul sfert de fereastra produce un avertisment");
    assert.deepEqual(link.board.resets, [], "avertismentul nu este inca un reset");
  } finally {
    link.dispose();
  }
});

test("watchdog-ul nu curge in somn", async () => {
  const link = connect(manifestWith(), { watchdogMs: 1000, board: fakeBoard({ blockSleep: true }) });
  try {
    await link.app.call("watchdog.pet");
    const sleeping = link.app.call("power.sleep", { durationMs: 5000 });
    // Apelul este asincron: asteptam sa ajunga la host inainte sa avansam ceasul,
    // altfel am masura o placheta care inca nu a adormit.
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(link.board.sleeps, [5000], "placheta chiar doarme acum");

    // Patru secunde peste o fereastra de una singura: daca watchdog-ul ar curge
    // in somn, orice placheta care economiseste bateria s-ar reseta singura.
    link.host.tick(4000);
    assert.deepEqual(link.board.resets, [], "o placheta adormita nu este resetata de watchdog");

    link.board.finishSleep();
    await sleeping;
    assert.equal(link.host.lifecycle.state, "foreground", "dupa trezire, revine la lucru");

    // Fereastra incepe din nou de la trezire, nu din clipa ultimului `pet`.
    assert.equal(link.host.watchdogRemainingMs, 1000);
  } finally {
    link.dispose();
  }
});

test("somnul poate fi cerut de oricate ori, din orice stare de lucru", async () => {
  const link = connect(manifestWith());
  try {
    for (let round = 0; round < 3; round += 1) {
      await link.app.call("power.sleep", { durationMs: 100 });
    }
    assert.deepEqual(link.board.sleeps, [100, 100, 100]);
    assert.equal(link.host.lifecycle.state, "foreground");
  } finally {
    link.dispose();
  }
});

test("fara capabilitatea power.sleep, aplicatia nu poate adormi placheta", async () => {
  const link = connect(manifestWith({ capabilities: ["hw.gpio"] }));
  try {
    assert.equal(link.app.allows("power.sleep"), false);
    await assert.rejects(
      link.app.call("power.sleep", { durationMs: 100 }),
      (error: unknown) => (error as { code: string }).code === "raptor:host/capability-undeclared",
    );
  } finally {
    link.dispose();
  }
});

test("watchdog-ul nu cere capabilitate, pentru ca nu poate fi refuzat", async () => {
  // Manifest gol: nicio capabilitate. Semnele de viata trebuie sa mearga oricum.
  const link = connect(manifestWith({ capabilities: [] }), { watchdogMs: 1000 });
  try {
    assert.equal(link.app.allows("watchdog.pet"), true);
    assert.deepEqual(await link.app.call("watchdog.pet"), { watchdogMs: 1000, remainingMs: 1000 });
  } finally {
    link.dispose();
  }
});

test("scrierile in NVS se numara, iar una identica nu ajunge la flash", async () => {
  const link = connect(manifestWith());
  try {
    await link.app.call("storage.set", { key: "citiri", value: "[1]" });
    assert.deepEqual(await link.app.call("storage.set", { key: "citiri", value: "[1]" }), {
      key: "citiri",
      written: false,
      nvsWrites: 1,
    });
    assert.deepEqual(await link.app.call("storage.set", { key: "citiri", value: "[1,2]" }), {
      key: "citiri",
      written: true,
      nvsWrites: 2,
    });

    const info = (await link.app.call("device.info")) as { nvsWrites: number; chip: string };
    assert.equal(info.nvsWrites, 2);
    assert.equal(info.chip, "sim32");
  } finally {
    link.dispose();
  }
});

test("firmware-ul nou porneste neconfirmat, ca un rollback sa fie posibil", async () => {
  const link = connect(manifestWith(), { availableFirmware: { version: "1.1.0", bytes: 240_000 } });
  try {
    const check = (await link.app.call("update.check")) as { available: boolean; version: string };
    assert.equal(check.available, true);
    assert.equal(check.version, "1.1.0");

    const applied = (await link.app.call("update.apply")) as { confirmed: boolean };
    assert.equal(applied.confirmed, false, "aplicat, dar neconfirmat");
    assert.deepEqual(link.host.firmware, { version: "1.1.0", confirmed: false });
    assert.deepEqual(link.board.resets, ["firmware nou, in asteptarea confirmarii"]);
  } finally {
    link.dispose();
  }

  const fara = connect(manifestWith());
  try {
    await assert.rejects(fara.app.call("update.apply"), /nicio imagine/);
    await assert.rejects(fara.app.call("update.confirm"), /in asteptarea confirmarii/);
  } finally {
    fara.dispose();
  }
});

test("dupa reset, un apel intarziat primeste un refuz limpede", async () => {
  const link = connect(manifestWith(), { watchdogMs: 500 });
  try {
    await link.app.call("watchdog.pet");
    link.host.tick(600);
    assert.deepEqual(link.board.resets, ["watchdog"]);

    // Un al doilea reset nu se mai inregistreaza: placheta deja a repornit.
    link.host.tick(600);
    assert.deepEqual(link.board.resets, ["watchdog"]);

    await assert.rejects(link.app.call("hw.gpio.write", { pin: 2, value: true }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/lifecycle");
      assert.equal(hostError.detail["reason"], "watchdog");
      return true;
    });
    await assert.rejects(link.app.call("power.sleep", { durationMs: 10 }), /a repornit/);

    // Diagnosticele raman citibile: altfel nu s-ar putea afla de ce a repornit.
    const info = (await link.app.call("device.info")) as { chip: string };
    assert.equal(info.chip, "sim32");
  } finally {
    link.dispose();
  }
});
