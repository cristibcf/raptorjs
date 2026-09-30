/**
 * Expression evaluator for SSR (whitepaper RaptorEngine 9, 19.1).
 *
 * The same Raptor IR that feeds the browser codegen is evaluated server-side to
 * produce HTML in SSR - concrete proof that "the same graph" traverses both the
 * client and the server (35). A small interpreter over the AST from
 * @raptor/compiler; supports exactly what the DSL (.raptor) produces, not
 * arbitrary JS.
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

/** Evaluates an IR expression in an environment of values (reactive name -> value). */
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
    // Mutations/arrow have no meaning as a value in SSR.
    case "Assign":
    case "Update":
    case "Arrow":
      return undefined;
  }
}
