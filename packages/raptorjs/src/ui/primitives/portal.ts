/**
 * Portal - monteaza continutul in alt nod din document, pastrand ownership-ul
 * reactiv al locului unde a fost declarat.
 *
 * Conteaza pentru overlay-uri: un Dialog declarat adanc in arbore trebuie sa
 * randeze in `document.body`, altfel `overflow:hidden` sau `z-index`-ul unui
 * parinte il taie. Cleanup-ul scoate nodurile din destinatie, nu din locul
 * declararii - de unde si `onCleanup` explicit.
 */
import { onCleanup } from "raptorjs";
import { block, mountChild, type Block, type Child } from "raptorjs/dom";
import { doc, type El } from "./env.ts";

export interface PortalProps {
  /** Unde se monteaza. Implicit `document.body`, sau documentul insusi. */
  mount?: El;
  children: Child;
}

export function Portal(props: PortalProps): Block {
  return block(() => {
    const target = props.mount ?? doc()?.body ?? doc();
    if (!target) return;

    // Un container propriu: la cleanup scoatem un singur nod, nu N.
    const host = doc().createElement("div");
    host.setAttribute("data-raptor-portal", "");
    target.appendChild(host);

    mountChild(host, props.children, null);

    onCleanup(() => {
      if (host.parentNode) host.parentNode.removeChild(host);
    });
  });
}
