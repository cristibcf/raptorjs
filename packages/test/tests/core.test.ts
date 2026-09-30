import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VirtualClock,
  VirtualDB,
  RaptorTwin,
  BehaviorGraph,
  Coverage,
  reidentify,
  semanticId,
  actionScore,
  type SemanticNode,
} from "../src/index.ts";

test("VirtualClock: events in order of time, then of insertion", () => {
  const clock = new VirtualClock();
  const order: string[] = [];
  clock.at(30, () => order.push("c"));
  clock.at(10, () => order.push("a"));
  clock.at(10, () => order.push("b")); // same time -> insertion order
  clock.runUntilIdle();
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.equal(clock.now, 30);
});

test("VirtualClock: advance runs only the due events", () => {
  const clock = new VirtualClock();
  const fired: number[] = [];
  clock.at(5, () => fired.push(5));
  clock.at(50, () => fired.push(50));
  clock.advance(10);
  assert.deepEqual(fired, [5]);
  assert.equal(clock.now, 10);
});

test("VirtualDB: CRUD + autoincrement id", () => {
  const db = new VirtualDB();
  const a = db.create("user", { name: "Ana" });
  const b = db.create("user", { name: "Bob" });
  assert.equal(a.id, 1);
  assert.equal(b.id, 2);
  assert.equal(db.read("user", 1)!.name, "Ana");
  db.update("user", 1, { name: "Ana2" });
  assert.equal(db.read("user", 1)!.name, "Ana2");
  assert.equal(db.delete("user", 2), true);
  assert.equal(db.list("user").length, 1);
});

test("RaptorTwin: copy-on-write snapshot/fork isolates the changes", () => {
  const twin = new RaptorTwin();
  twin.route("POST", "/n", (_r, db) => ({ status: 200, body: db.create("n", { v: 1 }) }));
  twin.db.create("n", { v: 0 });
  const restore = twin.fork();
  twin.handle("POST", "/n", {});
  assert.equal(twin.db.list("n").length, 2);
  restore(); // return to the snapshot
  assert.equal(twin.db.list("n").length, 1);
});

test("RaptorTwin: routes with parameters", () => {
  const twin = new RaptorTwin();
  twin.route("GET", "/orders/:id", (req, db) => ({ status: 200, body: db.read("orders", Number(req.params.id)) }));
  twin.db.create("orders", { total: 99 });
  const res = twin.handle("GET", "/orders/1", null);
  assert.equal((res.body as any).total, 99);
});

test("Semantic self-heal: re-identifies after a name change", () => {
  const target: SemanticNode = { role: "button", name: "Add to cart", context: ["ProductCard"], actionEffect: "POST /cart/items" };
  const renamed: SemanticNode = { role: "button", name: "Add", context: ["ProductCard"], actionEffect: "POST /cart/items" };
  const match = reidentify(target, [renamed]);
  assert.ok(match);
  assert.equal(match!.healed, true); // remapping reported, not hidden
  assert.notEqual(semanticId(target), semanticId(renamed));
});

test("BehaviorGraph: records states and transitions", () => {
  const g = new BehaviorGraph();
  const action: SemanticNode = { role: "button", name: "Add", context: ["P"], actionEffect: "POST /x" };
  g.observeState({ count: 0 });
  const edge = g.observeTransition({ count: 0 }, action, { count: 1 }, "ok");
  assert.equal(edge.transitions.length, 1);
  assert.equal(edge.risk, 1); // POST -> mutation -> maximum risk
});

test("Coverage: mark returns true only for new elements", () => {
  const c = new Coverage();
  assert.equal(c.mark("actions", "a"), true);
  assert.equal(c.mark("actions", "a"), false);
  assert.equal(c.count("actions"), 1);
});

test("Explorer score: a new mutation beats a known read", () => {
  const risky = actionScore({ coverageGain: 2, risk: 1, novelty: 1, executionCost: 1 });
  const safe = actionScore({ coverageGain: 1, risk: 0.3, novelty: 0.2, executionCost: 1 });
  assert.ok(risky > safe);
});
