/**
 * Which catalog components re-run the PARENT computation when you touch them.
 *
 * Context: a component that READS a signal while it is being built subscribes
 * the caller's computation to that signal. If the caller is a reactive binding
 * - a `Show`, a `For`, any region in a real application - then interacting with
 * the component re-runs the whole parent region, not just the component. The
 * symptom: a dropdown that, on opening, rebuilds the page around it.
 *
 * The site works around this by building each demo in `untracked(...)`. But the
 * workaround in the consumer is a sign that the problem is in the library: anyone
 * who uses `@raptorstack/raptorjs/ui` inside a binding hits it without knowing why.
 *
 * We measure the symptom, not the cause: we mount the demo INSIDE an effect, click
 * the first button in it, and see whether the effect re-ran.
 *
 * This file is not application code - nothing imports it, so it never reaches the
 * site's bundle. It is the entry point the bundler hands to a test.
 */
import { effect, createRoot } from "@raptorstack/raptorjs";
import { mountChild } from "@raptorstack/raptorjs/dom";
import { CATALOG } from "./index.ts";

export interface LeakReport {
  /** Components where an interaction re-runs the parent computation. */
  leaking: string[];
  checked: number;
  /** Demos that could not be exercised (no button to click). */
  skipped: number;
}

function firstButton(host: any): any {
  const direct = host.querySelectorAll?.("button") ?? [];
  return direct.length > 0 ? direct[0] : null;
}

export function findLeaks(): LeakReport {
  const doc = (globalThis as { document?: any }).document;
  const leaking: string[] = [];
  let checked = 0;
  let skipped = 0;

  for (const group of CATALOG) {
    for (const item of group.items) {
      let runs = 0;
      let host: any = null;
      let dispose = (): void => {};
      try {
        dispose = createRoot((d) => {
          effect(() => {
            runs += 1;
            host = doc.createElement("div");
            mountChild(host, item.demo() as never, null);
          });
          return d;
        });
      } catch {
        dispose();
        skipped += 1;
        continue;
      }

      const button = host && firstButton(host);
      if (!button) {
        dispose();
        skipped += 1;
        continue;
      }

      checked += 1;
      const inainte = runs;
      try {
        button.click?.();
      } catch {
        /* the demo may need something the mini-dom lacks; that is not what we measure */
      }
      if (runs > inainte) leaking.push(`${group.title} / ${item.name}`);
      dispose();
    }
  }

  return { leaking, checked, skipped };
}

(globalThis as Record<string, unknown>).__catalogLeaks = findLeaks();
