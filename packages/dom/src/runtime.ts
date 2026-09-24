/**
 * Runtime DOM Raptor - creeaza noduri reale si le leaga fine-grained de
 * semnale. Acesta este "output-ul conceptual" al compilerului din whitepaper
 * sectiunea 6: fara Virtual DOM, fiecare expresie dinamica devine un effect
 * care atinge exact un text-node / atribut / regiune de lista.
 *
 * Tipurile DOM sunt tratate structural (`any`) ca sa functioneze identic in
 * browser si pe mini-dom-ul headless.
 */
import { effect, onCleanup, createRoot } from "@raptor/core";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;
type Accessor<T> = () => T;

/** O regiune de continut auto-gestionata (For, Show, Dynamic). */
export interface Block {
  __raptorBlock: true;
  mount(parent: El, anchor: El | null): void;
}

export type Child =
  | El
  | string
  | number
  | boolean
  | null
  | undefined
  | Block
  | ChildAccessor
  | ChildArray;

// Interfetele rup auto-referinta aliasului (altfel TS2456).
interface ChildAccessor {
  (): Child;
}
interface ChildArray extends Array<Child> {}

function doc(): any {
  const d = (globalThis as any).document;
  if (!d) {
    throw new Error(
      "[raptor] nu exista `document`. In Node importa @raptor/dom/testing si apeleaza installMiniDom().",
    );
  }
  return d;
}

export function isBlock(value: unknown): value is Block {
  return typeof value === "object" && value !== null && (value as any).__raptorBlock === true;
}

function isNode(value: unknown): value is El {
  return typeof value === "object" && value !== null && typeof (value as any).nodeType === "number";
}

export function block(mount: (parent: El, anchor: El | null) => void): Block {
  return { __raptorBlock: true, mount };
}

// --- Creare element + props ------------------------------------------------

export const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Tag-uri care exista DOAR in SVG. `document.createElement("svg")` produce in
 * browser un element HTML necunoscut, care nu randeaza nimic - trebuie
 * `createElementNS`. Tag-urile ambigue (`a`, `script`, `style`, `title`) NU sunt
 * aici: ele exista si in HTML, iar alegerea corecta ar cere contextul
 * parintelui. Pentru ele foloseste al doilea argument al lui `createElement`.
 */
const SVG_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textPath", "defs", "use", "symbol", "marker", "mask",
  "clipPath", "pattern", "image", "filter", "foreignObject", "switch",
  "linearGradient", "radialGradient", "stop", "animate", "animateTransform",
  "animateMotion", "desc", "metadata", "view",
]);

export function isSvgTag(tag: string): boolean {
  return SVG_TAGS.has(tag);
}

export function createElement(tag: string, namespace?: string): El {
  const ns = namespace ?? (SVG_TAGS.has(tag) ? SVG_NS : undefined);
  const d = doc();
  if (ns && typeof d.createElementNS === "function") return d.createElementNS(ns, tag);
  return d.createElement(tag);
}

/**
 * Fabrica de instante dintr-un schelet STATIC, prin `cloneNode(true)`
 * (whitepaper sectiunea 6: output-ul compilatorului). `build` ruleaza o singura
 * data ca sa construiasca prototipul; fiecare apel intoarce o clona proaspata,
 * evitand `createElement` per nod la fiecare instanta. Bindarea continutului
 * dinamic se face pe clona (skeletul e static). Pentru randuri repetate (liste)
 * asta reduce semnificativ costul de create.
 */
export function template(build: () => El): () => El {
  let proto: El | null = null;
  return () => {
    if (proto === null) proto = build();
    return proto.cloneNode(true);
  };
}

const BOOLEAN_ATTRS = new Set(["disabled", "checked", "readonly", "required", "selected", "hidden"]);

/**
 * Controale de formular unde atributul singur nu ajunge. Odata ce utilizatorul a
 * tastat intr-un input (sau a bifat o caseta), elementul devine "dirty" si
 * atributul nu mai schimba ce se vede - un `value` legat reactiv ar inceta sa
 * aiba efect exact dupa prima interactiune.
 *
 * Scriem SI proprietatea (ce se vede acum), SI atributul (ce se serializeaza la
 * SSR si ce redevine valoarea implicita la form.reset()).
 */
const FORM_PROPS: Record<string, Set<string>> = {
  value: new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]),
  checked: new Set(["INPUT"]),
  selected: new Set(["OPTION"]),
};

function setFormProperty(el: El, name: string, value: unknown): void {
  const target = el as unknown as Record<string, unknown>;
  if (name === "value") {
    const next = value == null || value === false ? "" : String(value);
    // Nu scriem daca e deja egal: altfel cursorul sare la capat in timpul tastarii.
    if (target.value !== next) target.value = next;
    return;
  }
  target[name] = value === true || (value != null && value !== false);
}

function setAttribute(el: El, name: string, value: unknown): void {
  // tagName e majuscule in DOM-ul real si minuscule in mini-dom-ul de test.
  const tag = ((el as unknown as { tagName?: string }).tagName ?? "").toUpperCase();
  if (FORM_PROPS[name]?.has(tag)) setFormProperty(el, name, value);

  if (BOOLEAN_ATTRS.has(name)) {
    if (value === false || value == null) el.removeAttribute(name);
    else el.setAttribute(name, "");
    return;
  }
  if (value === false || value == null) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, String(value));
  }
}

export function applyProps(el: El, props: Record<string, unknown> | null): void {
  if (!props) return;
  for (const key of Object.keys(props)) {
    if (key === "children" || key === "key" || key === "ref") continue;
    const value = props[key];

    // Evenimente: `on:click` sau `onClick`.
    if (key.startsWith("on:") || (key.startsWith("on") && key.length > 2 && key[2] === key[2]?.toUpperCase())) {
      const type = key.startsWith("on:") ? key.slice(3) : key.slice(2).toLowerCase();
      el.addEventListener(type, value as (e: unknown) => void);
      continue;
    }

    if (typeof value === "function") {
      // Binding reactiv fine-grained: doar acest atribut se actualizeaza.
      effect(() => setAttribute(el, key, (value as Accessor<unknown>)()));
    } else {
      setAttribute(el, key, value);
    }
  }
  if (typeof props.ref === "function") (props.ref as (el: El) => void)(el);
}

// --- Montare copii ---------------------------------------------------------
export function mountChild(parent: El, child: Child, anchor: El | null): void {
  if (child == null || child === true || child === false) return;

  if (typeof child === "string" || typeof child === "number") {
    insertNode(parent, doc().createTextNode(String(child)), anchor);
    return;
  }

  if (Array.isArray(child)) {
    for (const c of child) mountChild(parent, c, anchor);
    return;
  }

  if (isBlock(child)) {
    child.mount(parent, anchor);
    return;
  }

  if (isNode(child)) {
    insertNode(parent, child, anchor);
    return;
  }

  if (typeof child === "function") {
    mountDynamic(parent, child as Accessor<Child>, anchor);
    return;
  }
}

function insertNode(parent: El, node: El, anchor: El | null): void {
  if (anchor) parent.insertBefore(node, anchor);
  else parent.appendChild(node);
}

/**
 * Contor de suprimare a stergerilor DOM. Cand un stramos e detasat intr-o
 * singura operatie (ex. `For` scoate un `<tr>` intreg), cleanup-urile de
 * regiune nu mai trebuie sa scoata individual fiecare text-node/anchor de
 * dedesubt — ar fi munca dublata pe noduri deja detasate. `disposeDetached`
 * ridica flag-ul in timp ce ruleaza dispose-ul reactiv.
 */
let removalSuppressed = 0;

/**
 * Scoate `node` din parinte intr-un singur `removeChild` (detasand tot
 * subarborele), apoi ruleaza `dispose` cu stergerile DOM suprimate. Reduce
 * `clear`/remove de la O(noduri) la O(randuri) operatii DOM. Vezi [[For]].
 */
export function disposeDetached(node: El, dispose: () => void): void {
  const parent = node.parentNode;
  if (parent) parent.removeChild(node);
  removalSuppressed++;
  try {
    dispose();
  } finally {
    removalSuppressed--;
  }
}

/**
 * O regiune dinamica: `() => valoare`. Fast-path pentru text: creeaza DOAR un
 * text-node (fara comment-anchor) si actualizeaza `.data` la schimbare —
 * anchor-ul de comentariu se materializeaza lazy doar daca regiunea devine
 * structurala (array/nod). Asta economiseste un nod + un insert per legatura
 * de text (castig la create in masa).
 */
function mountDynamic(parent: El, accessor: Accessor<Child>, anchor: El | null): void {
  let end: El | null = null; // comment-anchor, creat lazy
  let current: El[] = [];
  let textNode: El | null = null;

  function ensureEnd(): El {
    if (end === null) {
      end = doc().createComment("");
      // Il asezam imediat dupa continutul curent (sau la anchor).
      const ref = current.length > 0 ? current[current.length - 1]!.nextSibling : anchor;
      insertNode(parent, end, ref);
    }
    return end;
  }

  effect(() => {
    const value = accessor();
    // Fast-path text: reuseste text-node-ul, muta doar `.data`.
    if (typeof value === "string" || typeof value === "number") {
      const str = String(value);
      if (textNode !== null) {
        if (textNode.data !== str) textNode.data = str;
        return;
      }
      if (current.length === 0 && end === null) {
        // Regiune pur-text: niciun anchor de comentariu.
        textNode = doc().createTextNode(str);
        insertNode(parent, textNode, anchor);
        current = [textNode];
        return;
      }
      const text = doc().createTextNode(str);
      current = replaceRegion(parent, current, [text], ensureEnd());
      textNode = text;
      return;
    }
    // Structural: avem nevoie de anchor de sfarsit.
    textNode = null;
    const nodes = resolveNodes(value);
    current = replaceRegion(parent, current, nodes, ensureEnd());
  });

  onCleanup(() => {
    if (removalSuppressed === 0) {
      for (const n of current) if (n.parentNode) n.parentNode.removeChild(n);
      if (end !== null && end.parentNode) end.parentNode.removeChild(end);
    }
  });
}

function resolveNodes(value: Child): El[] {
  if (value == null || value === true || value === false) return [];
  if (typeof value === "string" || typeof value === "number") {
    return [doc().createTextNode(String(value))];
  }
  if (Array.isArray(value)) {
    const out: El[] = [];
    for (const v of value) out.push(...resolveNodes(v));
    return out;
  }
  if (isNode(value)) return [value];
  if (typeof value === "function") return resolveNodes((value as Accessor<Child>)());
  if (isBlock(value)) {
    // Un `Block` se monteaza singur intr-un parinte; nu poate fi redus la o
    // lista de noduri. Inainte cadea pe `return []` si disparea TACUT, ceea ce
    // e cel mai prost mod de a esua. Blocurile se pun direct ca si copii
    // (`R.div(For({...}))`), nu prin `() => For({...})`.
    throw new Error(
      "[raptor] un Block (For/Show/Portal) nu poate fi intors dintr-o regiune " +
        "dinamica. Pune-l direct ca si copil in loc de `() => For({...})`.",
    );
  }
  return [];
}

function replaceRegion(parent: El, current: El[], next: El[], anchor: El): El[] {
  for (const n of current) if (n.parentNode === parent) parent.removeChild(n);
  for (const n of next) parent.insertBefore(n, anchor);
  return next;
}

// --- render ----------------------------------------------------------------
export type Component = () => Child;

const mountCallbacks: Array<() => void> = [];

/** Programeaza un callback dupa ce arborele curent a fost montat (sectiunea 10). */
export function onMount(fn: () => void): void {
  mountCallbacks.push(fn);
}

/** Monteaza un component intr-un container. Intoarce un dispose determinist. */
export function render(component: Component, container: El): () => void {
  return createRoot((dispose) => {
    const child = component();
    mountChild(container, child, null);
    const pending = mountCallbacks.splice(0);
    for (const cb of pending) cb();
    return () => {
      dispose();
      container.textContent = "";
    };
  });
}
