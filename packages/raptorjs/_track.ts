import { installMiniDom } from "@raptorstack/raptorjs/dom/testing";
installMiniDom();
const { mountChild } = await import("@raptorstack/raptorjs/dom");
const { state, effect, createRoot } = await import("@raptorstack/raptorjs");

const doc = (globalThis as { document?: any }).document;

interface Caz {
  nume: string;
  build: () => Promise<unknown>;
  interact: () => void;
}

const deschis = state(false);
const valoare = state<string | null>(null);

const { Select } = await import("./src/ui/select.ts");
const { DropdownMenu } = await import("./src/ui/menu.ts");

const cazuri: Caz[] = [
  {
    nume: "Select (open owned by the consumer)",
    build: async () =>
      Select({
        value: valoare,
        open: deschis,
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      } as never),
    interact: () => deschis.set(true),
  },
  {
    nume: "DropdownMenu",
    build: async () =>
      DropdownMenu({
        label: "menu",
        open: deschis,
        items: [{ key: "x", label: "X", onSelect: () => {} }],
      } as never),
    interact: () => deschis.set(true),
  },
];

for (const caz of cazuri) {
  deschis.set(false);
  let rulari = 0;
  const dispose = createRoot((d) => {
    // The parent region: build the component INSIDE a computation, exactly like
    // a `Show`/`For` or a binding in a real application.
    effect(() => {
      rulari++;
      const host = doc.createElement("div");
      void caz.build().then((node) => mountChild(host, node as never, null));
    });
    return d;
  });
  await new Promise((r) => setTimeout(r, 30));
  const dupaMontare = rulari;
  caz.interact();
  await new Promise((r) => setTimeout(r, 30));
  console.log(
    `${caz.nume.padEnd(40)} parent runs: mount=${dupaMontare}  after interaction=${rulari}` +
      (rulari > dupaMontare ? "   <-- THE PARENT RE-RAN" : "   ok"),
  );
  dispose();
}
