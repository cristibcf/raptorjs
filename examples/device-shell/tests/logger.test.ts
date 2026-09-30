import test from "node:test";
import assert from "node:assert/strict";
import { createSession, simulatedBoard, PINS } from "../src/session.ts";
import type { Session } from "../src/session.ts";

async function started(options: Partial<Parameters<typeof createSession>[0]> = {}): Promise<Session> {
  const session = createSession({ board: options.board ?? simulatedBoard(), ...options } as Parameters<typeof createSession>[0]);
  await session.logger.start();
  return session;
}

test("the hardware map describes what the app is allowed to touch", () => {
  assert.deepEqual(
    PINS.map((pin) => [pin.pin, pin.direction]),
    [
      [2, "out"],
      [5, "in"],
    ],
  );
});

test("startup turns on the LED through the declared pin", async () => {
  const board = simulatedBoard();
  const session = await started({ board });
  try {
    assert.deepEqual(board.writes, [{ pin: 2, value: true }]);
  } finally {
    session.close();
  }
});

test("a loop of readings produces values from the sensor, with sleep between them", async () => {
  const board = simulatedBoard({ start: 20, step: 1 });
  const session = await started({ board });
  try {
    await session.logger.run(3, 250);
    assert.equal(session.logger.readings().length, 3);
    assert.deepEqual(board.sleeps, [250, 250], "it does not sleep after the last reading");
    assert.match(session.logger.summary(), /awake - 3 readings/);
  } finally {
    session.close();
  }
});

test("flash writes happen only on real drift, not on every reading", async () => {
  const storage = new Map<string, string>();
  const board = simulatedBoard({ start: 20, step: 0.2 });
  const session = await started({ board, storage });
  try {
    await session.logger.run(6, 100);
    const info = (await session.bridge.call("device.info")) as { nvsWrites: number };
    assert.equal(session.logger.readings().length, 6);
    assert.ok(info.nvsWrites < 6, `six readings should not produce six writes (they produced ${info.nvsWrites})`);
    assert.ok(info.nvsWrites >= 1, "but the first value reaches the disk");
  } finally {
    session.close();
  }
});

test("saved readings survive a restart, because they live in NVS", async () => {
  const storage = new Map<string, string>();
  const first = await started({ board: simulatedBoard({ start: 30, step: 1 }), storage });
  try {
    await first.logger.run(2, 100);
  } finally {
    first.close();
  }

  const second = await started({ board: simulatedBoard(), storage });
  try {
    assert.equal(second.logger.readings().length, 2, "the second startup reads what the first wrote");
  } finally {
    second.close();
  }
});

test("the app shows signs of life on every pass through the loop", async () => {
  const board = simulatedBoard();
  const session = await started({ board, watchdogMs: 1000 });
  try {
    for (let round = 0; round < 4; round += 1) {
      // The clock gets close to the window, but the loop refreshes it in time.
      session.host.tick(900);
      await session.logger.step();
    }
    assert.deepEqual(board.resets, [], "a healthy loop never reaches a reset");
    assert.equal(session.logger.readings().length, 4);
  } finally {
    session.close();
  }
});

test("a hung app is reset by the host, not left to hang", async () => {
  const board = simulatedBoard();
  const session = await started({ board, watchdogMs: 1000 });
  try {
    await session.logger.step();
    // The loop no longer passes through `watchdog.pet`: exactly the case it exists for.
    session.host.tick(1500);
    assert.deepEqual(board.resets, ["watchdog"]);
    assert.equal(session.host.lifecycle.state, "stopped");
  } finally {
    session.close();
  }
});

test("the watchdog warning reaches the app's state", async () => {
  const session = await started({ watchdogMs: 1000 });
  try {
    await session.logger.step();
    session.host.tick(800);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(String(session.logger.lastError()), /watchdog: \d+ms remaining/);
  } finally {
    session.close();
  }
});

test("without declared peripherals, the logger reads nothing and turns on nothing", async () => {
  const board = simulatedBoard();
  const session = await started({ board, capabilities: [] });
  try {
    await session.logger.run(3, 100);
    assert.deepEqual(board.writes, [], "the LED was not touched");
    assert.deepEqual(board.sleeps, [], "sleep is not allowed either");
    assert.equal(session.logger.readings().length, 0, "without a bus there are no readings");
    // And yet the app ran to the end, without crashing.
    assert.match(session.logger.summary(), /0 readings/);
  } finally {
    session.close();
  }
});

test("the app tracks sleep through the host's events", async () => {
  const board = simulatedBoard({ blockSleep: true });
  const session = await started({ board });
  try {
    const sleeping = session.bridge.call("power.sleep", { durationMs: 100 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(session.logger.summary(), /^asleep/, "the app knows the board is sleeping");

    board.finishSleep();
    await sleeping;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(session.logger.summary(), /^awake/, "and it knows when it woke up");
  } finally {
    session.close();
  }
});
