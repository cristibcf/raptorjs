/**
 * ErrorBoundary: contains a thrown error to a subtree instead of letting it tear
 * down the whole app. It calls `children` (a thunk); if building them throws, or
 * if any computation created under them throws later (routed through the reactive
 * core's `onError`), it swaps to `fallback`. `reset()` re-mounts the children.
 *
 * `children` is a function on purpose: it is invoked INSIDE the boundary's own
 * scope, so the content and its effects are owned by the boundary and its errors
 * reach this handler. Eagerly-built children (`children: <App/>`) are created in
 * the caller's scope before the boundary exists, so their errors would escape it.
 *
 * The owner is captured once so both the children scope and the fallback scope
 * hang off the boundary - a nested boundary still catches, and everything is
 * disposed when the boundary itself unmounts.
 */
import { createRoot, onError, onCleanup, getOwner, runWithOwner } from "@raptorstack/raptorjs";
import { block, mountChild, disposeDetached, type Block, type Child } from "./runtime.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

function doc(): any {
  return (globalThis as any).document;
}

/** Reduce a Child to a single DOM node (wrapping text/lists in a span). */
function materialize(child: Child): El {
  if (child == null || child === true || child === false) return doc().createTextNode("");
  if (typeof child === "string" || typeof child === "number") return doc().createTextNode(String(child));
  if (typeof child === "object" && typeof (child as any).nodeType === "number") return child as El;
  const wrapper = doc().createElement("span");
  mountChild(wrapper, child, null);
  return wrapper;
}

/** A fallback: a static Child, or a function of the error and a `reset` callback. */
export type ErrorFallback = Child | ((error: unknown, reset: () => void) => Child);

export interface ErrorBoundaryProps {
  fallback: ErrorFallback;
  /** A thunk returning the content, invoked inside the boundary's scope. */
  children: () => Child;
}

/** Renders `children`, swapping to `fallback` if they (or their effects) throw. */
export function ErrorBoundary(props: ErrorBoundaryProps): Block {
  return block((parent, anchor) => {
    const owner = getOwner();
    const end = doc().createComment("error-boundary");
    if (anchor) parent.insertBefore(end, anchor);
    else parent.appendChild(end);

    let node: El | null = null;
    let dispose: (() => void) | null = null;
    let mode: "children" | "fallback" = "children";

    const detach = (): void => {
      if (node) {
        const n = node;
        const d = dispose;
        node = null;
        dispose = null;
        if (d) disposeDetached(n, d);
        else if (n.parentNode) n.parentNode.removeChild(n);
      }
    };

    const showFallback = (error: unknown): void => {
      detach();
      mode = "fallback";
      runWithOwner(owner, () => {
        createRoot((d) => {
          dispose = d;
          const fb =
            typeof props.fallback === "function"
              ? (props.fallback as (e: unknown, reset: () => void) => Child)(error, reset)
              : props.fallback;
          node = materialize(fb);
        });
      });
      if (node) parent.insertBefore(node, end);
    };

    const reset = (): void => {
      showChildren();
    };

    const showChildren = (): void => {
      detach();
      mode = "children";
      // `building` distinguishes a throw during the synchronous build (deferred,
      // so we don't dispose the scope we are still inside) from a later throw in
      // an effect (swapped to the fallback right away).
      let building = true;
      let failure: { error: unknown } | null = null;
      runWithOwner(owner, () => {
        createRoot((d) => {
          dispose = d;
          onError((error) => {
            if (building) failure = { error };
            else if (mode === "children") showFallback(error);
          });
          try {
            node = materialize(props.children());
          } catch (error) {
            failure = { error };
          } finally {
            building = false;
          }
        });
      });
      if (failure) {
        detach(); // discard the failed children scope, then show the fallback
        showFallback((failure as { error: unknown }).error);
        return;
      }
      if (node) parent.insertBefore(node, end);
    };

    onCleanup(detach);
    showChildren();
  });
}
