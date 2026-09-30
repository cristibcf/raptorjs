/**
 * Isolating a component's construction from the computation that builds it.
 *
 * **The problem**, found in the 3rd audit round: a component that READS a signal
 * while building its DOM subscribes the caller's computation to that signal. If
 * the caller is a reactive binding - a `Show`, a `For`, any region in a real
 * application - then the first interaction with the component re-runs the whole
 * parent region:
 *
 * ```tsx
 * <Show when={loggedIn}>
 *   <DropdownMenu ... />   // opening the menu rebuilt the entire block
 * </Show>
 * ```
 *
 * It's not just waste: the rebuilt region loses node identity, so focus, scroll
 * position and whatever was typed into an input disappear.
 *
 * Measured across the site catalog: 11 of 93 interactive components did this.
 * The site wrapped them in `untracked(...)` itself, but a workaround written in
 * the consumer means anyone using the library hits the problem without knowing
 * why - so the fix belongs here.
 *
 * **What does NOT break:** `untracked` only clears the current observer. Effects
 * started inside run their own computations, `onCleanup` stays tied to the
 * correct owner, and the bindings inside the component remain fine-grained.
 * Exactly the unwanted thing is lost: the caller's subscription.
 */
import { untracked } from "@raptorstack/raptorjs/dom";

/** Builds a component without subscribing the caller's computation. */
export function isolate<T>(build: () => T): T {
  return untracked(build);
}
