import { test } from "node:test";
import assert from "node:assert/strict";
import {
  state,
  derived,
  effect,
  batch,
  untracked,
  createRoot,
  onCleanup,
} from "../../src/core/index.ts";

test("state: read and write", () => {
  const count = state(0);
  assert.equal(count(), 0);
  count.set(5);
  assert.equal(count(), 5);
  count.update((n) => n + 1);
  assert.equal(count(), 6);
});

test("derived: memoized computation, recomputes only when the source changes", () => {
  const a = state(2);
  let computes = 0;
  const double = derived(() => {
    computes++;
    return a() * 2;
  });
  assert.equal(double(), 4);
  assert.equal(double(), 4); // memoized, no recompute
  assert.equal(computes, 1);
  a.set(3);
  assert.equal(double(), 6);
  assert.equal(computes, 2);
});

test("effect: runs initially and on every dependency change", () => {
  const a = state(1);
  const seen: number[] = [];
  const dispose = effect(() => seen.push(a()));
  a.set(2);
  a.set(3);
  assert.deepEqual(seen, [1, 2, 3]);
  dispose();
  a.set(4);
  assert.deepEqual(seen, [1, 2, 3]); // after dispose it no longer runs
});

test("batch: effects run only once for multiple writes", () => {
  const a = state(0);
  const b = state(0);
  let runs = 0;
  effect(() => {
    a();
    b();
    runs++;
  });
  assert.equal(runs, 1);
  batch(() => {
    a.set(1);
    b.set(2);
  });
  assert.equal(runs, 2); // a single re-run for both writes
});

test("glitch-free: a diamond node is evaluated only once", () => {
  // a -> b, a -> c, (b,c) -> d
  const a = state(1);
  const b = derived(() => a() + 1);
  const c = derived(() => a() + 10);
  let dComputes = 0;
  const d = derived(() => {
    dComputes++;
    return b() + c();
  });
  assert.equal(d(), 13);
  assert.equal(dComputes, 1);
  a.set(2);
  assert.equal(d(), 15); // (3) + (12)
  assert.equal(dComputes, 2); // exactly one recompute, no glitch
});

test("derived does not propagate if the value does not change", () => {
  const a = state(4);
  const parity = derived(() => a() % 2);
  let runs = 0;
  effect(() => {
    parity();
    runs++;
  });
  assert.equal(runs, 1);
  a.set(6); // stays even -> parity does not change
  assert.equal(runs, 1);
  a.set(7); // becomes odd -> parity changes
  assert.equal(runs, 2);
});

test("untracked: read without a dependency", () => {
  const a = state(1);
  const b = state(10);
  let runs = 0;
  effect(() => {
    a();
    untracked(() => b());
    runs++;
  });
  assert.equal(runs, 1);
  b.set(20); // does not trigger the effect
  assert.equal(runs, 1);
  a.set(2);
  assert.equal(runs, 2);
});

test("createRoot: dispose cleans up effects and cleanups", () => {
  const a = state(0);
  let runs = 0;
  let cleaned = 0;
  const dispose = createRoot((dispose) => {
    effect(() => {
      a();
      runs++;
    });
    onCleanup(() => cleaned++);
    return dispose;
  });
  assert.equal(runs, 1);
  a.set(1);
  assert.equal(runs, 2);
  dispose();
  assert.equal(cleaned, 1);
  a.set(2);
  assert.equal(runs, 2); // effect destroyed
});

test("nested effect: cleanup on re-run", () => {
  const a = state(0);
  const inner: number[] = [];
  let disposals = 0;
  effect(() => {
    const current = a();
    onCleanup(() => disposals++);
    inner.push(current);
  });
  assert.deepEqual(inner, [0]);
  a.set(1);
  assert.deepEqual(inner, [0, 1]);
  assert.equal(disposals, 1); // cleanup ran before the re-run
});

test("dynamic dependencies: they re-link correctly", () => {
  const cond = state(true);
  const a = state("A");
  const b = state("B");
  const out: string[] = [];
  effect(() => out.push(cond() ? a() : b()));
  assert.deepEqual(out, ["A"]);
  b.set("B2"); // b is not a dependency while cond=true
  assert.deepEqual(out, ["A"]); // no re-run
  cond.set(false);
  assert.deepEqual(out, ["A", "B2"]);
  a.set("A2"); // a is no longer a dependency -> no re-run
  assert.deepEqual(out, ["A", "B2"]);
  b.set("B3");
  assert.deepEqual(out, ["A", "B2", "B3"]);
});

test("source reconciliation: the set grows and shrinks without residual subscriptions", () => {
  const useBoth = state(false);
  const a = state(1);
  const b = state(10);
  const runs: number[] = [];
  // When useBoth=false it depends only on {useBoth, a}; when true, on {useBoth, a, b}.
  const sum = derived(() => (useBoth() ? a() + b() : a()));
  effect(() => runs.push(sum()));
  assert.deepEqual(runs, [1]);

  b.set(20); // b is not a dependency yet -> no re-run
  assert.deepEqual(runs, [1]);

  useBoth.set(true); // now b enters the set
  assert.deepEqual(runs, [1, 21]);

  b.set(30); // b is a dependency -> re-run
  assert.deepEqual(runs, [1, 21, 31]);

  useBoth.set(false); // b leaves the set (the set shrinks)
  assert.deepEqual(runs, [1, 21, 31, 1]);

  b.set(99); // b is no longer a dependency -> no residual subscription
  assert.deepEqual(runs, [1, 21, 31, 1]);
});
