import { installMiniDom } from "@raptor/dom/testing";
installMiniDom();
const { mountChild } = await import("@raptor/dom");
const { state, effect, createRoot } = await import("@raptor/core");

const doc = (globalThis as { document?: any }).document;

interface Caz {
  nume: string;
  build: () => Promise<unknown>;
  interact: () => void;
}

const deschis = state(false);
const valoare = state<string | null>(null);

const { Select } = await import("./src/select.ts");
const { DropdownMenu } = await import("./src/menu.ts");

const cazuri: Caz[] = [
  {
    nume: "Select (open detinut de consumator)",
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
        label: "meniu",
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
    // Regiunea parintelui: construieste componenta INAUNTRUL unei computatii,
    // exact ca un `Show`/`For` sau un binding dintr-o aplicatie reala.
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
    `${caz.nume.padEnd(40)} rulari parinte: montare=${dupaMontare}  dupa interactiune=${rulari}` +
      (rulari > dupaMontare ? "   <-- PARINTELE S-A RE-RULAT" : "   ok"),
  );
  dispose();
}
