import test from "node:test";
import assert from "node:assert/strict";
import { createObserver, createTaskFabric } from "../../src/core/index.ts";

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("a successfully completed task enters the statistics and releases the slot", async () => {
  const tasks = createTaskFabric();
  assert.equal(await tasks.spawn(() => 42), 42);
  const stats = tasks.stats();
  assert.deepEqual(
    { spawned: stats.spawned, completed: stats.completed, failed: stats.failed, active: stats.active },
    { spawned: 1, completed: 1, failed: 0, active: 0 },
  );
});

test("an application failure stays a failure, it does not become a cancellation", async () => {
  const tasks = createTaskFabric();
  await assert.rejects(tasks.spawn(() => { throw new Error("boom"); }), /boom/);
  assert.equal(tasks.stats().failed, 1);
  assert.equal(tasks.stats().cancelled, 0);
});

test("the concurrency quota is respected, and the peak is reported", async () => {
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
  assert.equal(observedPeak, 2, "never more active tasks than the quota");
  assert.equal(tasks.stats().peakActive, 2);
  assert.equal(tasks.stats().completed, 4);
});

test("the deadline cancels the task with a stable code", async () => {
  const tasks = createTaskFabric();
  await assert.rejects(
    tasks.spawn(async (context) => {
      await tick(50);
      context.throwIfCancelled();
    }, { deadlineMs: 5, name: "slow" }),
    (error: unknown) => (error as { code: string }).code === "raptor:task/deadline",
  );
  assert.equal(tasks.stats().cancelled, 1);
});

test("the context reports the time remaining until the deadline", async () => {
  const tasks = createTaskFabric();
  const remaining = await tasks.spawn((context) => context.remainingMs, { deadlineMs: 1000 });
  assert.ok(remaining !== null && remaining > 0 && remaining <= 1000);
  assert.equal(await tasks.spawn((context) => context.remainingMs), null, "without a deadline there is no remaining time");
});

test("an external signal cancels the task with the cancellation code", async () => {
  const tasks = createTaskFabric();
  const controller = new AbortController();
  const promise = tasks.spawn(async (context) => {
    await tick(50);
    context.throwIfCancelled();
  }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, (error: unknown) => (error as { code: string }).code === "raptor:task/cancelled");
});

test("shutdown cancels in-flight work, drains and rejects new work", async () => {
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

  assert.equal(cooperated, false, "the cancelled task does not finish its body");
  assert.equal((outcome as { code: string }).code, "raptor:task/cancelled");
  assert.equal(tasks.closed, true);
  assert.equal(tasks.stats().active, 0, "draining waits for the slot to be released");

  await assert.rejects(
    tasks.spawn(() => 1),
    (error: unknown) => (error as { code: string }).code === "raptor:task/quota",
  );
});

test("shutdown is idempotent", async () => {
  const tasks = createTaskFabric();
  await tasks.shutdown();
  await tasks.shutdown();
  assert.equal(tasks.closed, true);
});

test("drain waits without cancelling", async () => {
  const tasks = createTaskFabric();
  let done = false;
  void tasks.spawn(async () => { await tick(10); done = true; });
  await tasks.drain();
  assert.equal(done, true);
  assert.equal(tasks.closed, false);
});

test("every task produces a span with its outcome", async () => {
  const observer = createObserver({ now: () => 0 });
  const tasks = createTaskFabric({ observer });
  await tasks.spawn(() => 1, { name: "good" });
  await tasks.spawn(() => { throw new Error("bad"); }, { name: "bad" }).catch(() => undefined);

  const spans = observer.events().filter((event) => event.kind === "span");
  assert.deepEqual(spans.map((span) => span.name), ["task.good", "task.bad"]);
  assert.equal(spans[0]!.attributes["outcome"], "completed");
  assert.equal(spans[1]!.attributes["outcome"], "failed");
});
