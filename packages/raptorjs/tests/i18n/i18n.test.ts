/**
 * i18n: locale signal, catalogues, interpolation, plural selection.
 *
 * Two things are being checked here. The first is correctness of the hard
 * part: Romanian has three plural forms and Polish four, and the expectations
 * below are the CLDR rules, not `count === 1`. The second is the reason this
 * belongs in RaptorJS rather than in an application - switching language
 * rewrites the text nodes that read `t()` and nothing else: no component
 * re-runs, no element is created, which is exactly the claim fine-grained
 * reactivity makes against a VDOM (whitepaper 2, 6).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "../../src/dom/testing/mini-dom.ts";
import { render } from "../../src/dom/runtime.ts";
import { R } from "../../src/dom/hyperscript.ts";
import {
  hasMessages,
  loadMessages,
  locale,
  locales,
  plural,
  setFallbackLocale,
  setLocale,
  setMissingKeyHandler,
  t,
  withLocale,
} from "../../src/i18n/index.ts";

installMiniDom();

/* ----------------------------------------------------------------- plurals - */

/**
 * One catalogue, four forms, distinct text per form - so the assertion is on
 * the message the user would read, not on an internal category name.
 */
loadMessages("ro", {
  "jobs.count": {
    one: "{count} sarcină",
    few: "{count} sarcini",
    other: "{count} de sarcini",
  },
  "inbox.title": "Mesaje",
  greeting: "Bună, {name}!",
});
loadMessages("pl", {
  "jobs.count": {
    one: "{count} zadanie",
    few: "{count} zadania",
    many: "{count} zadań",
    other: "{count} zadania",
  },
  "inbox.title": "Wiadomości",
});
loadMessages("en", {
  "jobs.count": { one: "{count} job", other: "{count} jobs" },
  "inbox.title": "Inbox",
  greeting: "Hello, {name}!",
  braces: "literal {unknown} stays",
  markup: "keep <b>{what}</b> as-is",
});

test("i18n: Romanian picks one of three plural forms (CLDR, not count === 1)", async () => {
  await setLocale("ro");
  // one: 1. few: 0, and 2..19 by the mod-100 rule (so 101 too). other: the rest.
  assert.equal(plural("jobs.count", 0), "0 sarcini");
  assert.equal(plural("jobs.count", 1), "1 sarcină");
  assert.equal(plural("jobs.count", 2), "2 sarcini");
  assert.equal(plural("jobs.count", 5), "5 sarcini");
  assert.equal(plural("jobs.count", 11), "11 sarcini");
  assert.equal(plural("jobs.count", 21), "21 de sarcini");
  assert.equal(plural("jobs.count", 101), "101 sarcini");
});

test("i18n: Polish picks one of four plural forms", async () => {
  await setLocale("pl");
  assert.equal(plural("jobs.count", 0), "0 zadań");
  assert.equal(plural("jobs.count", 1), "1 zadanie");
  assert.equal(plural("jobs.count", 2), "2 zadania");
  assert.equal(plural("jobs.count", 5), "5 zadań");
  assert.equal(plural("jobs.count", 11), "11 zadań");
  assert.equal(plural("jobs.count", 21), "21 zadań");
  assert.equal(plural("jobs.count", 101), "101 zadań");
});

test("i18n: English needs only two forms, and gets exactly two", async () => {
  await setLocale("en");
  assert.equal(plural("jobs.count", 1), "1 job");
  assert.equal(plural("jobs.count", 0), "0 jobs");
  assert.equal(plural("jobs.count", 21), "21 jobs");
  // A bare `t()` on a pluralized entry reads `other`, the form every locale has.
  assert.equal(t("jobs.count", { count: 3 }), "3 jobs");
});

/* ----------------------------------------------------------- interpolation - */

test("i18n: interpolation fills what it knows and leaves alone what it does not", async () => {
  await setLocale("en");
  assert.equal(t("greeting", { name: "Ana" }), "Hello, Ana!");
  // No values at all: the template is returned untouched, not blanked.
  assert.equal(t("greeting"), "Hello, {name}!");
  // An unknown placeholder survives verbatim, so a typo is visible and a
  // message that legitimately contains braces is not destroyed.
  assert.equal(t("braces"), "literal {unknown} stays");
  assert.equal(t("braces", { other: "x" }), "literal {unknown} stays");
  // Nothing is escaped or stripped: `t()` returns text, and the DOM runtime
  // binds it as text. Escaping here would double-escape.
  assert.equal(t("markup", { what: "a & b <c>" }), "keep <b>a & b <c></b> as-is");
  // Numbers go in as `String(value)`: grouping an id into "123,456" would be
  // worse than useless. Quantities get formatted before they are passed.
  assert.equal(t("greeting", { name: 123456 }), "Hello, 123456!");
});

/* ------------------------------------------------------- fallback + missing - */

test("i18n: a region tag falls back to its base language, then to the fallback locale", async () => {
  setFallbackLocale("en");
  await setLocale("ro-MD");
  assert.equal(locale(), "ro-MD");
  assert.equal(t("inbox.title"), "Mesaje", "ro-MD has no catalogue; ro does");
  assert.equal(t("braces"), "literal {unknown} stays", "neither ro-MD nor ro has it; en does");
});

test("i18n: a missing key returns the key and is reported once per locale", async () => {
  const misses: string[] = [];
  setMissingKeyHandler((key, tag) => void misses.push(`${key}@${tag}`));
  try {
    await setLocale("en");
    assert.equal(t("nope.not.here"), "nope.not.here", "the key itself, not a throw and not empty");
    assert.equal(t("nope.not.here"), "nope.not.here");
    assert.equal(plural("nope.not.here", 3), "nope.not.here");
    assert.deepEqual(misses, ["nope.not.here@en"], "once, not once per binding recompute");

    await setLocale("ro");
    assert.equal(t("nope.not.here"), "nope.not.here");
    assert.deepEqual(misses, ["nope.not.here@en", "nope.not.here@ro"], "a new locale is a new report");
  } finally {
    setMissingKeyHandler(null);
  }
});

/* ------------------------------------------------- the reason it lives here - */

test("i18n: setLocale re-binds the text node without re-running the component", async () => {
  await setLocale("en");
  const root = (globalThis as unknown as { document: { createElement(t: string): MiniElement } }).document.createElement(
    "div",
  );

  let runs = 0;
  function Header(): MiniElement {
    runs++;
    return R.h1({ class: "title" }, () => t("inbox.title")) as MiniElement;
  }

  render(Header, root as never);
  assert.equal(root.querySelector("h1")!.textContent, "Inbox");
  assert.equal(runs, 1);

  resetStats();
  await setLocale("ro");

  assert.equal(root.querySelector("h1")!.textContent, "Mesaje");
  assert.equal(runs, 1, "the component did not re-run");
  assert.equal(stats.createElement, 0, "no element was created");
  assert.equal(stats.createText, 0, "no text node was created");
  assert.equal(stats.insert, 0, "nothing was re-inserted");
  assert.equal(stats.textUpdate, 1, "exactly one text node was rewritten");

  await setLocale("pl");
  assert.equal(root.querySelector("h1")!.textContent, "Wiadomości");
  assert.equal(stats.textUpdate, 2);
});

/* --------------------------------------------------------- lazy catalogues - */

test("i18n: a lazy catalogue loads once, and the locale flips only when it is ready", async () => {
  let calls = 0;
  loadMessages("de", async () => {
    calls++;
    await Promise.resolve();
    return { default: { "inbox.title": "Posteingang" } };
  });

  assert.ok(locales().includes("de"), "registered before it is loaded");
  assert.equal(hasMessages("de"), false, "a lazy catalogue that has not run is not loaded");

  await setLocale("en");
  const switching = setLocale("de");
  assert.equal(locale(), "en", "still the old language: no frame of raw keys");
  await switching;

  assert.equal(locale(), "de");
  assert.equal(t("inbox.title"), "Posteingang");
  assert.equal(hasMessages("de"), true);

  await setLocale("en");
  await setLocale("de");
  assert.equal(calls, 1, "the loader ran once, not once per switch");
});

test("i18n: a catalogue arriving after mount re-binds the text that fell back", async () => {
  await setLocale("en");
  const root = (globalThis as unknown as { document: { createElement(t: string): MiniElement } }).document.createElement(
    "div",
  );
  setMissingKeyHandler(() => {});
  try {
    render(() => R.p({}, () => t("late.key")) as MiniElement, root as never);
    assert.equal(root.querySelector("p")!.textContent, "late.key", "the key, while it is missing");

    loadMessages("en", { "late.key": "arrived" });
    assert.equal(root.querySelector("p")!.textContent, "arrived", "re-bound without a locale change");
  } finally {
    setMissingKeyHandler(null);
  }
});

/* ------------------------------------------------------------ server-side -- */

test("i18n: withLocale renders in another language without touching the signal", async () => {
  await setLocale("en");
  // Ten emails in ten languages out of one process, which is what an SSR
  // request or a notification job needs: the global locale is unchanged.
  const rendered = ["ro", "pl", "en"].map((tag) => withLocale(tag, () => t("inbox.title")));
  assert.deepEqual(rendered, ["Mesaje", "Wiadomości", "Inbox"]);
  assert.equal(locale(), "en", "the current locale was not moved");
  // Nested, and restored even if the body throws.
  assert.throws(() =>
    withLocale("ro", () => {
      assert.equal(locale(), "ro");
      throw new Error("boom");
    }),
  );
  assert.equal(locale(), "en");
});

test("i18n: no window assumption - the module works with globalThis.window absent", () => {
  assert.equal((globalThis as { window?: unknown }).window, undefined, "the mini-DOM installs no window");
  assert.equal(withLocale("ro", () => plural("jobs.count", 2)), "2 sarcini");
});
