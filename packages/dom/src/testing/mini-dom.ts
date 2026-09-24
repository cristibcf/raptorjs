/**
 * mini-dom - un DOM minimal, headless, pentru teste, demo-uri Node si pentru
 * a demonstra "mutatii DOM exacte" (whitepaper sectiunea 6). Numara fiecare
 * operatie ca sa putem arata ca update-urile fine-grained ating doar nodurile
 * afectate. NU este un DOM complet; acopera doar ce foloseste runtime-ul.
 */

export interface MutationStats {
  createElement: number;
  createText: number;
  setAttribute: number;
  removeAttribute: number;
  insert: number;
  remove: number;
  textUpdate: number;
}

export const stats: MutationStats = newStats();

export function newStats(): MutationStats {
  return {
    createElement: 0,
    createText: 0,
    setAttribute: 0,
    removeAttribute: 0,
    insert: 0,
    remove: 0,
    textUpdate: 0,
  };
}

export function resetStats(): void {
  Object.assign(stats, newStats());
}

let nodeIdSeq = 0;

export abstract class MiniNode {
  readonly id = nodeIdSeq++;
  parentNode: MiniElement | null = null;
  childNodes: MiniNode[] = [];
  nextSibling: MiniNode | null = null;
  abstract get nodeType(): number;
  abstract toHTML(): string;
}

export class MiniText extends MiniNode {
  private _data: string;
  constructor(data: string) {
    super();
    this._data = data;
  }
  get nodeType(): number {
    return 3;
  }
  cloneNode(_deep?: boolean): MiniText {
    return new MiniText(this._data);
  }
  get data(): string {
    return this._data;
  }
  set data(value: string) {
    if (value !== this._data) {
      this._data = value;
      stats.textUpdate++;
    }
  }
  get textContent(): string {
    return this._data;
  }
  set textContent(value: string) {
    this.data = value;
  }
  toHTML(): string {
    return escapeHtml(this._data);
  }
}

export class MiniComment extends MiniNode {
  data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
  get nodeType(): number {
    return 8;
  }
  cloneNode(_deep?: boolean): MiniComment {
    return new MiniComment(this.data);
  }
  toHTML(): string {
    return `<!--${this.data}-->`;
  }
}

type Listener = (event: MiniEvent) => void;

export class MiniElement extends MiniNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  constructor(tagName: string) {
    super();
    this.tagName = tagName.toLowerCase();
  }
  get nodeType(): number {
    return 1;
  }

  /**
   * Clona ca `Node.cloneNode`: copiaza tag + atribute (si copiii, daca deep),
   * FARA listeneri. Nu incrementeaza contoarele de mutatii (createElement/
   * insert) — clonarea e exact optimizarea pe care o masuram la #3 (template).
   */
  cloneNode(deep?: boolean): MiniElement {
    const el = new MiniElement(this.tagName);
    for (const [k, v] of this.attributes) el.attributes.set(k, v);
    if (deep) {
      for (const child of this.childNodes) {
        const clone = (child as MiniNode & { cloneNode(d?: boolean): MiniNode }).cloneNode(true);
        clone.parentNode = el;
        el.childNodes.push(clone);
      }
      relink(el);
    }
    return el;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    stats.setAttribute++;
  }
  removeAttribute(name: string): void {
    if (this.attributes.delete(name)) stats.removeAttribute++;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  set className(value: string) {
    this.setAttribute("class", value);
  }
  get className(): string {
    return this.attributes.get("class") ?? "";
  }
  set textContent(value: string) {
    for (const child of this.childNodes.slice()) this.removeChild(child);
    if (value !== "") this.appendChild(new MiniText(value));
  }
  get textContent(): string {
    // Ca in DOM-ul real: comentariile NU contribuie la textContent. Conteaza,
    // fiindca `For`/`Show` lasa comentarii-ancora in arbore.
    return this.childNodes
      .map((n) => (n instanceof MiniElement ? n.textContent : n instanceof MiniText ? n.data : ""))
      .join("");
  }

  appendChild<T extends MiniNode>(node: T): T {
    this.insertBefore(node, null);
    return node;
  }

  insertBefore<T extends MiniNode>(node: T, ref: MiniNode | null): T {
    // Un DocumentFragment nu se insereaza pe sine: isi muta copiii la pozitia
    // ceruta si ramane gol (DOM standard). `For` se bazeaza pe asta ca sa ataseze
    // o lista intreaga printr-un singur apel.
    if (node instanceof MiniElement && node.tagName === "#fragment") {
      const moved = node.childNodes.slice();
      node.childNodes.length = 0;
      relink(node);
      for (let i = 0; i < moved.length; i++) {
        const child = moved[i]!;
        // Fiecare copil intra prin calea normala, deci indexul se recalculeaza
        // dupa eventuala detasare - la fel ca la o inserare obisnuita.
        this.insertBefore(child, ref);
      }
      return node;
    }

    // Detasarea trebuie sa se intample INAINTE de calculul pozitiei: daca nodul
    // era deja copil aici, scoaterea lui deplaseaza indicii de dupa el.
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    const at = index === -1 ? this.childNodes.length : index;
    this.childNodes.splice(at, 0, node);
    node.parentNode = this;
    // Contorizam fiecare nod atasat, nu un singur "insert" pentru tot fragmentul:
    // altfel un fragment ar parea ca muta N noduri pe gratis, iar benchmark-ul ar
    // masura contorul, nu munca. Castigul real al fragmentului e ca browserul
    // face o singura trecere, si el se vede in timp, nu in numarul de noduri.
    stats.insert++;
    relink(this);
    return node;
  }

  removeChild<T extends MiniNode>(node: T): T {
    const i = this.childNodes.indexOf(node);
    if (i !== -1) {
      this.childNodes.splice(i, 1);
      node.parentNode = null;
      node.nextSibling = null;
      stats.remove++;
      relink(this);
    }
    return node;
  }

  /** Obiect de stil scriibil, ca in DOM (scroll lock-ul din Dialog il foloseste). */
  readonly style: Record<string, string> = {};

  /** Marcheaza elementul ca `document.activeElement` (focusTrap, Dialog). */
  focus(): void {
    const doc = (globalThis as { document?: unknown }).document;
    if (doc instanceof MiniDocument) doc.activeElement = this;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((l) => l !== listener));
  }

  /**
   * Utilitar de test: declanseaza un eveniment sincron pe acest element.
   * `init` pune campuri suplimentare pe eveniment (`key`, `button`, ...), iar
   * propagarea urca pana la `document` - ca in browser, ca sa poata fi testate
   * handlere globale (click-outside, shortcut-uri de tastatura).
   */
  dispatch(type: string, init?: Record<string, unknown>): MiniEvent {
    const event = new MiniEvent(type, this, init);
    let node: MiniElement | null = this;
    while (node && !event.propagationStopped) {
      const list = node.listeners.get(type);
      if (list) for (const l of list.slice()) l(event);
      node = node.parentNode;
    }
    if (!event.propagationStopped) {
      const doc = (globalThis as { document?: unknown }).document;
      if (doc instanceof MiniDocument) doc.deliver(event);
    }
    return event;
  }
  click(): void {
    this.dispatch("click");
  }
  /** Utilitar de test: `el.keydown("Escape")`. */
  keydown(key: string): MiniEvent {
    return this.dispatch("keydown", { key });
  }
  /** `true` daca `other` e acest nod sau un descendent (ca Node.contains). */
  contains(other: MiniNode | null): boolean {
    let node: MiniNode | null = other;
    while (node) {
      if (node === this) return true;
      node = node.parentNode;
    }
    return false;
  }

  querySelectorAll(tag: string): MiniElement[] {
    const out: MiniElement[] = [];
    const want = tag.toLowerCase();
    const walk = (el: MiniElement): void => {
      for (const child of el.childNodes) {
        if (child instanceof MiniElement) {
          if (child.tagName === want) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  querySelector(tag: string): MiniElement | null {
    for (const child of this.childNodes) {
      if (child instanceof MiniElement) {
        if (child.tagName === tag.toLowerCase()) return child;
        const found = child.querySelector(tag);
        if (found) return found;
      }
    }
    return null;
  }

  toHTML(): string {
    const attrs = [...this.attributes.entries()]
      .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
      .join("");
    const inner = this.childNodes.map((n) => n.toHTML()).join("");
    return `<${this.tagName}${attrs}>${inner}</${this.tagName}>`;
  }
}

export class MiniEvent {
  defaultPrevented = false;
  propagationStopped = false;
  readonly type: string;
  readonly target: MiniElement;
  constructor(type: string, target: MiniElement, init?: Record<string, unknown>) {
    this.type = type;
    this.target = target;
    if (init) Object.assign(this, init);
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

function relink(el: MiniElement): void {
  for (let i = 0; i < el.childNodes.length; i++) {
    el.childNodes[i]!.nextSibling = el.childNodes[i + 1] ?? null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class MiniDocument {
  private readonly listeners = new Map<string, Listener[]>();

  /** `body` si `head` exista ca in documentul real: Portal si scroll-lock-ul
   *  din Dialog le cauta implicit, iar testele nu trebuie sa le simuleze. */
  readonly documentElement: MiniElement;
  readonly head: MiniElement;
  readonly body: MiniElement;
  /** Ultimul element care a primit focus (setat de `MiniElement.focus`). */
  activeElement: MiniElement | null = null;

  constructor() {
    this.documentElement = new MiniElement("html");
    this.head = new MiniElement("head");
    this.body = new MiniElement("body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  getElementById(id: string): MiniElement | null {
    const walk = (el: MiniElement): MiniElement | null => {
      for (const child of el.childNodes) {
        if (!(child instanceof MiniElement)) continue;
        if (child.getAttribute("id") === id) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this.documentElement);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((l) => l !== listener));
  }
  /** Livreaza un eveniment care a urcat pana la document (apelat de dispatch). */
  deliver(event: MiniEvent): void {
    const list = this.listeners.get(event.type);
    if (list) for (const l of list.slice()) l(event);
  }

  createElement(tag: string): MiniElement {
    stats.createElement++;
    return new MiniElement(tag);
  }
  /** SVG si alte namespace-uri. Numara la fel, ca tezele sa ramana corecte. */
  createElementNS(namespace: string, tag: string): MiniElement {
    stats.createElement++;
    const el = new MiniElement(tag);
    (el as unknown as { namespaceURI: string }).namespaceURI = namespace;
    return el;
  }
  createTextNode(data: string): MiniText {
    stats.createText++;
    return new MiniText(data);
  }
  createComment(data: string): MiniComment {
    return new MiniComment(data);
  }
  createDocumentFragment(): MiniElement {
    return new MiniElement("#fragment");
  }
}

/** Instaleaza mini-dom ca `globalThis.document` (pentru Node/teste). */
export function installMiniDom(): MiniDocument {
  const doc = new MiniDocument();
  (globalThis as unknown as { document: MiniDocument }).document = doc;
  return doc;
}
