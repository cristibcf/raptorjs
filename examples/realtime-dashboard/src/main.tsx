/**
 * Varianta browser (prin RaptorBundle) a dashboard-ului realtime, in TSX. Pentru
 * un demo self-contained, serverul si clientul ruleaza in aceeasi pagina peste un
 * transport loopback; un setInterval simuleaza feed-ul de metrici server-side.
 *
 * Ruleaza:  cd examples/realtime-dashboard && pnpm install && pnpm dev
 */
import { render, For } from "@raptor/dom";
import { createLoopback, RaptorClient } from "@raptor/wire-client";
import { buildDashboardApp, DASHBOARD_QUERY } from "./app.ts";

function Dashboard(props: { client: RaptorClient }) {
  const { client } = props;
  return (
    <main>
      <h1>RaptorWire realtime dashboard</h1>
      <div class="tiles">
        <div>CPU: {() => client.signal("cpu")() ?? 0}%</div>
        <div>Memorie: {() => client.signal("memory")() ?? 0}%</div>
      </div>
      <ul>
        <For each={() => (client.signal<number[]>("jobs")() ?? []) as number[]}>
          {(id: number) => (
            <li>
              #{id}{" "}
              {() => {
                const job = client.signal(`job:${id}`)() as { name?: string; progress?: number } | undefined;
                return `${job?.name ?? "?"} - ${job?.progress ?? 0}%`;
              }}
            </li>
          )}
        </For>
      </ul>
    </main>
  );
}

async function main() {
  const app = buildDashboardApp();
  const link = createLoopback();
  app.serve(link.server);
  const client = new RaptorClient(link.client);
  await client.connect();
  client.subscribe(DASHBOARD_QUERY);

  const root = document.getElementById("app");
  if (root) render(() => <Dashboard client={client} />, root);

  // Feed server-side de metrici (tranzactie atomica -> un singur commit UI).
  let tick = 0;
  setInterval(() => {
    tick++;
    app.store.transaction(() => {
      app.store.setSignal("cpu", Math.round(20 + 60 * Math.random()));
      app.store.setSignal("memory", Math.round(30 + 50 * Math.random()));
      const jobs = (client.signal<number[]>("jobs")() ?? []) as number[];
      if (jobs.length > 0) {
        const id = jobs[tick % jobs.length]!;
        const current = (client.signal(`job:${id}`)() as { progress?: number } | undefined)?.progress ?? 0;
        app.store.patch(`job:${id}`, { progress: current >= 100 ? 0 : current + 5 });
      }
    });
  }, 1000);
}

void main();
