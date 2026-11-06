/**
 * `hotkeys`: the combos whose key name is a separator or whitespace (v0.2.1).
 *
 * `normalize` split on `+`, trimmed each part and dropped the empty ones, which
 * loses exactly the keys that cannot be written any other way: `"alt+ "`
 * became `"alt+"` and `"mod++"` lost its `+`. Neither produced an error - the
 * binding simply never fired, which is the worst shape a shortcut bug can
 * take, because the source looks right.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "../../src/core/index.ts";
import { installMiniDom } from "../../src/dom/testing/mini-dom.ts";
import { hotkeys } from "../../src/ui/primitives/hotkeys.ts";

const doc = installMiniDom();

/**
 * Presses a key. Dispatched on a detached element and left to bubble to the
 * document, which is where `hotkeys` listens - the same shape the existing
 * primitives test uses.
 */
function press(key: string, mods: { alt?: boolean; ctrl?: boolean; shift?: boolean } = {}): void {
  const target = doc.createElement("div") as unknown as {
    dispatch(type: string, init: Record<string, unknown>): void;
  };
  target.dispatch("keydown", {
    key,
    altKey: mods.alt === true,
    ctrlKey: mods.ctrl === true,
    shiftKey: mods.shift === true,
  });
}

/** Binds `map` in its own scope and returns what fired. */
function bound(map: Record<string, string>): { fired: string[]; dispose: () => void } {
  const fired: string[] = [];
  const dispose = createRoot((d) => {
    const handlers: Record<string, () => void> = {};
    for (const [combo, label] of Object.entries(map)) handlers[combo] = () => void fired.push(label);
    hotkeys(handlers);
    return d;
  });
  return { fired, dispose };
}

test("hotkeys: the space key is expressible, by name and literally", () => {
  const { fired, dispose } = bound({ "mod+space": "by-name", "alt+ ": "literal" });
  try {
    // `event.key` for space is " ", which is what both spellings must compile
    // to. Before this, both compiled to "ctrl+" / "alt+" and never fired.
    press(" ", { ctrl: true });
    press(" ", { alt: true });
    assert.deepEqual(fired, ["by-name", "literal"]);
  } finally {
    dispose();
  }
});

test("hotkeys: the plus key is expressible", () => {
  const { fired, dispose } = bound({ "mod+plus": "by-name", "alt++": "literal" });
  try {
    press("+", { ctrl: true });
    press("+", { alt: true });
    assert.deepEqual(fired, ["by-name", "literal"]);
  } finally {
    dispose();
  }
});

test("hotkeys: the conventional short names resolve to what event.key reports", () => {
  const { fired, dispose } = bound({ esc: "esc", return: "return", up: "up", del: "del" });
  try {
    press("Escape");
    press("Enter");
    press("ArrowUp");
    press("Delete");
    assert.deepEqual(fired, ["esc", "return", "up", "del"]);
  } finally {
    dispose();
  }
});

test("hotkeys: the existing spellings still work, unchanged", () => {
  const { fired, dispose } = bound({ "mod+k": "palette", Escape: "close", "ctrl+shift+p": "command" });
  try {
    press("k", { ctrl: true });
    press("Escape");
    press("P", { ctrl: true, shift: true });
    assert.deepEqual(fired, ["palette", "close", "command"]);
  } finally {
    dispose();
  }
});

test("hotkeys: a combo with no key at all still matches nothing", () => {
  // `"ctrl+"` was what a space binding silently degraded into. It is not a
  // shortcut, and must not start matching bare modifier presses now.
  const { fired, dispose } = bound({ "ctrl+": "degenerate" });
  try {
    press("Control", { ctrl: true });
    press("k", { ctrl: true });
    press(" ", { ctrl: true });
    assert.deepEqual(fired, []);
  } finally {
    dispose();
  }
});
