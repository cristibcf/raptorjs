/**
 * The example's own claim, asserted: switching language on a mounted screen
 * rewrites only the bound text nodes, and the lazy catalogues really are lazy.
 *
 * It uses the example's catalogues rather than fixtures, so a wrong plural
 * form in a shipped locale file fails here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats } from "@raptorstack/raptorjs/dom/testing";
import { render } from "@raptorstack/raptorjs/dom";
import { state } from "@raptorstack/raptorjs";
import { hasMessages, locale, plural, setLocale, withLocale } from "@raptorstack/raptorjs/i18n";
import { registerLocales, Screen, SUPPORTED } from "../src/app.ts";

const doc = installMiniDom();
registerLocales();

test("the example registers ten languages with only the fallback loaded", () => {
  assert.equal(SUPPORTED.length, 10);
  assert.equal(hasMessages("en"), true, "the fallback is eager");
  assert.equal(hasMessages("ro"), false, "registering a loader loads nothing");
});

test("a language switch rewrites the bound text nodes and nothing else", async () => {
  const jobs = state(3);
  const root = doc.createElement("div");
  await setLocale("en");
  render(() => Screen(() => jobs()) as never, root);

  // mini-dom's querySelector matches tag names only, so the second <p> is the
  // pluralized line.
  const jobsLine = (): string => root.querySelectorAll("p")[1]!.textContent;
  assert.equal(root.querySelector("h1")!.textContent, "Assistant");
  assert.equal(jobsLine(), "3 jobs running");

  resetStats();
  await setLocale("ro");

  assert.equal(root.querySelector("h1")!.textContent, "Asistent");
  assert.equal(jobsLine(), "3 sarcini în curs");
  assert.equal(hasMessages("ro"), true, "the catalogue arrived with the switch");
  assert.equal(stats.createElement, 0, "no element created");
  assert.equal(stats.createText, 0, "no text node created");
  assert.equal(stats.insert, 0, "nothing re-inserted");
  assert.equal(stats.textUpdate, 4, "one update per bound text node");
});

test("the shipped catalogues cover the plural forms their language needs", async () => {
  await setLocale("en");
  // Romanian: `few` for 0 and the mod-100 range, so 101 takes it and 21 does not.
  assert.deepEqual(
    [0, 1, 21, 101].map((n) => withLocale("ro", () => plural("jobs.count", n))),
    ["0 sarcini în curs", "1 sarcină în curs", "21 de sarcini în curs", "101 sarcini în curs"],
  );
  // Polish: `many` is the common form, which a `count === 1` check never finds.
  await setLocale("pl");
  assert.deepEqual(
    [1, 2, 5, 21].map((n) => plural("jobs.count", n)),
    ["1 zadanie w toku", "2 zadania w toku", "5 zadań w toku", "21 zadań w toku"],
  );
  assert.equal(locale(), "pl");
});
