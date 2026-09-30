/**
 * Fine-grained control flow: `For` (keyed list with node reuse) and `Show`
 * (conditional). Each branch/element is created in its own scope (createRoot) so
 * it is not destroyed by the parent effect's re-run, and it is deterministically
 * destroyed when it disappears (whitepaper 8.3 "list specialization").
 */
import { effect, createRoot } from "@raptorstack/raptorjs";
import { type Block, type Child, block, mountChild, disposeDetached } from "./runtime.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;
type Accessor<T> = () => T;

function doc(): any {
  return (globalThis as any).document;
}

export interface ForProps<T> {
  each: Accessor<readonly T[]>;
  children: (item: T, index: number) => Child;
}

interface Entry {
  node: El;
  dispose: () => void;
  /** The last run in which the item was seen; see the cleanup loop. */
  seenIn: number;
}

/** Keyed list: reuses nodes for unchanged items, moves the minimum. */
export function For<T>(props: ForProps<T>): Block {
  return block((parent, anchor) => {
    const end = doc().createComment("for");
    if (anchor) parent.insertBefore(end, anchor);
    else parent.appendChild(end);

    const cache = new Map<T, Entry>();
    /** The current run number: stands in for the set of seen items. */
    let pass = 0;

    effect(() => {
      const items = props.each();
      pass++;

      // Create/reuse nodes for the current items.
      const nodes: El[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        let entry = cache.get(item);
        if (!entry) {
          let node!: El;
          let dispose!: () => void;
          createRoot((d) => {
            node = materialize(props.children(item, i));
            dispose = d;
          });
          entry = { node, dispose, seenIn: pass };
          cache.set(item, entry);
        } else {
          entry.seenIn = pass;
        }
        nodes.push(entry.node);
      }

      // Remove the items that disappeared (deterministic dispose). We detach the
      // node in a single removeChild, then dispose reactively without redundant
      // DOM removals.
      //
      // The per-entry marking (`seenIn`) stands in for a `Set` rebuilt on every
      // run: on a list of 10,000 rows, that Set would mean 10,000 insertions and
      // as many lookups just to find out, usually, that nothing was removed. And
      // if the cache size equals the list size, every entry was touched just now,
      // so there is nothing to remove and the traversal can be skipped entirely -
      // the common case on update/select/swap.
      if (cache.size > items.length) {
        for (const [item, entry] of cache) {
          if (entry.seenIn !== pass) {
            disposeDetached(entry.node, entry.dispose);
            cache.delete(item);
          }
        }
      }

      // Reorder with minimal moves (insertBefore only when the position is wrong).
      let nextSibling: El = end;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i]!;
        if (node.nextSibling !== nextSibling || node.parentNode !== parent) {
          parent.insertBefore(node, nextSibling);
        }
        nextSibling = node;
      }
    });
  });
}

export interface ShowProps {
  when: Accessor<unknown>;
  children: Child;
  fallback?: Child;
}

/** Conditional: mounts `children` when `when` is truthy, otherwise `fallback`. */
export function Show(props: ShowProps): Block {
  return block((parent, anchor) => {
    const end = doc().createComment("show");
    if (anchor) parent.insertBefore(end, anchor);
    else parent.appendChild(end);

    let current: El | null = null;
    let disposeBranch: (() => void) | null = null;
    /** The branch currently mounted; `null` means "nothing yet". */
    let mounted: boolean | null = null;

    effect(() => {
      const visible = !!props.when();

      // `when` can re-evaluate without the result changing: it is enough that
      // one of its dependencies was touched. In that case the current branch is
      // already the correct one and must NOT be rebuilt - otherwise a `Show`
      // would lose its subtree state (scroll, inputs, lazy components) on every
      // unrelated change.
      if (mounted === visible) return;
      mounted = visible;

      // Branch change: detach first, then dispose.
      if (current) {
        const node = current;
        const d = disposeBranch;
        current = null;
        disposeBranch = null;
        if (d) disposeDetached(node, d);
        else if (node.parentNode) node.parentNode.removeChild(node);
      } else if (disposeBranch) {
        disposeBranch();
        disposeBranch = null;
      }

      const branch = visible ? props.children : props.fallback;
      if (branch == null) return;
      createRoot((d) => {
        current = materialize(branch);
        disposeBranch = d;
      });
      if (current) parent.insertBefore(current, end);
    });
  });
}

/** Reduce a Child to a single DOM node (wrapping text/lists in a span). */
function materialize(child: Child): El {
  if (child == null || child === true || child === false) {
    return doc().createTextNode("");
  }
  if (typeof child === "string" || typeof child === "number") {
    return doc().createTextNode(String(child));
  }
  if (typeof child === "object" && typeof (child as any).nodeType === "number") {
    return child;
  }
  // Block/array/accessor -> wrap in a managed span.
  const wrapper = doc().createElement("span");
  mountChild(wrapper, child, null);
  return wrapper;
}
