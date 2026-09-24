/**
 * Control flow fine-grained: `For` (lista keyed cu reutilizare de noduri) si
 * `Show` (conditional). Fiecare ramura/element se creeaza in propriul scope
 * (createRoot) ca sa nu fie distrus de re-run-ul effect-ului parinte, si e
 * distrus determinist cand dispare (whitepaper 8.3 "list specialization").
 */
import { effect, createRoot } from "@raptor/core";
import { type Block, type Child, block, mountChild, disposeDetached } from "./runtime.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;
type Accessor<T> = () => T;

function doc(): any {
  return (globalThis as any).document;
}

export interface ForProps<T> {
  each: Accessor<readonly T[]>;
  children: (item: T, index: number) => Child;
}

interface Entry {
  node: El;
  dispose: () => void;
  /** Ultima rulare in care itemul a fost vazut; vezi bucla de curatare. */
  seenIn: number;
}

/** Lista keyed: reutilizeaza nodurile pentru itemi neschimbati, muta minim. */
export function For<T>(props: ForProps<T>): Block {
  return block((parent, anchor) => {
    const end = doc().createComment("for");
    if (anchor) parent.insertBefore(end, anchor);
    else parent.appendChild(end);

    const cache = new Map<T, Entry>();
    /** Numarul rularii curente: tine loc de multimea itemilor vazuti. */
    let pass = 0;

    effect(() => {
      const items = props.each();
      pass++;

      // Creeaza/reutilizeaza noduri pentru itemii curenti.
      const nodes: El[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        let entry = cache.get(item);
        if (!entry) {
          let node!: El;
          let dispose!: () => void;
          createRoot((d) => {
            node = materialize(props.children(item, i));
            dispose = d;
          });
          entry = { node, dispose, seenIn: pass };
          cache.set(item, entry);
        } else {
          entry.seenIn = pass;
        }
        nodes.push(entry.node);
      }

      // Elimina itemii disparuti (dispose determinist). Detasam nodul intr-un
      // singur removeChild, apoi dispose reactiv fara stergeri DOM redundante.
      //
      // Marcarea per intrare (`seenIn`) tine locul unui `Set` construit din nou
      // la fiecare rulare: pe o lista de 10.000 de randuri, acel Set insemna
      // 10.000 de inserari si tot atatea cautari doar ca sa afli, de obicei, ca
      // nu s-a sters nimic. Iar daca dimensiunea cache-ului e egala cu a listei,
      // fiecare intrare a fost atinsa acum, deci nu are ce sa fie de sters si
      // parcurgerea se poate sari cu totul - cazul comun la update/select/swap.
      if (cache.size > items.length) {
        for (const [item, entry] of cache) {
          if (entry.seenIn !== pass) {
            disposeDetached(entry.node, entry.dispose);
            cache.delete(item);
          }
        }
      }

      // Reordoneaza cu mutari minime (insertBefore doar cand pozitia e gresita).
      let nextSibling: El = end;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i]!;
        if (node.nextSibling !== nextSibling || node.parentNode !== parent) {
          parent.insertBefore(node, nextSibling);
        }
        nextSibling = node;
      }
    });
  });
}

export interface ShowProps {
  when: Accessor<unknown>;
  children: Child;
  fallback?: Child;
}

/** Conditional: monteaza `children` cand `when` e truthy, altfel `fallback`. */
export function Show(props: ShowProps): Block {
  return block((parent, anchor) => {
    const end = doc().createComment("show");
    if (anchor) parent.insertBefore(end, anchor);
    else parent.appendChild(end);

    let current: El | null = null;
    let disposeBranch: (() => void) | null = null;
    /** Ramura montata acum; `null` inseamna "inca nimic". */
    let mounted: boolean | null = null;

    effect(() => {
      const visible = !!props.when();

      // `when` se poate re-evalua fara ca rezultatul sa se schimbe: e de ajuns
      // ca o dependenta a ei sa fi fost atinsa. In cazul asta ramura curenta e
      // deja cea corecta si NU trebuie reconstruita - altfel un `Show` pierde
      // starea din subarbore (scroll, input-uri, componente lazy) la fiecare
      // schimbare fara legatura.
      if (mounted === visible) return;
      mounted = visible;

      // Schimbare de ramura: detaseaza intai, apoi dispose.
      if (current) {
        const node = current;
        const d = disposeBranch;
        current = null;
        disposeBranch = null;
        if (d) disposeDetached(node, d);
        else if (node.parentNode) node.parentNode.removeChild(node);
      } else if (disposeBranch) {
        disposeBranch();
        disposeBranch = null;
      }

      const branch = visible ? props.children : props.fallback;
      if (branch == null) return;
      createRoot((d) => {
        current = materialize(branch);
        disposeBranch = d;
      });
      if (current) parent.insertBefore(current, end);
    });
  });
}

/** Reduce un Child la un singur nod DOM (invelind text/liste intr-un span). */
function materialize(child: Child): El {
  if (child == null || child === true || child === false) {
    return doc().createTextNode("");
  }
  if (typeof child === "string" || typeof child === "number") {
    return doc().createTextNode(String(child));
  }
  if (typeof child === "object" && typeof (child as any).nodeType === "number") {
    return child;
  }
  // Bloc/array/accessor -> invelim intr-un span gestionat.
  const wrapper = doc().createElement("span");
  mountChild(wrapper, child, null);
  return wrapper;
}
