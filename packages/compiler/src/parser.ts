/**
 * Parser .raptor -> Raptor IR (whitepaper RaptorEngine, pasii 1-4 din 6).
 *
 * v0.1 fuzioneaza parse+resolve+lower intr-o singura trecere peste un DSL mic,
 * bine definit (vezi expr.ts pentru justificare). Rezultatul e IR real cu
 * stable IDs, nu un AST de string-uri. Un parser JS complet (Oxc) este un
 * non-obiectiv v0.1 (1.2) - engine-ul consuma parser-ul printr-un adapter.
 *
 * Forma sursei:
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
      throw new RaptorParseError(`astept '${s}', gasit '${this.src.slice(this.pos, this.pos + 8)}'`, this.pos);
    }
    this.pos += s.length;
  }
  readIdent(): string {
    const start = this.pos;
    while (!this.eof() && /[A-Za-z0-9_$-]/.test(this.peek())) this.pos++;
    if (this.pos === start) throw new RaptorParseError("astept identificator", this.pos);
    return this.src.slice(start, this.pos);
  }
  /** Citeste un bloc echilibrat delimitat de open/close, returneaza interiorul. */
  readBalanced(open: string, close: string): string {
    if (this.peek() !== open) throw new RaptorParseError(`astept '${open}'`, this.pos);
    this.pos++;
    const start = this.pos;
    // Delimitatori egali (string literals): citeste pana la close ne-escapat.
    if (open === close) {
      while (!this.eof() && this.peek() !== close) {
        if (this.peek() === "\\") this.pos++;
        this.pos++;
      }
      const inner = this.src.slice(start, this.pos);
      if (this.eof()) throw new RaptorParseError(`'${close}' lipsa`, this.pos);
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
    throw new RaptorParseError(`'${close}' lipsa`, this.pos);
  }
}

/** Sparge un string de argumente pe virgulele de nivel top (respecta paranteze/string-uri). */
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
}

/** Filtreaza reads la doar numele reactive cunoscute in componenta. */
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
  if (sc.peek() !== "{") throw new RaptorParseError("astept '{' dupa numele componentei", sc.pos);
  sc.pos++; // consuma '{'

  const cid = name;
  const ctx: ParseContext = {
    component: name,
    reactiveNames: new Set(),
    elementCounter: { n: 0 },
  };

  const signals: IRSignal[] = [];
  const deriveds: IRDerived[] = [];
  const serverSignals: IRServerSignal[] = [];
  const effects: IREffect[] = [];
  let root: IRElement | null = null;

  while (true) {
    sc.skipTrivia();
    if (sc.eof()) throw new RaptorParseError("'}' lipsa la finalul componentei", sc.pos);
    if (sc.peek() === "}") {
      sc.pos++;
      break;
    }
    if (sc.peek() === "<") {
      if (root) throw new RaptorParseError("o componenta are un singur element radacina", sc.pos);
      root = parseElement(sc, cid, ctx);
      continue;
    }
    parseDeclaration(sc, ctx, signals, deriveds, serverSignals, effects, cid);
  }

  if (!root) throw new RaptorParseError(`componenta '${name}' nu are template`, sc.pos);

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

  throw new RaptorParseError(`declaratie necunoscuta '${name} = ...' (astept state/derived/serverSignal)`, declStart);
}

function parseElement(sc: Scanner, cid: string, ctx: ParseContext): IRElement {
  const start = sc.pos;
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

  // Inchidere </tag>
  sc.expect("</");
  sc.skipTrivia();
  const closeTag = sc.readIdent();
  if (closeTag !== tag) {
    throw new RaptorParseError(`tag inchis '${closeTag}' nu se potriveste cu '${tag}'`, sc.pos);
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
  if (!name) throw new RaptorParseError("astept nume atribut", sc.pos);

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
      throw new RaptorParseError(`valoare atribut invalida pentru '${name}'`, sc.pos);
    }
  }

  // Event binding: `on:click` sau `onClick`.
  const isEvent =
    name.startsWith("on:") || (name.startsWith("on") && name.length > 2 && name[2] === name[2]?.toUpperCase());
  if (isEvent) {
    if (!expr) throw new RaptorParseError(`handler-ul '${name}' cere {expresie}`, sc.pos);
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
    if (sc.eof()) throw new RaptorParseError("tag de inchidere lipsa", sc.pos);
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

    // Text static: pana la urmatorul '<' sau '{'.
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

/** Parseaza un modul .raptor complet (1+ componente) in IR. */
export function parseModule(source: string, path: string): IRModule {
  const sc = new Scanner(source);
  const components: IRComponent[] = [];
  while (true) {
    sc.skipTrivia();
    if (sc.eof()) break;
    if (!sc.startsWith("component")) {
      throw new RaptorParseError(`astept 'component', gasit '${sc.src.slice(sc.pos, sc.pos + 12)}'`, sc.pos);
    }
    components.push(parseComponent(sc));
  }
  const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const name = base.replace(/\.raptor$/, "");
  return { path, name, components };
}
