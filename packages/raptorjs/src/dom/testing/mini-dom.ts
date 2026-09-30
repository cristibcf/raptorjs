/**
 * mini-dom - a minimal, headless DOM for tests, Node demos and for
 * demonstrating "exact DOM mutations" (whitepaper section 6). It counts every
 * operation so we can show that fine-grained updates touch only the affected
 * nodes. It is NOT a full DOM; it covers only what the runtime uses.
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
   * Clone like `Node.cloneNode`: copies tag + attributes (and children, if
   * deep), WITHOUT listeners. Does not increment the mutation counters
   * (createElement/insert) — cloning is exactly the optimization we measure in
   * #3 (template).
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
    // As in the real DOM: comments do NOT contribute to textContent. This
    // matters, because `For`/`Show` leave anchor comments in the tree.
    return this.childNodes
      .map((n) => (n instanceof MiniElement ? n.textContent : n instanceof MiniText ? n.data : ""))
      .join("");
  }

  appendChild<T extends MiniNode>(node: T): T {
    this.insertBefore(node, null);
    return node;
  }

  insertBefore<T extends MiniNode>(node: T, ref: MiniNode | null): T {
    // A DocumentFragment does not insert itself: it moves its children to the
    // requested position and stays empty (standard DOM). `For` relies on this to
    // attach a whole list through a single call.
    if (node instanceof MiniElement && node.tagName === "#fragment") {
      const moved = node.childNodes.slice();
      node.childNodes.length = 0;
      relink(node);
      for (let i = 0; i < moved.length; i++) {
        const child = moved[i]!;
        // Each child goes through the normal path, so the index is recomputed
        // after any detachment - just like on an ordinary insertion.
        this.insertBefore(child, ref);
      }
      return node;
    }

    // Detachment must happen BEFORE computing the position: if the node was
    // already a child here, removing it shifts the indices after it.
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    const at = index === -1 ? this.childNodes.length : index;
    this.childNodes.splice(at, 0, node);
    node.parentNode = this;
    // We count each attached node, not a single "insert" for the whole fragment:
    // otherwise a fragment would look like it moves N nodes for free, and the
    // benchmark would measure the counter, not the work. The real win of a
    // fragment is that the browser does a single pass, and that shows up in time,
    // not in the node count.
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

  /** A writable style object, as in the DOM (Dialog's scroll lock uses it). */
  readonly style: Record<string, string> = {};

  /** Marks the element as `document.activeElement` (focusTrap, Dialog). */
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
   * Test utility: fires a synchronous event on this element. `init` sets extra
   * fields on the event (`key`, `button`, ...), and propagation bubbles up to
   * `document` - as in the browser, so that global handlers (click-outside,
   * keyboard shortcuts) can be tested.
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
  /** Test utility: `el.keydown("Escape")`. */
  keydown(key: string): MiniEvent {
    return this.dispatch("keydown", { key });
  }
  /** `true` if `other` is this node or a descendant (like Node.contains). */
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

  /** `body` and `head` exist as in the real document: Portal and Dialog's
   *  scroll-lock look them up implicitly, and tests need not simulate them. */
  readonly documentElement: MiniElement;
  readonly head: MiniElement;
  readonly body: MiniElement;
  /** The last element that received focus (set by `MiniElement.focus`). */
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
  /** Delivers an event that bubbled up to the document (called by dispatch). */
  deliver(event: MiniEvent): void {
    const list = this.listeners.get(event.type);
    if (list) for (const l of list.slice()) l(event);
  }

  createElement(tag: string): MiniElement {
    stats.createElement++;
    return new MiniElement(tag);
  }
  /** SVG and other namespaces. Counts the same, so the theses stay correct. */
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

/** Installs mini-dom as `globalThis.document` (for Node/tests). */
export function installMiniDom(): MiniDocument {
  const doc = new MiniDocument();
  (globalThis as unknown as { document: MiniDocument }).document = doc;
  return doc;
}
