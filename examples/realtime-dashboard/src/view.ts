/**
 * The client view: fine-grained DOM bindings over the RaptorWire client's
 * reactive replica. The same component runs headless (mini-dom) or in the
 * browser (Vite) - see src/main.tsx for the TSX variant.
 */
import { render, mountChild, For } from "raptorjs/dom";
import { type RaptorClient } from "@raptor/wire/client";

interface Job {
  name?: string;
  progress?: number;
}

export function renderDashboard(client: RaptorClient, doc: any, root: any): () => void {
  return render(() => {
    const main = doc.createElement("main");

    const cpu = doc.createElement("div");
    mountChild(cpu, () => `CPU: ${client.signal("cpu")() ?? 0}%`, null);
    main.appendChild(cpu);

    const mem = doc.createElement("div");
    mountChild(mem, () => `Memory: ${client.signal("memory")() ?? 0}%`, null);
    main.appendChild(mem);

    const ul = doc.createElement("ul");
    For({
      each: () => (client.signal<number[]>("jobs")() ?? []) as number[],
      children: (id: number) => {
        const li = doc.createElement("li");
        mountChild(
          li,
          () => {
            const job = client.signal(`job:${id}`)() as Job | undefined;
            return `#${id} ${job?.name ?? "?"} - ${job?.progress ?? 0}%`;
          },
          null,
        );
        return li;
      },
    }).mount(ul, null);
    main.appendChild(ul);

    return main;
  }, root);
}
