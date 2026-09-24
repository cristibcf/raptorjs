/**
 * Varianta de browser: aceeasi aplicatie, host-ul fiind browserul insusi.
 *
 *   pnpm dev:web-shell      (RaptorBundle, live-reload)
 *
 * Interfata arata explicit ce poate si ce nu poate aplicatia pe host-ul curent -
 * exact informatia pe care `bridge.allows(...)` o da inainte de primul apel.
 */
import { For, Show, render } from "@raptor/dom";
import { state } from "@raptor/core";
import { createBrowserSession } from "./session.ts";

const session = createBrowserSession(window);
const draft = state("");
// Se umple dupa primul raspuns al host-ului; lista se randeaza singura cand vine.
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
          placeholder="scrie o nota"
          on:input={(event: Event) => draft.set((event.target as HTMLInputElement).value)}
        />
        <button on:click={() => void add()}>Adauga</button>
        <button on:click={() => void shell.goTo("/arhiva")}>Mergi la /arhiva</button>
        <button on:click={() => void shell.goTo("https://atacator.example/x")}>Navigare interzisa</button>
        <button on:click={() => void shell.announce("nota salvata")}>Notifica</button>
      </div>

      <Show when={() => shell.lastError() !== null}>
        {() => <p class="error">{shell.lastError}</p>}
      </Show>

      <h2>Note</h2>
      <ul>
        <For each={() => shell.notes()}>
          {(note: { text: string; route: string }) => (
            <li>
              {note.text} <small>({note.route})</small>
            </li>
          )}
        </For>
      </ul>

      <h2>Ce poate aplicatia pe acest host</h2>
      <ul class="abilities">
        <For each={() => abilities()}>
          {([method, allowed]: [string, boolean]) => (
            <li class={allowed ? "yes" : "no"}>
              {method}: {allowed ? "da" : "nu"}
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
  // Ruta curenta si lista de posibilitati se cer o data, la pornire.
  void session.shell.start();
  void session.shell.abilities().then((map) => abilities.set(Object.entries(map)));
  session.host.lifecycle.to("ready");
  session.host.lifecycle.to("foreground");
}
