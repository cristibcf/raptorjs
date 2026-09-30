/**
 * The client. It keeps no copy of the list: `client.signal(handle)` IS the state,
 * and each binding in the JSX binds to exactly one signal. When the server
 * broadcasts a PATCH on "todo:3", row 3 updates - not the list, not the component.
 */
import { render, state, For, Show } from "raptorjs/dom";
import { RaptorClient, connectWebSocket } from "@raptor/wire/client";
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
          {() => ({ online: "connected", offline: "disconnected", connecting: "connecting..." })[props.status()]}
        </span>
      </header>

      <form
        on:submit={(e: Event) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          placeholder="What needs doing?"
          value={draft}
          on:input={(e: Event) => draft.set((e.target as HTMLInputElement).value)}
        />
        <button type="submit">Add</button>
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
        <p class="empty">Nothing here yet. Type something above — or in the other window.</p>
      </Show>

      <footer>
        <Show when={() => props.status() === "online"}>
          <button on:click={props.drop}>Simulate losing the connection</button>
        </Show>
        <Show when={() => props.status() === "offline"}>
          <button on:click={props.reconnect}>Reconnect (resume)</button>
        </Show>
        <p class="hint">
          Open the same URL in a second window. Type in one and watch the other — nobody polls
          and nobody re-requests the list.
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
   * Reconnect: `resume` keeps the local replica and asks the server only for what
   * has changed since the current version. If the server can cover the gap from
   * the op-log it sends a delta; if not, it falls back to a snapshot. In both
   * cases the screen converges without flickering.
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
