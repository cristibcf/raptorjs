import test from "node:test";
import assert from "node:assert/strict";
import { createBridge, createMemoryChannel, requireHostManifest } from "@raptor/host";
import type { HostBridge, HostManifest } from "@raptor/host";
import { createDeviceHost } from "../../src/device/index.ts";
import type { Board, DeviceHost, DeviceHostOptions } from "../../src/device/index.ts";

const BASE = {
  target: "embedded",
  bundleId: "com.example.board",
  displayName: "Example Board",
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
  /** Finishes the ongoing sleep; available only with `blockSleep`. */
  finishSleep(): void;
}

/**
 * `blockSleep` makes the sleep last until the test finishes it explicitly -
 * without it, the board would wake in the same microtask and it would be
 * impossible to observe what happens *during* the sleep at all.
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
    // Frozen clock: the only source of time is `host.tick(ms)`.
    //
    // Without this, `now()` is `Date.now() + offset`, so the real milliseconds
    // elapsed between two test lines count toward the watchdog. The test
    // "the watchdog does not run during sleep" required exactly 1000 ms left
    // after the wake and got 999 whenever the machine was busy - a failure that
    // has nothing to do with what the test checks.
    now: () => 0,
    pins: [
      { pin: 2, direction: "out", label: "led" },
      { pin: 5, direction: "in", label: "button" },
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

test("the adapter rejects a manifest that is not for embedded", () => {
  const cli = requireHostManifest(JSON.stringify({ ...BASE, target: "cli", capabilities: [] }));
  assert.throws(
    () => createDeviceHost({ manifest: cli, transport: createMemoryChannel().host, board: fakeBoard() }),
    (error: unknown) => (error as { code: string }).code === "raptor:host/manifest-invalid",
  );
});

test("a board has no windows, processes, terminal or notifications", async () => {
  const link = connect(manifestWith());
  try {
    for (const method of ["window.open", "process.spawn", "cli.prompt", "notify.show", "config.get"]) {
      assert.equal(link.app.allows(method), false, `${method} has no place on a board`);
    }
  } finally {
    link.dispose();
  }
});

test("an undeclared pin cannot be touched, in any direction", async () => {
  const link = connect(manifestWith());
  try {
    await assert.rejects(link.app.call("hw.gpio.write", { pin: 13, value: true }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/capability-undeclared");
      assert.deepEqual(hostError.detail["declared"], [2, 5]);
      return true;
    });
    await assert.rejects(link.app.call("hw.gpio.read", { pin: 13 }), /is not in the hardware map/);
    assert.deepEqual(link.board.writes, [], "nothing reached the hardware");
  } finally {
    link.dispose();
  }
});

test("the pin direction is honored: an input cannot be written", async () => {
  const link = connect(manifestWith());
  try {
    await assert.rejects(link.app.call("hw.gpio.write", { pin: 5, value: true }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/capability-unavailable");
      assert.equal(hostError.detail["label"], "button");
      return true;
    });
    await assert.rejects(link.app.call("hw.gpio.read", { pin: 2 }), /declared as 'out'/);
    assert.deepEqual(link.board.writes, []);

    await link.app.call("hw.gpio.write", { pin: 2, value: true });
    assert.deepEqual(link.board.writes, [{ pin: 2, value: true }]);
    assert.equal(link.host.pinState(2), true);
  } finally {
    link.dispose();
  }
});

test("without the hw.gpio capability, the pins do not exist at all", async () => {
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

test("on the bus, only the declared address can be touched", async () => {
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
      /address 0x50 is not declared/,
    );
    await assert.rejects(link.app.call("hw.bus.transfer", { bus: "spi0", address: 0x48 }), /is not declared/);
  } finally {
    link.dispose();
  }
});

test("the watchdog resets the board when the app stops showing signs of life", async () => {
  const link = connect(manifestWith(), { watchdogMs: 1000 });
  try {
    await link.app.call("watchdog.pet");
    assert.equal(link.host.watchdogRemainingMs, 1000);

    link.host.tick(600);
    assert.equal(link.host.watchdogRemainingMs, 400, "the window is consumed");
    assert.deepEqual(link.board.resets, []);

    link.host.tick(500);
    assert.deepEqual(link.board.resets, ["watchdog"], "the board really was reset");
    assert.equal(link.host.lifecycle.state, "stopped");
    assert.equal(link.host.watchdogRemainingMs, null);
  } finally {
    link.dispose();
  }
});

test("an app that shows signs of life is not reset", async () => {
  const link = connect(manifestWith(), { watchdogMs: 1000 });
  try {
    for (let step = 0; step < 5; step += 1) {
      link.host.tick(600);
      await link.app.call("watchdog.pet");
    }
    assert.deepEqual(link.board.resets, []);
    assert.equal(link.host.lifecycle.state, "launching", "no one asked for anything else");
  } finally {
    link.dispose();
  }
});

test("the watchdog warns before it resets", async () => {
  const link = connect(manifestWith(), { watchdogMs: 1000 });
  try {
    const warnings: number[] = [];
    link.app.on("watchdog.warning", (payload) => warnings.push(Number(payload["remainingMs"])));

    await link.app.call("watchdog.pet");
    link.host.tick(800);
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(warnings, [200], "the last quarter of the window produces a warning");
    assert.deepEqual(link.board.resets, [], "the warning is not yet a reset");
  } finally {
    link.dispose();
  }
});

test("the watchdog does not run during sleep", async () => {
  const link = connect(manifestWith(), { watchdogMs: 1000, board: fakeBoard({ blockSleep: true }) });
  try {
    await link.app.call("watchdog.pet");
    const sleeping = link.app.call("power.sleep", { durationMs: 5000 });
    // The call is asynchronous: we wait for it to reach the host before advancing
    // the clock, otherwise we would be measuring a board that has not slept yet.
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(link.board.sleeps, [5000], "the board really is asleep now");

    // Four seconds past a one-second window: if the watchdog ran during sleep,
    // any board that saves battery would reset itself.
    link.host.tick(4000);
    assert.deepEqual(link.board.resets, [], "a sleeping board is not reset by the watchdog");

    link.board.finishSleep();
    await sleeping;
    assert.equal(link.host.lifecycle.state, "foreground", "after the wake, it goes back to work");

    // The window starts again from the wake, not from the moment of the last `pet`.
    assert.equal(link.host.watchdogRemainingMs, 1000);
  } finally {
    link.dispose();
  }
});

test("sleep can be requested any number of times, from any working state", async () => {
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

test("without the power.sleep capability, the app cannot put the board to sleep", async () => {
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

test("the watchdog requires no capability, because it cannot be denied", async () => {
  // Empty manifest: no capabilities. The signs of life must work anyway.
  const link = connect(manifestWith({ capabilities: [] }), { watchdogMs: 1000 });
  try {
    assert.equal(link.app.allows("watchdog.pet"), true);
    assert.deepEqual(await link.app.call("watchdog.pet"), { watchdogMs: 1000, remainingMs: 1000 });
  } finally {
    link.dispose();
  }
});

test("NVS writes are counted, and an identical one does not reach the flash", async () => {
  const link = connect(manifestWith());
  try {
    await link.app.call("storage.set", { key: "readings", value: "[1]" });
    assert.deepEqual(await link.app.call("storage.set", { key: "readings", value: "[1]" }), {
      key: "readings",
      written: false,
      nvsWrites: 1,
    });
    assert.deepEqual(await link.app.call("storage.set", { key: "readings", value: "[1,2]" }), {
      key: "readings",
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

test("new firmware starts unconfirmed, so a rollback is possible", async () => {
  const link = connect(manifestWith(), { availableFirmware: { version: "1.1.0", bytes: 240_000 } });
  try {
    const check = (await link.app.call("update.check")) as { available: boolean; version: string };
    assert.equal(check.available, true);
    assert.equal(check.version, "1.1.0");

    const applied = (await link.app.call("update.apply")) as { confirmed: boolean };
    assert.equal(applied.confirmed, false, "applied, but unconfirmed");
    assert.deepEqual(link.host.firmware, { version: "1.1.0", confirmed: false });
    assert.deepEqual(link.board.resets, ["new firmware, awaiting confirmation"]);
  } finally {
    link.dispose();
  }

  const fara = connect(manifestWith());
  try {
    await assert.rejects(fara.app.call("update.apply"), /no firmware image/);
    await assert.rejects(fara.app.call("update.confirm"), /awaiting confirmation/);
  } finally {
    fara.dispose();
  }
});

test("after a reset, a delayed call gets a clear denial", async () => {
  const link = connect(manifestWith(), { watchdogMs: 500 });
  try {
    await link.app.call("watchdog.pet");
    link.host.tick(600);
    assert.deepEqual(link.board.resets, ["watchdog"]);

    // A second reset is not recorded: the board has already rebooted.
    link.host.tick(600);
    assert.deepEqual(link.board.resets, ["watchdog"]);

    await assert.rejects(link.app.call("hw.gpio.write", { pin: 2, value: true }), (error: unknown) => {
      const hostError = error as { code: string; detail: Record<string, unknown> };
      assert.equal(hostError.code, "raptor:host/lifecycle");
      assert.equal(hostError.detail["reason"], "watchdog");
      return true;
    });
    await assert.rejects(link.app.call("power.sleep", { durationMs: 10 }), /rebooted/);

    // The diagnostics stay readable: otherwise there would be no way to find out why it rebooted.
    const info = (await link.app.call("device.info")) as { chip: string };
    assert.equal(info.chip, "sim32");
  } finally {
    link.dispose();
  }
});
