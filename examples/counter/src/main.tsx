/**
 * TSX variant (browser, via RaptorBundle) of the counter - the developer API
 * from whitepaper section 9. RaptorBundle transforms JSX with the fine-grained
 * @raptorstack/raptorjs/dom jsx-runtime -> direct DOM bindings, with no Virtual DOM and no Vite.
 *
 * Run:  cd examples/counter && pnpm install && pnpm dev
 */
import { render, state, derived } from "@raptorstack/raptorjs/dom";

function Counter() {
  const count = state(0);
  const parity = derived(() => (count() % 2 === 0 ? "even" : "odd"));

  return (
    <section>
      <h1>RaptorJS counter</h1>
      {/* {count} passes the accessor -> fine-grained bound text node */}
      <h2>{count}</h2>
      <p>Value {parity}</p>
      <button on:click={() => count.update((n) => n + 1)}>+1</button>
      <button on:click={() => count.update((n) => n - 1)}>-1</button>
    </section>
  );
}

const app = document.getElementById("app");
if (app) render(Counter, app);
