/**
 * Browser variant: the same application, with the browser itself as the host.
 *
 *   pnpm dev:web-shell      (RaptorBundle, live-reload)
 *
 * The UI shows explicitly what the app can and cannot do on the current host -
 * exactly the information that `bridge.allows(...)` gives before the first call.
 */
import { For, Show, render } from "@raptorstack/raptorjs/dom";
import { state } from "@raptorstack/raptorjs";
import { createBrowserSession } from "./session.ts";

const session = createBrowserSession(window);
const draft = state("");
// Filled after the host's first response; the list renders itself when it arrives.
const abilities = state<ReadonlyArray<[string, boolean]>>([]);

function Shell() {
  const shell = session.shell;

  const add = async (): Promise<void> => {
    const text = draft().trim();
    if (!text) return;
    await shell.addNote(text);
    draft.set("");
  };

  return (
    <section>
      <h1>{shell.title}</h1>
      <p class="summary">{shell.summary}</p>

      <div class="row">
        <input
          value={draft}
          placeholder="write a note"
          on:input={(event: Event) => draft.set((event.target as HTMLInputElement).value)}
        />
        <button on:click={() => void add()}>Add</button>
        <button on:click={() => void shell.goTo("/arhiva")}>Go to /arhiva</button>
        <button on:click={() => void shell.goTo("https://atacator.example/x")}>Forbidden navigation</button>
        <button on:click={() => void shell.announce("note saved")}>Notify</button>
      </div>

      <Show when={() => shell.lastError() !== null}>
        {() => <p class="error">{shell.lastError}</p>}
      </Show>

      <h2>Notes</h2>
      <ul>
        <For each={() => shell.notes()}>
          {(note: { text: string; route: string }) => (
            <li>
              {note.text} <small>({note.route})</small>
            </li>
          )}
        </For>
      </ul>

      <h2>What the app can do on this host</h2>
      <ul class="abilities">
        <For each={() => abilities()}>
          {([method, allowed]: [string, boolean]) => (
            <li class={allowed ? "yes" : "no"}>
              {method}: {allowed ? "yes" : "no"}
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

const root = document.getElementById("app");
if (root) {
  render(Shell, root);
  // The current route and the ability list are requested once, at startup.
  void session.shell.start();
  void session.shell.abilities().then((map) => abilities.set(Object.entries(map)));
  session.host.lifecycle.to("ready");
  session.host.lifecycle.to("foreground");
}
