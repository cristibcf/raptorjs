/**
 * hotkeys - scurtaturi de tastatura, legate de viata componentei.
 *
 * `hotkeys({ "mod+k": open, "Escape": close })`. `mod` = Cmd pe macOS, Ctrl in
 * rest, ca sa nu scrii doua definitii. Implicit scurtaturile NU se declanseaza
 * cat timp scrii intr-un input - altfel "n" ca shortcut ar face imposibila
 * tastarea literei n.
 */
import { onCleanup } from "@raptor/core";
import { onDoc, type El } from "./env.ts";

export interface HotkeyOptions {
  /** Declanseaza si cand focusul e intr-un input/textarea. Implicit `false`. */
  inInputs?: boolean;
  /** Cat timp intoarce `false`, scurtaturile sunt inactive. */
  enabled?: () => boolean;
  /** Ruleaza `preventDefault` la potrivire. Implicit `true`. */
  preventDefault?: boolean;
}

export type HotkeyMap = Record<string, (event: any) => void>;

const IS_MAC =
  typeof (globalThis as any).navigator === "object" &&
  /mac|iphone|ipad/i.test(String((globalThis as any).navigator?.platform ?? ""));

/** Normalizeaza "mod+Shift+K" -> "ctrl+shift+k" (sau "meta+shift+k" pe macOS). */
function normalize(combo: string): string {
  const parts = combo
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  const mods: string[] = [];
  let key = "";
  for (const part of parts) {
    if (part === "mod") mods.push(IS_MAC ? "meta" : "ctrl");
    else if (part === "ctrl" || part === "control") mods.push("ctrl");
    else if (part === "shift") mods.push("shift");
    else if (part === "alt" || part === "option") mods.push("alt");
    else if (part === "meta" || part === "cmd" || part === "command") mods.push("meta");
    else key = part;
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

/** Inregistreaza scurtaturile pe document. Se curata automat la dispose. */
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
