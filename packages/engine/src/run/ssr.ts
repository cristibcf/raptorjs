/**
 * SSR + resume (whitepaper RaptorEngine 9, 19.1: "SSR/resume orchestration").
 *
 * Renders a component to HTML on the server using the current values of the
 * server-signals (from the store) and the initial values of the local signals.
 * Also emits a resume payload: which RAS addresses the client must (re)subscribe
 * to in order to continue reactively, without re-fetch (14, 15).
 */
import { evalExpr, type Env } from "./eval.ts";
import type { IRComponent, IRElement, IRChild } from "@raptorstack/engine/compiler";

export interface ResumeSignal {
  name: string;
  address: string;
  schema: string | null;
}

export interface ResumePayload {
  component: string;
  serverSignals: ResumeSignal[];
}

export interface SsrResult {
  html: string;
  resume: ResumePayload;
}

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESCAPE[c]!);
}

function renderElement(el: IRElement, env: Env): string {
  const attrs: string[] = [];
  for (const a of el.attrs) {
    const value = a.expr ? evalExpr(a.expr, env) : a.value;
    if (value === false || value == null) continue;
    attrs.push(` ${a.name}="${escapeHtml(String(value))}"`);
  }
  // Events are not rendered in SSR; the client attaches them at hydration.

  const inner: string[] = [];
  for (const child of el.children as IRChild[]) {
    if (child.kind === "Element") {
      inner.push(renderElement(child, env));
    } else if (child.expr) {
      inner.push(escapeHtml(String(evalExpr(child.expr, env) ?? "")));
    } else {
      inner.push(escapeHtml(child.text ?? ""));
    }
  }
  return `<${el.tag}${attrs.join("")}>${inner.join("")}</${el.tag}>`;
}

export interface SsrOptions {
  /** The current value of a server signal, by address (from the store). */
  serverValue: (address: string) => unknown;
}

/** Renders an IR component to HTML + resume payload. */
export function renderComponent(component: IRComponent, options: SsrOptions): SsrResult {
  const env: Env = {};
  for (const s of component.signals) env[s.name] = evalExpr(s.init, {});
  for (const ss of component.serverSignals) env[ss.name] = options.serverValue(ss.address);
  // Deriveds in declaration order (they may depend on earlier ones).
  for (const d of component.deriveds) env[d.name] = evalExpr(d.expr, env);

  return {
    html: renderElement(component.root, env),
    resume: {
      component: component.name,
      serverSignals: component.serverSignals.map((ss) => ({
        name: ss.name,
        address: ss.address,
        schema: ss.schema,
      })),
    },
  };
}

/** Complete HTML document with the resume payload inline (for hydration). */
export function renderDocument(result: SsrResult, title = "RaptorRun"): string {
  const resumeJson = escapeHtml(JSON.stringify(result.resume));
  return (
    `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body><div id="raptor-root">${result.html}</div>` +
    `<script type="application/raptor-resume">${resumeJson}</script></body></html>`
  );
}
