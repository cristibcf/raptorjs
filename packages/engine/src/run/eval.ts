/**
 * Evaluator de expresii pentru SSR (whitepaper RaptorEngine 9, 19.1).
 *
 * Acelasi Raptor IR care alimenteaza codegen-ul browser este evaluat server-side
 * ca sa producem HTML in SSR - dovada concreta ca "acelasi graf" traverseaza si
 * clientul, si serverul (35). Interpret mic peste AST-ul din @raptor/compiler;
 * suporta exact ce produce DSL-ul (.raptor), nu JS arbitrar.
 */
import type { Expr } from "@raptor/engine/compiler";

export type Env = Record<string, unknown>;

/* eslint-disable @typescript-eslint/no-explicit-any */

function applyBinary(op: string, l: any, r: any): unknown {
  switch (op) {
    case "+":
      return l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "/":
      return l / r;
    case "%":
      return l % r;
    case "**":
      return l ** r;
    case "<":
      return l < r;
    case ">":
      return l > r;
    case "<=":
      return l <= r;
    case ">=":
      return l >= r;
    case "==":
      return l == r;
    case "!=":
      return l != r;
    case "===":
      return l === r;
    case "!==":
      return l !== r;
    default:
      return undefined;
  }
}

/** Evalueaza o expresie IR intr-un mediu de valori (nume reactiv -> valoare). */
export function evalExpr(e: Expr, env: Env): unknown {
  switch (e.kind) {
    case "Num":
    case "Str":
    case "Bool":
      return e.value;
    case "Ident":
      return env[e.name];
    case "Member": {
      const obj = evalExpr(e.object, env) as any;
      return obj == null ? undefined : obj[e.property];
    }
    case "Call": {
      if (e.callee.kind === "Member") {
        const obj = evalExpr(e.callee.object, env) as any;
        const fn = obj == null ? undefined : obj[e.callee.property];
        if (typeof fn !== "function") return undefined;
        return fn.apply(
          obj,
          e.args.map((a) => evalExpr(a, env)),
        );
      }
      const fn = evalExpr(e.callee, env) as any;
      if (typeof fn !== "function") return undefined;
      return fn(...e.args.map((a) => evalExpr(a, env)));
    }
    case "Unary": {
      const v = evalExpr(e.arg, env) as any;
      if (e.op === "!") return !v;
      if (e.op === "-") return -v;
      return +v;
    }
    case "Binary":
      return applyBinary(e.op, evalExpr(e.left, env), evalExpr(e.right, env));
    case "Logical": {
      const l = evalExpr(e.left, env);
      if (e.op === "&&") return l ? evalExpr(e.right, env) : l;
      return l ? l : evalExpr(e.right, env);
    }
    case "Cond":
      return evalExpr(e.test, env) ? evalExpr(e.consequent, env) : evalExpr(e.alternate, env);
    // Mutatii/arrow nu au sens ca valoare in SSR.
    case "Assign":
    case "Update":
    case "Arrow":
      return undefined;
  }
}
