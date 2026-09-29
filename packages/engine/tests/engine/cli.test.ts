import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../../src/engine/cli.ts";

const SRC = `
component Counter {
  const count = state(0)
  const doubled = derived(() => count * 2)
  const dead = derived(() => doubled + 100)
  const price = serverSignal("BTC.price", schema.money)
  <div>
    <button on:click={count++}>+</button>
    <span data-x={doubled}>Count: {count} / {doubled}</span>
    <span>{price}</span>
  </div>
}
`;

// Cititor de fisiere injectat (fara atingerea disk-ului).
const read = (_p: string): string => SRC;

test("cli: --version", () => {
  const r = runCli(["--version"], read);
  assert.equal(r.code, 0);
  assert.match(r.out, /^raptor 0\.1\.0/);
});

test("cli: fara argumente afiseaza help", () => {
  const r = runCli([], read);
  assert.equal(r.code, 0);
  assert.match(r.out, /raptor build <file/);
});

test("cli: build raporteaza optimizari si wire", () => {
  const r = runCli(["build", "Counter.raptor", "--report"], read);
  assert.equal(r.code, 0);
  assert.match(r.out, /✓ build Counter\.raptor/);
  assert.match(r.out, /eliminate 1/); // dead eliminat
  assert.match(r.out, /adrese RAS/);
  assert.match(r.out, /Optimization trace/); // --report
});

test("cli: build cu profil realtime", () => {
  const r = runCli(["build", "Counter.raptor", "--profile", "realtime"], read);
  assert.equal(r.code, 0);
  assert.match(r.out, /profil realtime/);
});

test("cli: inspect graph", () => {
  const r = runCli(["inspect", "graph", "Counter.raptor"], read);
  assert.equal(r.code, 0);
  assert.match(r.out, /Semantic Application Graph/);
  assert.match(r.out, /\[signal\] Counter\.count/);
});

test("cli: inspect invalidate arata blast radius", () => {
  const r = runCli(["inspect", "invalidate", "Counter.raptor", "Counter.count"], read);
  assert.equal(r.code, 0);
  assert.match(r.out, /invalidate Counter\.count ->/);
});

test("cli: analyze", () => {
  const r = runCli(["analyze", "Counter.raptor"], read);
  assert.equal(r.code, 0);
  assert.match(r.out, /raptor analyze/);
  assert.match(r.out, /RAS addresses: BTC\.price=0x18A1/);
});

test("cli: dev afiseaza update log de load", () => {
  const r = runCli(["dev", "Counter.raptor"], read);
  assert.equal(r.code, 0);
  assert.match(r.out, /RaptorDev update #1/);
});

test("cli: comanda necunoscuta -> cod 1", () => {
  const r = runCli(["frobnicate"], read);
  assert.equal(r.code, 1);
  assert.match(r.out, /comanda necunoscuta/);
});

test("cli: eroare de parse raportata curat", () => {
  const r = runCli(["build", "bad.raptor"], () => "component X { const a = state(0)");
  assert.equal(r.code, 1);
  assert.match(r.out, /eroare:/);
});
