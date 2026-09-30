/**
 * Parser .raptor -> Raptor IR (RaptorEngine whitepaper, steps 1-4 of 6).
 *
 * v0.1 fuses parse+resolve+lower into a single pass over a small, well-defined
 * DSL (see expr.ts for the rationale). The result is real IR with stable IDs,
 * not an AST of strings. A full JS parser (Oxc) is a v0.1 non-goal (1.2) - the
 * engine consumes the parser through an adapter.
 *
 * Source shape:
 *
 *   component Counter {
 *     const count = state(0)
 *     const doubled = derived(() => count * 2)
 *     const price = serverSignal("BTC.price", schema.money)
 *     <div class="counter">
 *       <button on:click={count++}>+</button>
 *       <span>Count: {count}</span>
 *     </div>
 *   }
 */
import { parseExpression, analyze, type Expr } from "./expr.ts";
import {
  stableId,
  type IRModule,
  type IRComponent,
  type IRSignal,
  type IRDerived,
  type IRServerSignal,
  type IREffect,
  type IRElement,
  type IRChild,
  type IRAttrBinding,
  type IREventBinding,
  type IRTextBinding,
  type SourceSpan,
} from "./ir.ts";

export class RaptorParseError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(`[raptor:parse] ${message} (pos ${pos})`);
    this.name = "RaptorParseError";
    this.pos = pos;
  }
}

class Scanner {
  readonly src: string;
  pos: number;
  constructor(src: string) {
    this.src = src;
    this.pos = 0;
  }
  eof(): boolean {
    return this.pos >= this.src.length;
  }
  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }
  startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }
  skipTrivia(): void {
    while (!this.eof()) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.pos++;
        continue;
      }
      if (c === "/" && this.peek(1) === "/") {
        while (!this.eof() && this.peek() !== "\n") this.pos++;
        continue;
      }
      break;
    }
  }
  expect(s: string): void {
    if (!this.startsWith(s)) {
      throw new RaptorParseError(`expected '${s}', found '${this.src.slice(this.pos, this.pos + 8)}'`, this.pos);
    }
    this.pos += s.length;
  }
  readIdent(): string {
    const start = this.pos;
    while (!this.eof() && /[A-Za-z0-9_$-]/.test(this.peek())) this.pos++;
    if (this.pos === start) throw new RaptorParseError("expected identifier", this.pos);
    return this.src.slice(start, this.pos);
  }
  /** Reads a balanced block delimited by open/close, returns the interior. */
  readBalanced(open: string, close: string): string {
    if (this.peek() !== open) throw new RaptorParseError(`expected '${open}'`, this.pos);
    this.pos++;
    const start = this.pos;
    // Equal delimiters (string literals): read until the unescaped close.
    if (open === close) {
      while (!this.eof() && this.peek() !== close) {
        if (this.peek() === "\\") this.pos++;
        this.pos++;
      }
      const inner = this.src.slice(start, this.pos);
      if (this.eof()) throw new RaptorParseError(`'${close}' missing`, this.pos);
      this.pos++;
      return inner;
    }
    let depth = 1;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '"' || c === "'") {
        this.pos++;
        while (!this.eof() && this.peek() !== c) {
          if (this.peek() === "\\") this.pos++;
          this.pos++;
        }
        this.pos++;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const inner = this.src.slice(start, this.pos);
          this.pos++;
          return inner;
        }
      }
      this.pos++;
    }
    throw new RaptorParseError(`'${close}' missing`, this.pos);
  }
}

/** Splits an argument string on top-level commas (respects parens/strings). */
function splitTopLevel(src: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = src.slice(start).trim();
  if (last.length > 0 || parts.length > 0) parts.push(last);
  return parts.filter((p) => p.length > 0);
}

interface ParseContext {
  component: string;
  reactiveNames: Set<string>;
  elementCounter: { n: number };
  /** How many JSX levels deep we are; see `MAX_ELEMENT_DEPTH`. */
  depth: number;
}

/**
 * How deeply the JSX inside a component can be nested.
 *
 * `parseElement` is recursive, so without a limit a pathological nesting gives
 * `RangeError: Maximum call stack size exceeded` - a message that looks like the
 * compiler broke, when in fact the file is absurd. With a limit, you get a parse
 * error with a position, like any other syntax mistake.
 *
 * 256 is well above any human-written interface.
 */
const MAX_ELEMENT_DEPTH = 256;

/** Filters reads down to only the reactive names known in the component. */
function reactiveReads(expr: Expr, ctx: ParseContext): string[] {
  return analyze(expr).reads.filter((r) => ctx.reactiveNames.has(r));
}
function reactiveWrites(expr: Expr, ctx: ParseContext): string[] {
  return analyze(expr).writes.filter((w) => ctx.reactiveNames.has(w));
}

function parseComponent(sc: Scanner): IRComponent {
  const startPos = sc.pos;
  sc.expect("component");
  sc.skipTrivia();
  const name = sc.readIdent();
  sc.skipTrivia();
  if (sc.peek() !== "{") throw new RaptorParseError("expected '{' after the component name", sc.pos);
  sc.pos++; // consume '{'

  const cid = name;
  const ctx: ParseContext = {
    component: name,
    reactiveNames: new Set(),
    elementCounter: { n: 0 },
    depth: 0,
  };

  const signals: IRSignal[] = [];
  const deriveds: IRDerived[] = [];
  const serverSignals: IRServerSignal[] = [];
  const effects: IREffect[] = [];
  let root: IRElement | null = null;

  while (true) {
    sc.skipTrivia();
    if (sc.eof()) throw new RaptorParseError("'}' missing at the end of the component", sc.pos);
    if (sc.peek() === "}") {
      sc.pos++;
      break;
    }
    if (sc.peek() === "<") {
      if (root) throw new RaptorParseError("a component has a single root element", sc.pos);
      root = parseElement(sc, cid, ctx);
      continue;
    }
    parseDeclaration(sc, ctx, signals, deriveds, serverSignals, effects, cid);
  }

  if (!root) throw new RaptorParseError(`component '${name}' has no template`, sc.pos);

  return {
    id: cid,
    name,
    stableId: stableId(["component", name]),
    signals,
    deriveds,
    serverSignals,
    effects,
    root,
    span: { start: startPos, end: sc.pos },
  };
}

function parseDeclaration(
  sc: Scanner,
  ctx: ParseContext,
  signals: IRSignal[],
  deriveds: IRDerived[],
  serverSignals: IRServerSignal[],
  effects: IREffect[],
  cid: string,
): void {
  const declStart = sc.pos;
  let debugBoundary = false;
  if (sc.startsWith("@debug")) {
    debugBoundary = true;
    sc.pos += "@debug".length;
    sc.skipTrivia();
  }

  // effect(() => ...)
  if (sc.startsWith("effect")) {
    sc.pos += "effect".length;
    sc.skipTrivia();
    const inner = sc.readBalanced("(", ")");
    const expr = parseExpression(inner);
    const body = expr.kind === "Arrow" ? expr.body : expr;
    effects.push({
      kind: "Effect",
      id: `${cid}.effect${effects.length}`,
      expr: body,
      reads: reactiveReads(body, ctx),
      span: { start: declStart, end: sc.pos },
    });
    return;
  }

  sc.expect("const");
  sc.skipTrivia();
  const name = sc.readIdent();
  sc.skipTrivia();
  sc.expect("=");
  sc.skipTrivia();

  if (sc.startsWith("state")) {
    sc.pos += "state".length;
    sc.skipTrivia();
    const inner = sc.readBalanced("(", ")");
    const init = parseExpression(inner.trim() || "undefined");
    ctx.reactiveNames.add(name);
    signals.push({
      kind: "Signal",
      id: `${cid}.${name}`,
      name,
      init,
      span: { start: declStart, end: sc.pos },
    });
    return;
  }

  if (sc.startsWith("derived") || sc.startsWith("memo")) {
    sc.pos += sc.startsWith("derived") ? "derived".length : "memo".length;
    sc.skipTrivia();
    const inner = sc.readBalanced("(", ")");
    const parsed = parseExpression(inner);
    const body = parsed.kind === "Arrow" ? parsed.body : parsed;

    // A `derived` is a READ value, not an action. Writes are emitted separately
    // by codegen (`writeToJs`), so in a read position `exprToJs` ignores them:
    // `derived(() => n++)` compiles silently as `n`, i.e. the increment
    // disappears without anyone saying a word. Better to reject at parse time
    // than to produce a program that does not do what it says. Audit round 3, U3.
    const scrieri = analyze(body).writes;
    if (scrieri.length > 0) {
      throw new RaptorParseError(
        `'${name}' is a derived, so it cannot write (${scrieri.join(", ")}); move the write into a handler or an effect`,
        declStart,
      );
    }

    ctx.reactiveNames.add(name);
    deriveds.push({
      kind: "Derived",
      id: `${cid}.${name}`,
      name,
      expr: body,
      reads: reactiveReads(body, ctx),
      span: { start: declStart, end: sc.pos },
      debugBoundary,
    });
    return;
  }

  if (sc.startsWith("serverSignal")) {
    sc.pos += "serverSignal".length;
    sc.skipTrivia();
    const inner = sc.readBalanced("(", ")");
    const args = splitTopLevel(inner);
    const addrExpr = parseExpression(args[0] ?? '""');
    const address = addrExpr.kind === "Str" ? addrExpr.value : String(args[0]);
    let schema: string | null = null;
    if (args[1]) {
      const s = parseExpression(args[1]);
      if (s.kind === "Member") schema = s.property;
      else if (s.kind === "Str") schema = s.value;
      else if (s.kind === "Ident") schema = s.name;
    }
    ctx.reactiveNames.add(name);
    serverSignals.push({
      kind: "ServerSignal",
      id: `${cid}.${name}`,
      name,
      address,
      schema,
      span: { start: declStart, end: sc.pos },
    });
    return;
  }

  throw new RaptorParseError(`unknown declaration '${name} = ...' (expected state/derived/serverSignal)`, declStart);
}

function parseElement(sc: Scanner, cid: string, ctx: ParseContext): IRElement {
  const start = sc.pos;
  if (ctx.depth >= MAX_ELEMENT_DEPTH) {
    throw new RaptorParseError(`JSX nested more than ${MAX_ELEMENT_DEPTH} levels`, start);
  }
  ctx.depth++;
  try {
    return parseElementBody(sc, cid, ctx, start);
  } finally {
    ctx.depth--;
  }
}

function parseElementBody(sc: Scanner, cid: string, ctx: ParseContext, start: number): IRElement {
  sc.expect("<");
  const tag = sc.readIdent();
  const elId = `${cid}/e${ctx.elementCounter.n++}`;
  const attrs: IRAttrBinding[] = [];
  const events: IREventBinding[] = [];

  while (true) {
    sc.skipTrivia();
    if (sc.startsWith("/>")) {
      sc.pos += 2;
      return { kind: "Element", id: elId, tag, attrs, events, children: [] };
    }
    if (sc.peek() === ">") {
      sc.pos++;
      break;
    }
    parseAttribute(sc, elId, ctx, attrs, events);
  }

  const children = parseChildren(sc, cid, ctx, elId);

  // Closing tag </tag>
  sc.expect("</");
  sc.skipTrivia();
  const closeTag = sc.readIdent();
  if (closeTag !== tag) {
    throw new RaptorParseError(`closing tag '${closeTag}' does not match '${tag}'`, sc.pos);
  }
  sc.skipTrivia();
  sc.expect(">");

  const el: IRElement = { kind: "Element", id: elId, tag, attrs, events, children };
  void start;
  return el;
}

function parseAttribute(
  sc: Scanner,
  elId: string,
  ctx: ParseContext,
  attrs: IRAttrBinding[],
  events: IREventBinding[],
): void {
  const nameStart = sc.pos;
  while (!sc.eof() && /[A-Za-z0-9_:.-]/.test(sc.peek())) sc.pos++;
  const name = sc.src.slice(nameStart, sc.pos);
  if (!name) throw new RaptorParseError("expected attribute name", sc.pos);

  let hasValue = false;
  let staticValue: string | null = null;
  let expr: Expr | null = null;

  if (sc.peek() === "=") {
    sc.pos++;
    hasValue = true;
    if (sc.peek() === '"' || sc.peek() === "'") {
      const quote = sc.peek();
      staticValue = sc.readBalanced(quote, quote);
    } else if (sc.peek() === "{") {
      const inner = sc.readBalanced("{", "}");
      expr = parseExpression(inner);
    } else {
      throw new RaptorParseError(`invalid attribute value for '${name}'`, sc.pos);
    }
  }

  // Event binding: `on:click` or `onClick`.
  const isEvent =
    name.startsWith("on:") || (name.startsWith("on") && name.length > 2 && name[2] === name[2]?.toUpperCase());
  if (isEvent) {
    if (!expr) throw new RaptorParseError(`handler '${name}' requires {expression}`, sc.pos);
    const event = name.startsWith("on:") ? name.slice(3) : name.slice(2).toLowerCase();
    const handlerBody = expr.kind === "Arrow" ? expr.body : expr;
    events.push({
      kind: "EventBinding",
      id: `${elId}#on:${event}`,
      event,
      handler: handlerBody,
      writes: reactiveWrites(handlerBody, ctx),
      reads: reactiveReads(handlerBody, ctx),
    });
    return;
  }

  attrs.push({
    kind: "AttrBinding",
    id: `${elId}#attr:${name}`,
    name,
    value: hasValue ? staticValue : "",
    expr,
    reads: expr ? reactiveReads(expr, ctx) : [],
  });
}

function parseChildren(sc: Scanner, cid: string, ctx: ParseContext, elId: string): IRChild[] {
  const children: IRChild[] = [];
  let textIndex = 0;
  while (true) {
    if (sc.eof()) throw new RaptorParseError("closing tag missing", sc.pos);
    if (sc.startsWith("</")) break;

    if (sc.peek() === "<") {
      children.push(parseElement(sc, cid, ctx));
      continue;
    }

    if (sc.peek() === "{") {
      const inner = sc.readBalanced("{", "}");
      const expr = parseExpression(inner);
      children.push({
        kind: "TextBinding",
        id: `${elId}#t${textIndex++}`,
        text: null,
        expr,
        reads: reactiveReads(expr, ctx),
      } satisfies IRTextBinding);
      continue;
    }

    // Static text: up to the next '<' or '{'.
    const textStart = sc.pos;
    while (!sc.eof() && sc.peek() !== "<" && sc.peek() !== "{") sc.pos++;
    const raw = sc.src.slice(textStart, sc.pos);
    const trimmed = raw.replace(/\s+/g, " ").trim();
    if (trimmed.length > 0) {
      children.push({
        kind: "TextBinding",
        id: `${elId}#t${textIndex++}`,
        text: trimmed,
        expr: null,
        reads: [],
      } satisfies IRTextBinding);
    }
  }
  return children;
}

/** Parses a complete .raptor module (1+ components) into IR. */
export function parseModule(source: string, path: string): IRModule {
  const sc = new Scanner(source);
  const components: IRComponent[] = [];
  while (true) {
    sc.skipTrivia();
    if (sc.eof()) break;
    if (!sc.startsWith("component")) {
      throw new RaptorParseError(`expected 'component', found '${sc.src.slice(sc.pos, sc.pos + 12)}'`, sc.pos);
    }
    components.push(parseComponent(sc));
  }
  const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const name = base.replace(/\.raptor$/, "");
  return { path, name, components };
}
