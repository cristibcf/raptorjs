/**
 * hotkeys - keyboard shortcuts, tied to the component's life.
 *
 * `hotkeys({ "mod+k": open, "Escape": close })`. `mod` = Cmd on macOS, Ctrl
 * elsewhere, so you don't write two definitions. By default shortcuts do NOT
 * fire while you're typing in an input - otherwise "n" as a shortcut would make
 * typing the letter n impossible.
 *
 * Keys whose name is a separator or whitespace are written by name:
 * `"mod+space"` and `"mod+plus"` (`"alt+ "` and `"mod++"` also work). See
 * `KEY_ALIASES` for the rest - `esc`, `return`, `up`/`down`/`left`/`right`.
 */
import { onCleanup } from "@raptorstack/raptorjs";
import { onDoc, type El } from "./env.ts";

export interface HotkeyOptions {
  /** Fire even when focus is in an input/textarea. Defaults to `false`. */
  inInputs?: boolean;
  /** While this returns `false`, the shortcuts are inactive. */
  enabled?: () => boolean;
  /** Runs `preventDefault` on a match. Defaults to `true`. */
  preventDefault?: boolean;
}

export type HotkeyMap = Record<string, (event: any) => void>;

const IS_MAC =
  typeof (globalThis as any).navigator === "object" &&
  /mac|iphone|ipad/i.test(String((globalThis as any).navigator?.platform ?? ""));

/**
 * Names for keys whose conventional spelling is not what `event.key` reports.
 * Without these, `"mod+space"` and `"esc"` compiled to a binding no event can
 * ever produce, and did it silently - the shortcut simply never fired.
 */
const KEY_ALIASES: Record<string, string> = {
  space: " ",
  spacebar: " ",
  esc: "escape",
  return: "enter",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  plus: "+",
};

/**
 * Splits a combo on `+`, keeping the two keys that `+` itself cannot express.
 *
 * Splitting and dropping the empty parts (what this did until v0.2.1) loses
 * exactly the keys whose name is a separator or whitespace: `"alt+ "` became
 * `["alt"]` and normalized to `"alt+"`, which no keypress produces, and
 * `"mod++"` lost its `+`. Both failed silently - the worst kind of shortcut
 * bug, because the binding looks right in the source.
 */
function splitCombo(combo: string): string[] {
  const raw = combo.split("+");
  const parts: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const piece = raw[i]!;
    const trimmed = piece.trim().toLowerCase();
    if (trimmed.length > 0) {
      parts.push(trimmed);
    } else if (piece.length > 0) {
      // Whitespace: the space key, which `event.key` reports as " ".
      parts.push(" ");
    } else if (i > 0 && i === raw.length - 1) {
      // A trailing empty from `"mod++"`: the `+` key itself.
      parts.push("+");
    }
  }
  return parts;
}

/** Normalizes "mod+Shift+K" -> "ctrl+shift+k" (or "meta+shift+k" on macOS). */
function normalize(combo: string): string {
  const mods: string[] = [];
  let key = "";
  for (const part of splitCombo(combo)) {
    if (part === "mod") mods.push(IS_MAC ? "meta" : "ctrl");
    else if (part === "ctrl" || part === "control") mods.push("ctrl");
    else if (part === "shift") mods.push("shift");
    else if (part === "alt" || part === "option") mods.push("alt");
    else if (part === "meta" || part === "cmd" || part === "command") mods.push("meta");
    else key = KEY_ALIASES[part] ?? part;
  }
  mods.sort();
  return [...mods, key].join("+");
}

function comboOf(e: any): string {
  const mods: string[] = [];
  if (e.altKey) mods.push("alt");
  if (e.ctrlKey) mods.push("ctrl");
  if (e.metaKey) mods.push("meta");
  if (e.shiftKey) mods.push("shift");
  mods.sort();
  return [...mods, String(e.key ?? "").toLowerCase()].join("+");
}

const TYPING = new Set(["input", "textarea", "select"]);

function isTyping(target: El): boolean {
  if (!target) return false;
  const tag = String(target.tagName ?? "").toLowerCase();
  if (TYPING.has(tag)) return true;
  return target.getAttribute?.("contenteditable") === "true";
}

/** Registers the shortcuts on the document. Cleans up automatically on dispose. */
export function hotkeys(map: HotkeyMap, options?: HotkeyOptions): void {
  const bindings = new Map<string, (event: any) => void>();
  for (const combo of Object.keys(map)) bindings.set(normalize(combo), map[combo]!);

  const unbind = onDoc("keydown", (e: any) => {
    if (options?.enabled && !options.enabled()) return;
    if (!options?.inInputs && isTyping(e.target)) return;
    const handler = bindings.get(comboOf(e));
    if (!handler) return;
    if (options?.preventDefault !== false) e.preventDefault?.();
    handler(e);
  });
  onCleanup(unbind);
}
