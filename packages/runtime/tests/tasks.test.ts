import test from "node:test";
import assert from "node:assert/strict";
import { createObserver, createTaskFabric } from "../src/index.ts";

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("un task terminat cu bine intra in statistici si elibereaza slotul", async () => {
  const tasks = createTaskFabric();
  assert.equal(await tasks.spawn(() => 42), 42);
  const stats = tasks.stats();
  assert.deepEqual(
    { spawned: stats.spawned, completed: stats.completed, failed: stats.failed, active: stats.active },
    { spawned: 1, completed: 1, failed: 0, active: 0 },
  );
});

test("esecul aplicatiei ramane esec, nu devine anulare", async () => {
  const tasks = createTaskFabric();
  await assert.rejects(tasks.spawn(() => { throw new Error("boom"); }), /boom/);
  assert.equal(tasks.stats().failed, 1);
  assert.equal(tasks.stats().cancelled, 0);
});

test("cota de concurenta este respectata, iar varful este raportat", async () => {
  const tasks = createTaskFabric({ maxConcurrent: 2 });
  let concurrent = 0;
  let observedPeak = 0;

  const body = async (): Promise<void> => {
    concurrent += 1;
    observedPeak = Math.max(observedPeak, concurrent);
    await tick(5);
    concurrent -= 1;
  };

  await Promise.all([tasks.spawn(body), tasks.spawn(body), tasks.spawn(body), tasks.spawn(body)]);
  assert.equal(observedPeak, 2, "niciodata mai multe task-uri active decat cota");
  assert.equal(tasks.stats().peakActive, 2);
  assert.equal(tasks.stats().completed, 4);
});

test("deadline-ul anuleaza task-ul cu un cod stabil", async () => {
  const tasks = createTaskFabric();
  await assert.rejects(
    tasks.spawn(async (context) => {
      await tick(50);
      context.throwIfCancelled();
    }, { deadlineMs: 5, name: "lent" }),
    (error: unknown) => (error as { code: string }).code === "raptor:task/deadline",
  );
  assert.equal(tasks.stats().cancelled, 1);
});

test("contextul raporteaza timpul ramas pana la deadline", async () => {
  const tasks = createTaskFabric();
  const remaining = await tasks.spawn((context) => context.remainingMs, { deadlineMs: 1000 });
  assert.ok(remaining !== null && remaining > 0 && remaining <= 1000);
  assert.equal(await tasks.spawn((context) => context.remainingMs), null, "fara deadline nu exista timp ramas");
});

test("un semnal extern anuleaza task-ul cu codul de anulare", async () => {
  const tasks = createTaskFabric();
  const controller = new AbortController();
  const promise = tasks.spawn(async (context) => {
    await tick(50);
    context.throwIfCancelled();
  }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, (error: unknown) => (error as { code: string }).code === "raptor:task/cancelled");
});

test("shutdown anuleaza lucrul in zbor, dreneaza si refuza lucru nou", async () => {
  const tasks = createTaskFabric();
  let cooperated = false;

  const inFlight = tasks.spawn(async (context) => {
    await tick(30);
    context.throwIfCancelled();
    cooperated = true;
  });
  const settled = inFlight.catch((error: unknown) => error);

  await tasks.shutdown("test");
  const outcome = await settled;

  assert.equal(cooperated, false, "task-ul anulat nu isi termina corpul");
  assert.equal((outcome as { code: string }).code, "raptor:task/cancelled");
  assert.equal(tasks.closed, true);
  assert.equal(tasks.stats().active, 0, "drenarea asteapta eliberarea slotului");

  await assert.rejects(
    tasks.spawn(() => 1),
    (error: unknown) => (error as { code: string }).code === "raptor:task/quota",
  );
});

test("shutdown este idempotent", async () => {
  const tasks = createTaskFabric();
  await tasks.shutdown();
  await tasks.shutdown();
  assert.equal(tasks.closed, true);
});

test("drain asteapta fara sa anuleze", async () => {
  const tasks = createTaskFabric();
  let done = false;
  void tasks.spawn(async () => { await tick(10); done = true; });
  await tasks.drain();
  assert.equal(done, true);
  assert.equal(tasks.closed, false);
});

test("fiecare task produce un span cu rezultatul lui", async () => {
  const observer = createObserver({ now: () => 0 });
  const tasks = createTaskFabric({ observer });
  await tasks.spawn(() => 1, { name: "bun" });
  await tasks.spawn(() => { throw new Error("rau"); }, { name: "rau" }).catch(() => undefined);

  const spans = observer.events().filter((event) => event.kind === "span");
  assert.deepEqual(spans.map((span) => span.name), ["task.bun", "task.rau"]);
  assert.equal(spans[0]!.attributes["outcome"], "completed");
  assert.equal(spans[1]!.attributes["outcome"], "failed");
});
