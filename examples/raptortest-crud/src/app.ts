/**
 * Aplicatia testata (SUT): un mini cart CRUD cu bug-ul clasic RT-184 din
 * whitepaper (Anexa A): "Add to cart" apoi navigare imediata la Cart; un GET
 * /cart stale poate suprascrie starea corecta din UI (last-write-wins pe client).
 *
 * Aplicatia NU stie ca backend-ul e un RaptorTwin sintetic: face request-uri
 * normale prin harness-context (whitepaper §2, principiul "real client code").
 */
import {
  RaptorTwin,
  actionId,
  type AppHarness,
  type AppState,
  type CustomInvariant,
  type HarnessContext,
  type SemanticNode,
} from "@raptor/test";

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
        // Optimistic? Nu: asteapta raspunsul si scrie count. (last-write-wins)
        ctx.request("POST", "/cart/items", {}, (res) => {
          ui.count = (res.body as { count: number }).count;
        });
      } else if (id === actionId(GO_CART)) {
        ui.route = "/cart"; // navigare imediata
        ctx.request("GET", "/cart", null, (res) => {
          ui.count = (res.body as { count: number }).count; // poate suprascrie cu stare veche
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

  // Invariant derivat din model (whitepaper §16/§26): UI trebuie sa reflecte
  // starea autoritativa a serverului dupa ce reteaua se stabilizeaza.
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
