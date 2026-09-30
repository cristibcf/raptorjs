/**
 * Portal - mounts content into another node in the document, keeping the
 * reactive ownership of the place where it was declared.
 *
 * It matters for overlays: a Dialog declared deep in the tree must render into
 * `document.body`, otherwise a parent's `overflow:hidden` or `z-index` clips it.
 * Cleanup removes the nodes from the destination, not from where they were
 * declared - hence the explicit `onCleanup`.
 */
import { onCleanup } from "@raptorstack/raptorjs";
import { block, mountChild, type Block, type Child } from "@raptorstack/raptorjs/dom";
import { doc, type El } from "./env.ts";

export interface PortalProps {
  /** Where it mounts. Defaults to `document.body`, or the document itself. */
  mount?: El;
  children: Child;
}

export function Portal(props: PortalProps): Block {
  return block(() => {
    const target = props.mount ?? doc()?.body ?? doc();
    if (!target) return;

    // Our own container: on cleanup we remove a single node, not N.
    const host = doc().createElement("div");
    host.setAttribute("data-raptor-portal", "");
    target.appendChild(host);

    mountChild(host, props.children, null);

    onCleanup(() => {
      if (host.parentNode) host.parentNode.removeChild(host);
    });
  });
}
