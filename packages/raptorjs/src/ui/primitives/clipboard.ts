/**
 * clipboard - copy to the clipboard with a temporary `copied` state.
 *
 * `const { copy, copied } = clipboard()` then
 * `R.button({ "on:click": () => copy(text) }, () => copied() ? "copied" : "copy")`.
 * The reset timer is cancelled on dispose, so it doesn't write into a dead signal.
 */
import { state, onCleanup, type Accessor } from "raptorjs";

export interface Clipboard {
  copy: (text: string) => Promise<boolean>;
  copied: Accessor<boolean>;
  error: Accessor<unknown>;
  reset: () => void;
}

export function clipboard(resetAfter = 1500): Clipboard {
  const copied = state(false);
  const error = state<unknown>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  onCleanup(clear);

  const reset = (): void => {
    clear();
    copied.set(false);
    error.set(null);
  };

  const copy = async (text: string): Promise<boolean> => {
    clear();
    try {
      const nav = (globalThis as any).navigator;
      if (!nav?.clipboard?.writeText) throw new Error("clipboard unavailable");
      await nav.clipboard.writeText(text);
      error.set(null);
      copied.set(true);
      if (resetAfter > 0) {
        timer = setTimeout(() => {
          timer = null;
          copied.set(false);
        }, resetAfter);
      }
      return true;
    } catch (err) {
      error.set(err);
      copied.set(false);
      return false;
    }
  };

  return { copy, copied: () => copied(), error: () => error(), reset };
}
