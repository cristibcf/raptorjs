import test from "node:test";
import assert from "node:assert/strict";
import { createSession, simulatedBoard, PINS } from "../src/session.ts";
import type { Session } from "../src/session.ts";

async function started(options: Partial<Parameters<typeof createSession>[0]> = {}): Promise<Session> {
  const session = createSession({ board: options.board ?? simulatedBoard(), ...options } as Parameters<typeof createSession>[0]);
  await session.logger.start();
  return session;
}

test("harta de hardware descrie ce are voie aplicatia sa atinga", () => {
  assert.deepEqual(
    PINS.map((pin) => [pin.pin, pin.direction]),
    [
      [2, "out"],
      [5, "in"],
    ],
  );
});

test("pornirea aprinde LED-ul prin pinul declarat", async () => {
  const board = simulatedBoard();
  const session = await started({ board });
  try {
    assert.deepEqual(board.writes, [{ pin: 2, value: true }]);
  } finally {
    session.close();
  }
});

test("o bucla de citiri produce valori de la senzor, cu somn intre ele", async () => {
  const board = simulatedBoard({ start: 20, step: 1 });
  const session = await started({ board });
  try {
    await session.logger.run(3, 250);
    assert.equal(session.logger.readings().length, 3);
    assert.deepEqual(board.sleeps, [250, 250], "nu se doarme si dupa ultima citire");
    assert.match(session.logger.summary(), /treaz - 3 citiri/);
  } finally {
    session.close();
  }
});

test("scrierile in flash se fac doar la deriva reala, nu la fiecare citire", async () => {
  const storage = new Map<string, string>();
  const board = simulatedBoard({ start: 20, step: 0.2 });
  const session = await started({ board, storage });
  try {
    await session.logger.run(6, 100);
    const info = (await session.bridge.call("device.info")) as { nvsWrites: number };
    assert.equal(session.logger.readings().length, 6);
    assert.ok(info.nvsWrites < 6, `sase citiri nu ar trebui sa dea sase scrieri (au dat ${info.nvsWrites})`);
    assert.ok(info.nvsWrites >= 1, "dar prima valoare ajunge pe disc");
  } finally {
    session.close();
  }
});

test("citirile salvate supravietuiesc repornirii, pentru ca traiesc in NVS", async () => {
  const storage = new Map<string, string>();
  const first = await started({ board: simulatedBoard({ start: 30, step: 1 }), storage });
  try {
    await first.logger.run(2, 100);
  } finally {
    first.close();
  }

  const second = await started({ board: simulatedBoard(), storage });
  try {
    assert.equal(second.logger.readings().length, 2, "a doua pornire citeste ce a scris prima");
  } finally {
    second.close();
  }
});

test("aplicatia da semne de viata la fiecare trecere prin bucla", async () => {
  const board = simulatedBoard();
  const session = await started({ board, watchdogMs: 1000 });
  try {
    for (let round = 0; round < 4; round += 1) {
      // Ceasul trece aproape de fereastra, dar bucla il reimprospateaza la timp.
      session.host.tick(900);
      await session.logger.step();
    }
    assert.deepEqual(board.resets, [], "o bucla sanatoasa nu ajunge niciodata la reset");
    assert.equal(session.logger.readings().length, 4);
  } finally {
    session.close();
  }
});

test("o aplicatie blocata este resetata de host, nu lasata sa atarne", async () => {
  const board = simulatedBoard();
  const session = await started({ board, watchdogMs: 1000 });
  try {
    await session.logger.step();
    // Bucla nu mai trece pe la `watchdog.pet`: exact cazul pentru care exista.
    session.host.tick(1500);
    assert.deepEqual(board.resets, ["watchdog"]);
    assert.equal(session.host.lifecycle.state, "stopped");
  } finally {
    session.close();
  }
});

test("avertismentul de watchdog ajunge in starea aplicatiei", async () => {
  const session = await started({ watchdogMs: 1000 });
  try {
    await session.logger.step();
    session.host.tick(800);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(String(session.logger.lastError()), /watchdog: \d+ms ramase/);
  } finally {
    session.close();
  }
});

test("fara periferice declarate, logger-ul nu citeste si nu aprinde nimic", async () => {
  const board = simulatedBoard();
  const session = await started({ board, capabilities: [] });
  try {
    await session.logger.run(3, 100);
    assert.deepEqual(board.writes, [], "LED-ul nu a fost atins");
    assert.deepEqual(board.sleeps, [], "nici somnul nu este permis");
    assert.equal(session.logger.readings().length, 0, "fara magistrala nu exista citiri");
    // Si totusi aplicatia a rulat pana la capat, fara sa crape.
    assert.match(session.logger.summary(), /0 citiri/);
  } finally {
    session.close();
  }
});

test("aplicatia urmareste somnul prin evenimentele host-ului", async () => {
  const board = simulatedBoard({ blockSleep: true });
  const session = await started({ board });
  try {
    const sleeping = session.bridge.call("power.sleep", { durationMs: 100 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(session.logger.summary(), /^adormit/, "aplicatia stie ca placheta doarme");

    board.finishSleep();
    await sleeping;
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(session.logger.summary(), /^treaz/, "si stie cand s-a trezit");
  } finally {
    session.close();
  }
});
