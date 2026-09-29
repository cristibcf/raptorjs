/**
 * Varianta TSX (browser, prin RaptorBundle) a counter-ului - API-ul developerului
 * din whitepaper sectiunea 9. RaptorBundle transforma JSX cu jsx-runtime-ul
 * fine-grained @raptor/dom -> bindings DOM directe, fara Virtual DOM si fara Vite.
 *
 * Ruleaza:  cd examples/counter && pnpm install && pnpm dev
 */
import { render, state, derived } from "raptorjs/dom";

function Counter() {
  const count = state(0);
  const parity = derived(() => (count() % 2 === 0 ? "par" : "impar"));

  return (
    <section>
      <h1>RaptorJS counter</h1>
      {/* {count} paseaza accesorul -> text-node legat fine-grained */}
      <h2>{count}</h2>
      <p>Valoare {parity}</p>
      <button on:click={() => count.update((n) => n + 1)}>+1</button>
      <button on:click={() => count.update((n) => n - 1)}>-1</button>
    </section>
  );
}

const app = document.getElementById("app");
if (app) render(Counter, app);
