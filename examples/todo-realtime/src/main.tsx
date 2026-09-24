/**
 * Clientul. Nu tine o copie a listei: `client.signal(handle)` ESTE starea, iar
 * fiecare binding din JSX se leaga la exact un semnal. Cand serverul difuzeaza
 * un PATCH pe "todo:3", se actualizeaza randul 3 - nu lista, nu componenta.
 */
import { render, state, For, Show } from "@raptor/dom";
import { RaptorClient, connectWebSocket } from "@raptor/wire-client";
import { TODO_QUERY, type Todo } from "./app.ts";

const WIRE_URL = `ws://${location.host}/raptor`;

type Status = "online" | "offline" | "connecting";

function TodoApp(props: { client: RaptorClient; status: () => Status; reconnect: () => void; drop: () => void }) {
  const { client } = props;
  const draft = state("");

  const order = (): number[] => (client.signal<number[]>("order")() ?? []) as number[];
  const todo = (id: number): Todo | undefined => client.signal(`todo:${id}`)() as Todo | undefined;

  const submit = (): void => {
    const text = draft().trim();
    if (!text) return;
    void client.mutate("add", { text });
    draft.set("");
  };

  return (
    <main>
      <header>
        <h1>Todo realtime</h1>
        <span class={() => "status " + props.status()}>
          {() => ({ online: "conectat", offline: "deconectat", connecting: "se conecteaza..." })[props.status()]}
        </span>
      </header>

      <form
        on:submit={(e: Event) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          placeholder="Ce e de facut?"
          value={draft}
          on:input={(e: Event) => draft.set((e.target as HTMLInputElement).value)}
        />
        <button type="submit">Adauga</button>
      </form>

      <ul>
        <For each={order}>
          {(id: number) => (
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={() => todo(id)?.done ?? false}
                  on:change={() => void client.mutate("toggle", { id })}
                />
                <span class={() => (todo(id)?.done ? "done" : "")}>{() => todo(id)?.text ?? ""}</span>
              </label>
              <button class="rm" on:click={() => void client.mutate("remove", { id })}>
                ×
              </button>
            </li>
          )}
        </For>
      </ul>

      <Show when={() => order().length === 0}>
        <p class="empty">Nimic aici inca. Scrie ceva mai sus — sau in cealalta fereastra.</p>
      </Show>

      <footer>
        <Show when={() => props.status() === "online"}>
          <button on:click={props.drop}>Simuleaza pierderea conexiunii</button>
        </Show>
        <Show when={() => props.status() === "offline"}>
          <button on:click={props.reconnect}>Reconecteaza (resume)</button>
        </Show>
        <p class="hint">
          Deschide acelasi URL intr-o a doua fereastra. Scrie intr-una si uita-te in cealalta — nimeni nu face
          polling si nimeni nu re-cere lista.
        </p>
      </footer>
    </main>
  );
}

async function main(): Promise<void> {
  const status = state<Status>("connecting");

  const client = new RaptorClient(await connectWebSocket(WIRE_URL, { onClose: () => status.set("offline") }), {
    build: "todo-client",
  });
  await client.connect();
  client.subscribe(TODO_QUERY);
  status.set("online");

  /**
   * Reconectare: `resume` pastreaza replica locala si cere serverului doar ce s-a
   * schimbat de la versiunea curenta. Daca serverul poate acoperi golul din
   * op-log trimite delta; daca nu, cade inapoi pe snapshot. In ambele cazuri
   * ecranul converge fara sa clipeasca.
   */
  const reconnect = async (): Promise<void> => {
    status.set("connecting");
    try {
      const transport = await connectWebSocket(WIRE_URL, { onClose: () => status.set("offline") });
      await client.resume(transport, TODO_QUERY);
      status.set("online");
    } catch {
      status.set("offline");
    }
  };

  const root = document.getElementById("app");
  if (root) {
    render(
      () => <TodoApp client={client} status={status} reconnect={() => void reconnect()} drop={() => client.close()} />,
      root,
    );
  }
}

void main();
