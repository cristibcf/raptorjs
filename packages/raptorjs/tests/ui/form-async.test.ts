/**
 * Async field validation (v0.2.1).
 *
 * `Validator<T>` was synchronous, so "is this email already registered?" and
 * "is this API key valid?" could not live in the form at all - they ended up
 * as a side channel next to it, with the submit button guessing.
 *
 * The parts worth pinning down are the ones that go wrong quietly: a slow
 * answer about an old value must never overwrite a newer one, a sync rule must
 * still answer on the keystroke without waiting for the network, and a form
 * with no async rules at all must submit exactly as synchronously as before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "../../src/core/index.ts";
import { installMiniDom, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render } from "../../src/dom/runtime.ts";
import { field, formGroup, validators, Form, FormField, type Field } from "../../src/ui/form.ts";
import { Input } from "../../src/ui/input.ts";

installMiniDom();
const doc = (globalThis as unknown as { document: { createElement(tag: string): MiniElement } }).document;

/** A macrotask: enough for a zero-delay debounce and a resolved promise. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const after = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------ the basics -- */

test("async: the field reports validating, then the verdict", async () => {
  const taken = ["ana@x.com"];
  const f = createRoot(() =>
    field("", {
      debounceMs: 0,
      validate: [
        validators.required(),
        validators.email(),
        async (value: string) => {
          await tick();
          return taken.includes(value) ? "Already registered" : null;
        },
      ],
    }),
  );

  // The sync rules answer immediately, with no round trip and no "validating".
  assert.equal(f.error(), "Required field");
  assert.equal(f.validating(), false);
  f.value.set("nope");
  assert.equal(f.error(), "Invalid email address", "answered on the keystroke");
  assert.equal(f.validating(), false, "the async rule was never reached");

  // A value the sync rules accept: now the async one runs.
  f.value.set("ana@x.com");
  assert.equal(f.error(), null, "no stale error while the check is in flight");
  assert.equal(f.validating(), true);

  await after(5);
  assert.equal(f.validating(), false);
  assert.equal(f.error(), "Already registered");
  assert.equal(f.valid(), false);

  f.value.set("new@x.com");
  await after(5);
  assert.equal(f.error(), null);
  assert.equal(f.valid(), true);
});

test("async: a rule that rejects is reported, and does not block the field", async () => {
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
  try {
    const f = createRoot(() =>
      field("a@b.co", {
        debounceMs: 0,
        validate: async () => {
          await tick();
          throw new Error("service unavailable");
        },
      }),
    );
    await after(5);
    assert.equal(f.error(), null, "a check that could not run is not a verdict");
    assert.equal(f.validating(), false);
    assert.ok(
      warnings.some((w) => w.includes("[raptor]") && w.includes("service unavailable")),
      warnings.join(" | "),
    );
  } finally {
    console.warn = realWarn;
  }
});

/* --------------------------------------------------------- stale answers -- */

test("async: a slow answer about an old value cannot overwrite a newer one", async () => {
  const resolvers: ((message: string | null) => void)[] = [];
  const asked: string[] = [];
  const f = createRoot(() =>
    field("", {
      debounceMs: 0,
      validate: (value: string) => {
        asked.push(value);
        return new Promise<string | null>((resolve) => resolvers.push(resolve));
      },
    }),
  );

  f.value.set("one");
  await tick();
  f.value.set("two");
  await tick();
  assert.deepEqual(asked, ["", "one", "two"], "one check per value");

  // The answers come back out of order: "two" first, then the stale "one".
  resolvers[2]!(null);
  await tick();
  assert.equal(f.error(), null);
  assert.equal(f.validating(), false);

  resolvers[1]!("Already registered");
  resolvers[0]!("Already registered");
  await tick();
  assert.equal(f.error(), null, "the stale verdicts were dropped, not applied");
  assert.equal(f.validating(), false);
});

test("async: typing through a field debounces into a single check", async () => {
  const asked: string[] = [];
  const f = createRoot(() =>
    field("a@b.co", {
      debounceMs: 20,
      validate: async (value: string) => {
        asked.push(value);
        return null;
      },
    }),
  );
  // The first check runs immediately - nothing is wasted learning that the
  // rule is async - and from then on the debounce applies.
  await after(5);
  assert.deepEqual(asked, ["a@b.co"]);

  for (const value of ["a", "an", "ann", "anna@x.com"]) {
    f.value.set(value);
    await after(3);
  }
  assert.deepEqual(asked, ["a@b.co"], "nothing asked while the keystrokes kept coming");
  assert.equal(f.validating(), true);

  await after(40);
  assert.deepEqual(asked, ["a@b.co", "anna@x.com"], "one check, for the value that stuck");
  assert.equal(f.validating(), false);
});

/* ---------------------------------------------------------------- submit -- */

test("async: a submit waits for the verdict instead of submitting past it", async () => {
  const root = doc.createElement("div");
  const built = createRoot(() => {
    const email = field("ana@x.com", {
      debounceMs: 50,
      validate: async (value: string) => {
        await tick();
        return value === "ana@x.com" ? "Already registered" : null;
      },
    });
    const group = formGroup([email]);
    let submits = 0;
    const el = Form({
      group,
      onSubmit: () => void submits++,
      children: FormField({ field: email, label: "Email", children: Input({ value: email.value }) }),
    });
    return { email, group, el, submits: () => submits };
  });
  render(() => built.el, root as never);
  const form = root.querySelector("form")! as unknown as { dispatch(type: string): void };

  // Submitted while the debounce is still pending: the form resolves it first.
  form.dispatch("submit");
  await after(10);
  assert.equal(built.submits(), 0, "not submitted against a verdict that had not arrived");
  assert.equal(built.email.error(), "Already registered");
  assert.equal(built.email.touched(), true, "and the field was marked");

  built.email.value.set("new@x.com");
  form.dispatch("submit");
  await after(10);
  assert.equal(built.submits(), 1);
});

test("async: a form with only sync rules still submits synchronously", () => {
  const root = doc.createElement("div");
  const built = createRoot(() => {
    const name = field("Ann", { validate: validators.required() });
    const group = formGroup([name]);
    let submits = 0;
    const el = Form({
      group,
      onSubmit: () => void submits++,
      children: FormField({ field: name, label: "Name", children: Input({ value: name.value }) }),
    });
    return { el, submits: () => submits };
  });
  render(() => built.el, root as never);

  (root.querySelector("form")! as unknown as { dispatch(type: string): void }).dispatch("submit");
  assert.equal(built.submits(), 1, "no extra tick: the sync path is unchanged");
});

/* ----------------------------------------------------------------- group -- */

test("async: the group reports validating and validate() resolves every field", async () => {
  const g = createRoot(() => {
    const email: Field<string> = field("ana@x.com", {
      debounceMs: 0,
      validate: async (value: string) => {
        await tick();
        return value.endsWith("@x.com") ? null : "Unknown domain";
      },
    });
    const key: Field<string> = field("bad-key", {
      debounceMs: 0,
      validate: async (value: string) => {
        await tick();
        return value.startsWith("sk-") ? null : "Invalid API key";
      },
    });
    return { email, key, group: formGroup([email, key]) };
  });

  assert.equal(g.group.validating(), true, "both checks are in flight");
  await after(5);
  assert.equal(g.group.validating(), false);
  assert.equal(g.group.valid(), false);
  assert.deepEqual(g.group.errors(), ["Invalid API key"]);

  g.key.value.set("sk-123");
  const verdict = g.group.validate();
  assert.ok(typeof verdict !== "boolean", "an async group answers with a promise");
  assert.equal(await verdict, true);
  assert.equal(g.group.valid(), true);
});

test("async: FormField exposes the in-flight state as a class", async () => {
  const root = doc.createElement("div");
  const f = createRoot(() =>
    field("a@b.co", {
      debounceMs: 0,
      validate: async () => {
        await tick();
        return null;
      },
    }),
  );
  render(() => FormField({ field: f, label: "Email", children: Input({ value: f.value }) }), root as never);

  const wrapper = root.querySelector("div")!;
  assert.match(wrapper.getAttribute("class") ?? "", /rui-validating/);
  await after(5);
  assert.doesNotMatch(wrapper.getAttribute("class") ?? "", /rui-validating/);
});
