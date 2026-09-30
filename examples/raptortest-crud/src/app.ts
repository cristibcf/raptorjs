/**
 * The system under test (SUT): a mini CRUD cart with the classic RT-184 bug from
 * the whitepaper (Appendix A): "Add to cart" then immediate navigation to Cart; a
 * stale GET /cart can overwrite the correct UI state (last-write-wins on the client).
 *
 * The app does NOT know the backend is a synthetic RaptorTwin: it makes normal
 * requests through the harness context (whitepaper §2, the "real client code" principle).
 */
import {
  RaptorTwin,
  actionId,
  type AppHarness,
  type AppState,
  type CustomInvariant,
  type HarnessContext,
  type SemanticNode,
} from "@raptorstack/test";

const ADD: SemanticNode = { role: "button", name: "Add to cart", context: ["ProductCard"], actionEffect: "POST /cart/items" };
const GO_CART: SemanticNode = { role: "link", name: "Go to cart", context: ["ProductCard"], actionEffect: "GET /cart" };
const BACK: SemanticNode = { role: "link", name: "Back", context: ["CartPage"] };

interface UiState {
  route: string;
  count: number;
}

export interface CartApp {
  harness: AppHarness;
  twin: RaptorTwin;
  invariants: CustomInvariant[];
}

export function buildCartApp(): CartApp {
  const twin = new RaptorTwin();
  twin.route("POST", "/cart/items", (_req, db) => {
    const cart = db.read("cart", 1)!;
    const count = (cart.count as number) + 1;
    db.update("cart", 1, { count });
    return { status: 200, body: { ok: true, count } };
  });
  twin.route("GET", "/cart", (_req, db) => {
    const cart = db.read("cart", 1)!;
    return { status: 200, body: { count: cart.count } };
  });
  twin.db.create("cart", { count: 0 }); // id = 1

  const ui: UiState = { route: "/product", count: 0 };

  const harness: AppHarness = {
    reset() {
      ui.route = "/product";
      ui.count = 0;
    },
    currentState(): AppState {
      const actions = ui.route === "/product" ? [ADD, GO_CART] : [BACK];
      return { route: ui.route, facts: { "cart.count": ui.count }, actions };
    },
    perform(id: string, ctx: HarnessContext) {
      if (id === actionId(ADD)) {
        // Optimistic? No: it waits for the response and writes count. (last-write-wins)
        ctx.request("POST", "/cart/items", {}, (res) => {
          ui.count = (res.body as { count: number }).count;
        });
      } else if (id === actionId(GO_CART)) {
        ui.route = "/cart"; // immediate navigation
        ctx.request("GET", "/cart", null, (res) => {
          ui.count = (res.body as { count: number }).count; // may overwrite with stale state
        });
      } else if (id === actionId(BACK)) {
        ui.route = "/product";
      }
    },
    snapshot() {
      return { ...ui };
    },
    restore(snap: unknown) {
      const s = snap as UiState;
      ui.route = s.route;
      ui.count = s.count;
    },
  };

  // Invariant derived from the model (whitepaper §16/§26): the UI must reflect
  // the server's authoritative state once the network settles.
  const invariants: CustomInvariant[] = [
    {
      name: "cart-count-converges",
      check: ({ twin, ui }) => {
        const serverCount = (twin.db.read("cart", 1)?.count as number) ?? 0;
        return ui.facts["cart.count"] === serverCount;
      },
    },
  ];

  return { harness, twin, invariants };
}
