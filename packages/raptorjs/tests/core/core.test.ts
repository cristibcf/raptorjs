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

test("state: read si write", () => {
  const count = state(0);
  assert.equal(count(), 0);
  count.set(5);
  assert.equal(count(), 5);
  count.update((n) => n + 1);
  assert.equal(count(), 6);
});

test("derived: calcul memoizat, recalcul doar cand se schimba sursa", () => {
  const a = state(2);
  let computes = 0;
  const double = derived(() => {
    computes++;
    return a() * 2;
  });
  assert.equal(double(), 4);
  assert.equal(double(), 4); // memoizat, fara recalcul
  assert.equal(computes, 1);
  a.set(3);
  assert.equal(double(), 6);
  assert.equal(computes, 2);
});

test("effect: ruleaza initial si la fiecare schimbare a dependentei", () => {
  const a = state(1);
  const seen: number[] = [];
  const dispose = effect(() => seen.push(a()));
  a.set(2);
  a.set(3);
  assert.deepEqual(seen, [1, 2, 3]);
  dispose();
  a.set(4);
  assert.deepEqual(seen, [1, 2, 3]); // dupa dispose nu mai ruleaza
});

test("batch: effects ruleaza o singura data pentru scrieri multiple", () => {
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
  assert.equal(runs, 2); // un singur re-run pentru ambele scrieri
});

test("glitch-free: nod diamant se evalueaza o singura data", () => {
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
  assert.equal(dComputes, 2); // exact o recalculare, fara glitch
});

test("derived nu propaga daca valoarea nu se schimba", () => {
  const a = state(4);
  const parity = derived(() => a() % 2);
  let runs = 0;
  effect(() => {
    parity();
    runs++;
  });
  assert.equal(runs, 1);
  a.set(6); // ramane par -> parity nu se schimba
  assert.equal(runs, 1);
  a.set(7); // devine impar -> parity se schimba
  assert.equal(runs, 2);
});

test("untracked: citire fara dependenta", () => {
  const a = state(1);
  const b = state(10);
  let runs = 0;
  effect(() => {
    a();
    untracked(() => b());
    runs++;
  });
  assert.equal(runs, 1);
  b.set(20); // nu declanseaza effect
  assert.equal(runs, 1);
  a.set(2);
  assert.equal(runs, 2);
});

test("createRoot: dispose curata effects si cleanup-uri", () => {
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
  assert.equal(runs, 2); // effect distrus
});

test("effect nested: cleanup la re-run", () => {
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
  assert.equal(disposals, 1); // cleanup rulat inainte de re-run
});

test("dependente dinamice: se re-leaga corect", () => {
  const cond = state(true);
  const a = state("A");
  const b = state("B");
  const out: string[] = [];
  effect(() => out.push(cond() ? a() : b()));
  assert.deepEqual(out, ["A"]);
  b.set("B2"); // b nu e dependenta cat timp cond=true
  assert.deepEqual(out, ["A"]); // fara re-run
  cond.set(false);
  assert.deepEqual(out, ["A", "B2"]);
  a.set("A2"); // a nu mai e dependenta -> fara re-run
  assert.deepEqual(out, ["A", "B2"]);
  b.set("B3");
  assert.deepEqual(out, ["A", "B2", "B3"]);
});

test("reconciliere surse: setul creste si scade fara abonamente reziduale", () => {
  const useBoth = state(false);
  const a = state(1);
  const b = state(10);
  const runs: number[] = [];
  // Cand useBoth=false depinde doar de {useBoth, a}; cand true, de {useBoth, a, b}.
  const sum = derived(() => (useBoth() ? a() + b() : a()));
  effect(() => runs.push(sum()));
  assert.deepEqual(runs, [1]);

  b.set(20); // b nu e inca dependenta -> fara re-run
  assert.deepEqual(runs, [1]);

  useBoth.set(true); // acum b intra in set
  assert.deepEqual(runs, [1, 21]);

  b.set(30); // b e dependenta -> re-run
  assert.deepEqual(runs, [1, 21, 31]);

  useBoth.set(false); // b iese din set (setul scade)
  assert.deepEqual(runs, [1, 21, 31, 1]);

  b.set(99); // b nu mai e dependenta -> niciun abonament rezidual
  assert.deepEqual(runs, [1, 21, 31, 1]);
});
