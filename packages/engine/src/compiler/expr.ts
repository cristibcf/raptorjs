/**
 * Expression parser pentru DSL-ul .raptor (whitepaper RaptorEngine sectiunea 7).
 *
 * Nu parsam JavaScript arbitrar in v0.1 (non-obiectiv explicit, sectiunea 1.2).
 * In schimb, definim o gramatica mica pe care o parsam COMPLET, ca sa avem o
 * analiza de dependente reala - pe ea se bazeaza Dead Signal Elimination si
 * Dependency Fusion (14.1, 14.2). Fara AST real optimizarile ar fi ghicit.
 *
 * Gramatica suportata: literali (numar/string/bool), identificatori, member
 * access (`a.b`), call (`f(x)`), unary (`! - +`), binary aritmetic/comparatie,
 * logic (`&& ||`), conditional (`?:`), assignment (`= += -= *= /=`), update
 * (`++ --` prefix/postfix) si arrow (`() => expr`). Suficient pentru toate
 * exemplele din whitepaper (`count++`, `() => x * 2`, `price.toFixed(2)`).
 */

export const ExprKind = {
  Num: "Num",
  Str: "Str",
  Bool: "Bool",
  Ident: "Ident",
  Member: "Member",
  Call: "Call",
  Unary: "Unary",
  Binary: "Binary",
  Logical: "Logical",
  Cond: "Cond",
  Assign: "Assign",
  Update: "Update",
  Arrow: "Arrow",
} as const;

export type ExprKindValue = (typeof ExprKind)[keyof typeof ExprKind];

export interface NumExpr {
  kind: "Num";
  value: number;
}
export interface StrExpr {
  kind: "Str";
  value: string;
}
export interface BoolExpr {
  kind: "Bool";
  value: boolean;
}
export interface IdentExpr {
  kind: "Ident";
  name: string;
}
export interface MemberExpr {
  kind: "Member";
  object: Expr;
  property: string;
}
export interface CallExpr {
  kind: "Call";
  callee: Expr;
  args: Expr[];
}
export interface UnaryExpr {
  kind: "Unary";
  op: string;
  arg: Expr;
}
export interface BinaryExpr {
  kind: "Binary";
  op: string;
  left: Expr;
  right: Expr;
}
export interface LogicalExpr {
  kind: "Logical";
  op: string;
  left: Expr;
  right: Expr;
}
export interface CondExpr {
  kind: "Cond";
  test: Expr;
  consequent: Expr;
  alternate: Expr;
}
export interface AssignExpr {
  kind: "Assign";
  op: string;
  target: Expr;
  value: Expr;
}
export interface UpdateExpr {
  kind: "Update";
  op: string;
  prefix: boolean;
  arg: Expr;
}
export interface ArrowExpr {
  kind: "Arrow";
  params: string[];
  body: Expr;
}

export type Expr =
  | NumExpr
  | StrExpr
  | BoolExpr
  | IdentExpr
  | MemberExpr
  | CallExpr
  | UnaryExpr
  | BinaryExpr
  | LogicalExpr
  | CondExpr
  | AssignExpr
  | UpdateExpr
  | ArrowExpr;

// --- Lexer -----------------------------------------------------------------

interface Token {
  type: "num" | "str" | "ident" | "punct" | "eof";
  value: string;
  pos: number;
}

const PUNCT_3 = ["===", "!==", "**="];
const PUNCT_2 = [
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**",
];

function isIdentStart(c: string): boolean {
  return /[A-Za-z_$]/.test(c);
}
function isIdentPart(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c);
}
function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    // String literals (simple si double quote, fara escape complex).
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let out = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) {
          const esc = src[j + 1]!;
          out += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
          j += 2;
          continue;
        }
        out += src[j];
        j++;
      }
      tokens.push({ type: "str", value: out, pos: i });
      i = j + 1;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      let j = i;
      while (j < n && (isDigit(src[j]!) || src[j] === ".")) j++;
      tokens.push({ type: "num", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < n && isIdentPart(src[j]!)) j++;
      tokens.push({ type: "ident", value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (PUNCT_3.includes(three)) {
      tokens.push({ type: "punct", value: three, pos: i });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCT_2.includes(two)) {
      tokens.push({ type: "punct", value: two, pos: i });
      i += 2;
      continue;
    }
    tokens.push({ type: "punct", value: c, pos: i });
    i++;
  }
  tokens.push({ type: "eof", value: "", pos: n });
  return tokens;
}

// --- Pratt parser ----------------------------------------------------------

// Binding power pentru operatorii binari/logici (mai mare = leaga mai strans).
const BINDING: Record<string, number> = {
  "||": 3,
  "&&": 4,
  "==": 8,
  "!=": 8,
  "===": 8,
  "!==": 8,
  "<": 9,
  ">": 9,
  "<=": 9,
  ">=": 9,
  "+": 11,
  "-": 11,
  "*": 12,
  "/": 12,
  "%": 12,
  "**": 14,
};

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**="]);
const LOGICAL_OPS = new Set(["&&", "||"]);

/**
 * Cat de adanc poate cobori parserul de expresii.
 *
 * E un parser recursiv-descendent, deci `((((...))))` il duce in stiva. Fara
 * limita, o expresie patologica da `RangeError: Maximum call stack size
 * exceeded` - un mesaj care arata ca s-a stricat compilatorul, cand de fapt
 * expresia e absurda. 256 e cu mult peste orice expresie scrisa de om.
 */
const MAX_EXPR_DEPTH = 256;

class Parser {
  private readonly tokens: Token[];
  private idx: number;
  private depth = 0;
  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.idx = 0;
  }

  /** Coboara un nivel, verificand limita. Perechea lui e `leave()`. */
  private enter(): void {
    if (++this.depth > MAX_EXPR_DEPTH) {
      throw new SyntaxError(`[raptor:expr] expresie imbricata pe mai mult de ${MAX_EXPR_DEPTH} niveluri`);
    }
  }
  private leave(): void {
    this.depth--;
  }

  private peek(): Token {
    return this.tokens[this.idx]!;
  }
  private next(): Token {
    return this.tokens[this.idx++]!;
  }
  private eat(value: string): void {
    const t = this.peek();
    if (t.value !== value) {
      throw new SyntaxError(`[raptor:expr] astept '${value}', gasit '${t.value || "EOF"}'`);
    }
    this.idx++;
  }
  private isAt(value: string): boolean {
    return this.peek().value === value;
  }

  parse(): Expr {
    const expr = this.parseAssign();
    if (this.peek().type !== "eof") {
      throw new SyntaxError(`[raptor:expr] token neasteptat '${this.peek().value}'`);
    }
    return expr;
  }

  private parseAssign(): Expr {
    this.enter();
    try {
      return this.parseAssignInner();
    } finally {
      this.leave();
    }
  }

  private parseAssignInner(): Expr {
    // Arrow: `(a, b) => body` sau `a => body`.
    const arrow = this.tryParseArrow();
    if (arrow) return arrow;

    const left = this.parseConditional();
    const t = this.peek();
    if (t.type === "punct" && ASSIGN_OPS.has(t.value)) {
      this.next();
      const value = this.parseAssign();
      return { kind: "Assign", op: t.value, target: left, value };
    }
    return left;
  }

  private tryParseArrow(): Expr | null {
    const start = this.idx;
    const params: string[] = [];
    if (this.isAt("(")) {
      // Lookahead: `(` ... `)` `=>`.
      this.next();
      if (this.isAt(")")) {
        this.next();
      } else {
        while (true) {
          const p = this.peek();
          if (p.type !== "ident") {
            this.idx = start;
            return null;
          }
          params.push(p.value);
          this.next();
          if (this.isAt(",")) {
            this.next();
            continue;
          }
          break;
        }
        if (!this.isAt(")")) {
          this.idx = start;
          return null;
        }
        this.next();
      }
      if (!this.isAt("=>")) {
        this.idx = start;
        return null;
      }
      this.next();
      const body = this.parseAssign();
      return { kind: "Arrow", params, body };
    }
    // `ident =>`
    if (this.peek().type === "ident" && this.tokens[this.idx + 1]?.value === "=>") {
      const name = this.next().value;
      this.next(); // =>
      const body = this.parseAssign();
      return { kind: "Arrow", params: [name], body };
    }
    return null;
  }

  private parseConditional(): Expr {
    const test = this.parseBinary(0);
    if (this.isAt("?")) {
      this.next();
      const consequent = this.parseAssign();
      this.eat(":");
      const alternate = this.parseAssign();
      return { kind: "Cond", test, consequent, alternate };
    }
    return test;
  }

  private parseBinary(minBp: number): Expr {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (t.type !== "punct") break;
      const bp = BINDING[t.value];
      if (bp === undefined || bp < minBp) break;
      this.next();
      // `**` este dreapta-asociativ; restul stanga-asociativ.
      const nextMin = t.value === "**" ? bp : bp + 1;
      const right = this.parseBinary(nextMin);
      left = LOGICAL_OPS.has(t.value)
        ? { kind: "Logical", op: t.value, left, right }
        : { kind: "Binary", op: t.value, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === "punct" && (t.value === "!" || t.value === "-" || t.value === "+")) {
      this.next();
      return { kind: "Unary", op: t.value, arg: this.parseUnary() };
    }
    if (t.type === "punct" && (t.value === "++" || t.value === "--")) {
      this.next();
      return { kind: "Update", op: t.value, prefix: true, arg: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parseCallMember();
    const t = this.peek();
    if (t.type === "punct" && (t.value === "++" || t.value === "--")) {
      this.next();
      return { kind: "Update", op: t.value, prefix: false, arg: expr };
    }
    return expr;
  }

  private parseCallMember(): Expr {
    let expr = this.parsePrimary();
    while (true) {
      if (this.isAt(".")) {
        this.next();
        const prop = this.peek();
        if (prop.type !== "ident") {
          throw new SyntaxError(`[raptor:expr] astept nume proprietate dupa '.'`);
        }
        this.next();
        expr = { kind: "Member", object: expr, property: prop.value };
        continue;
      }
      if (this.isAt("(")) {
        this.next();
        const args: Expr[] = [];
        if (!this.isAt(")")) {
          while (true) {
            args.push(this.parseAssign());
            if (this.isAt(",")) {
              this.next();
              continue;
            }
            break;
          }
        }
        this.eat(")");
        expr = { kind: "Call", callee: expr, args };
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.type === "num") {
      this.next();
      return { kind: "Num", value: Number(t.value) };
    }
    if (t.type === "str") {
      this.next();
      return { kind: "Str", value: t.value };
    }
    if (t.type === "ident") {
      if (t.value === "true" || t.value === "false") {
        this.next();
        return { kind: "Bool", value: t.value === "true" };
      }
      this.next();
      return { kind: "Ident", name: t.value };
    }
    if (this.isAt("(")) {
      this.next();
      const expr = this.parseAssign();
      this.eat(")");
      return expr;
    }
    throw new SyntaxError(`[raptor:expr] token neasteptat '${t.value || "EOF"}'`);
  }
}

/** Parseaza un string expresie in AST. Arunca SyntaxError pentru input invalid. */
export function parseExpression(src: string): Expr {
  return new Parser(tokenize(src)).parse();
}

// --- Analiza de dependente -------------------------------------------------

export interface ExprAnalysis {
  /** Identificatori radacina cititi (in pozitie de citire). */
  reads: string[];
  /** Identificatori radacina scrisi (target de assign/update). */
  writes: string[];
  /** Nume de functii apelate direct (ex. `state`, `derived`, `serverSignal`). */
  calls: string[];
}

function rootIdent(expr: Expr): string | null {
  if (expr.kind === "Ident") return expr.name;
  if (expr.kind === "Member") return rootIdent(expr.object);
  return null;
}

/**
 * Colecteaza reads/writes/calls dintr-o expresie. Parametrii arrow-urilor sunt
 * legati local si NU se raporteaza ca reads (altfel `() => count` ar raporta
 * gresit ca fiecare param e un semnal extern).
 */
export function analyze(expr: Expr): ExprAnalysis {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const calls = new Set<string>();

  const walk = (e: Expr, bound: Set<string>): void => {
    switch (e.kind) {
      case "Num":
      case "Str":
      case "Bool":
        return;
      case "Ident":
        if (!bound.has(e.name)) reads.add(e.name);
        return;
      case "Member":
        walk(e.object, bound);
        return;
      case "Call": {
        if (e.callee.kind === "Ident") calls.add(e.callee.name);
        walk(e.callee, bound);
        for (const a of e.args) walk(a, bound);
        return;
      }
      case "Unary":
        walk(e.arg, bound);
        return;
      case "Update": {
        const root = rootIdent(e.arg);
        if (root && !bound.has(root)) {
          writes.add(root);
          reads.add(root);
        }
        return;
      }
      case "Binary":
      case "Logical":
        walk(e.left, bound);
        walk(e.right, bound);
        return;
      case "Cond":
        walk(e.test, bound);
        walk(e.consequent, bound);
        walk(e.alternate, bound);
        return;
      case "Assign": {
        const root = rootIdent(e.target);
        if (root && !bound.has(root)) writes.add(root);
        // `+=` etc. citesc si target-ul.
        if (e.op !== "=" && root && !bound.has(root)) reads.add(root);
        walk(e.value, bound);
        return;
      }
      case "Arrow": {
        const inner = new Set(bound);
        for (const p of e.params) inner.add(p);
        walk(e.body, inner);
        return;
      }
    }
  };

  walk(expr, new Set());
  return {
    reads: [...reads],
    writes: [...writes],
    calls: [...calls],
  };
}

// --- Transformari (folosite de Dependency Fusion, 14.2) --------------------

/** Copie profunda a unei expresii. */
export function cloneExpr(e: Expr): Expr {
  switch (e.kind) {
    case "Num":
    case "Str":
    case "Bool":
    case "Ident":
      return { ...e };
    case "Member":
      return { kind: "Member", object: cloneExpr(e.object), property: e.property };
    case "Call":
      return { kind: "Call", callee: cloneExpr(e.callee), args: e.args.map(cloneExpr) };
    case "Unary":
      return { kind: "Unary", op: e.op, arg: cloneExpr(e.arg) };
    case "Update":
      return { kind: "Update", op: e.op, prefix: e.prefix, arg: cloneExpr(e.arg) };
    case "Binary":
      return { kind: "Binary", op: e.op, left: cloneExpr(e.left), right: cloneExpr(e.right) };
    case "Logical":
      return { kind: "Logical", op: e.op, left: cloneExpr(e.left), right: cloneExpr(e.right) };
    case "Cond":
      return {
        kind: "Cond",
        test: cloneExpr(e.test),
        consequent: cloneExpr(e.consequent),
        alternate: cloneExpr(e.alternate),
      };
    case "Assign":
      return { kind: "Assign", op: e.op, target: cloneExpr(e.target), value: cloneExpr(e.value) };
    case "Arrow":
      return { kind: "Arrow", params: [...e.params], body: cloneExpr(e.body) };
  }
}

/**
 * Inlocuieste fiecare referinta a identificatorului `name` cu `replacement`
 * (folosit la fuziune: `derived c = () => b + 1` cu `b` fuzionat devine
 * `() => <expr-b> + 1`). Nu intra in scope-uri arrow care leaga `name`.
 */
/** Identificatorii liberi ai unei expresii (fara cei legati de arrow-uri). */
export function freeIdents(e: Expr): Set<string> {
  return new Set(analyze(e).reads);
}

/** De cate ori apare `name` ca identificator liber in `e`. */
export function countIdent(e: Expr, name: string): number {
  switch (e.kind) {
    case "Num":
    case "Str":
    case "Bool":
      return 0;
    case "Ident":
      return e.name === name ? 1 : 0;
    case "Member":
      return countIdent(e.object, name);
    case "Call":
      return countIdent(e.callee, name) + e.args.reduce((n, a) => n + countIdent(a, name), 0);
    case "Unary":
      return countIdent(e.arg, name);
    case "Update":
      return countIdent(e.arg, name);
    case "Binary":
    case "Logical":
      return countIdent(e.left, name) + countIdent(e.right, name);
    case "Cond":
      return countIdent(e.test, name) + countIdent(e.consequent, name) + countIdent(e.alternate, name);
    case "Assign":
      return countIdent(e.target, name) + countIdent(e.value, name);
    case "Arrow":
      return e.params.includes(name) ? 0 : countIdent(e.body, name);
  }
}

/**
 * Inlocuieste `name` cu `replacement`, sau intoarce `null` daca inlocuirea ar
 * **captura** o variabila.
 *
 * Captura arata asa:
 *
 * ```
 * const a = derived(() => x + 1)             // `x` liber = semnalul x
 * const b = derived(() => items.map(x => a)) // `x` aici = parametrul lui map
 * ```
 *
 * Inlocuind naiv iese `items.map(x => x + 1)`, unde `x` nu mai e semnalul, ci
 * parametrul - alt program. Runda 3 de audit a gasit exact asta in Dependency
 * Fusion: expresia se schimba, iar lista de dependinte primea `x`, deci
 * bindingul se abona la un semnal pe care codul emis nici nu-l mai citea.
 *
 * Semnatura intoarce `null` dinadins: un apelant nu are cum sa "uite" de
 * captura, fiindca trebuie sa trateze cazul ca sa compileze.
 */
export function substituteIdent(e: Expr, name: string, replacement: Expr): Expr | null {
  const free = freeIdents(replacement);
  return substituteChecked(e, name, replacement, free, new Set());
}

function substituteChecked(
  e: Expr,
  name: string,
  replacement: Expr,
  free: Set<string>,
  bound: Set<string>,
): Expr | null {
  const go = (child: Expr, inner = bound): Expr | null => substituteChecked(child, name, replacement, free, inner);
  const both = <T>(a: Expr | null, b: Expr | null, make: (x: Expr, y: Expr) => T): T | null =>
    a === null || b === null ? null : make(a, b);

  switch (e.kind) {
    case "Num":
    case "Str":
    case "Bool":
      return e;
    case "Ident": {
      if (e.name !== name) return e;
      // Aici s-ar face inlocuirea: daca vreun identificator liber al
      // inlocuitorului e legat pe drumul pana aici, l-am captura.
      for (const f of free) if (bound.has(f)) return null;
      return cloneExpr(replacement);
    }
    case "Member": {
      const object = go(e.object);
      return object && { kind: "Member", object, property: e.property };
    }
    case "Call": {
      const callee = go(e.callee);
      if (callee === null) return null;
      const args: Expr[] = [];
      for (const a of e.args) {
        const next = go(a);
        if (next === null) return null;
        args.push(next);
      }
      return { kind: "Call", callee, args };
    }
    case "Unary": {
      const arg = go(e.arg);
      return arg && { kind: "Unary", op: e.op, arg };
    }
    case "Update": {
      const arg = go(e.arg);
      return arg && { kind: "Update", op: e.op, prefix: e.prefix, arg };
    }
    case "Binary":
      return both(go(e.left), go(e.right), (left, right) => ({ kind: "Binary", op: e.op, left, right }) as Expr);
    case "Logical":
      return both(go(e.left), go(e.right), (left, right) => ({ kind: "Logical", op: e.op, left, right }) as Expr);
    case "Cond": {
      const test = go(e.test);
      const consequent = go(e.consequent);
      const alternate = go(e.alternate);
      if (test === null || consequent === null || alternate === null) return null;
      return { kind: "Cond", test, consequent, alternate };
    }
    case "Assign":
      return both(go(e.target), go(e.value), (target, value) => ({ kind: "Assign", op: e.op, target, value }) as Expr);
    case "Arrow": {
      if (e.params.includes(name)) return e; // numele e umbrit aici
      const inner = new Set(bound);
      for (const p of e.params) inner.add(p);
      const body = go(e.body, inner);
      return body && { kind: "Arrow", params: [...e.params], body };
    }
  }
}

/**
 * Reda o expresie ca sursa JS, rescriind citirile de semnale in apeluri
 * (`count` -> `count()`) conform setului `readAsCall`. Baza codegen-ului
 * (whitepaper 9): binding-urile fine-grained cheama accesorii reactivi.
 */
export function exprToJs(e: Expr, readAsCall: Set<string>): string {
  switch (e.kind) {
    case "Num":
      return String(e.value);
    case "Str":
      return JSON.stringify(e.value);
    case "Bool":
      return String(e.value);
    case "Ident":
      return readAsCall.has(e.name) ? `${e.name}()` : e.name;
    case "Member":
      return `${exprToJs(e.object, readAsCall)}.${e.property}`;
    case "Call":
      return `${exprToJs(e.callee, readAsCall)}(${e.args.map((a) => exprToJs(a, readAsCall)).join(", ")})`;
    case "Unary":
      return `${e.op}${exprToJs(e.arg, readAsCall)}`;
    case "Binary":
      return `(${exprToJs(e.left, readAsCall)} ${e.op} ${exprToJs(e.right, readAsCall)})`;
    case "Logical":
      return `(${exprToJs(e.left, readAsCall)} ${e.op} ${exprToJs(e.right, readAsCall)})`;
    case "Cond":
      return `(${exprToJs(e.test, readAsCall)} ? ${exprToJs(e.consequent, readAsCall)} : ${exprToJs(e.alternate, readAsCall)})`;
    case "Update":
    case "Assign":
      // Mutatiile de semnale sunt gestionate separat de codegen (writeToJs).
      return exprToJs(e.kind === "Update" ? e.arg : e.value, readAsCall);
    case "Arrow":
      return `(${e.params.join(", ")}) => ${exprToJs(e.body, readAsCall)}`;
  }
}
