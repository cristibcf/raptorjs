/**
 * SSR + resume (whitepaper RaptorEngine 9, 19.1: "SSR/resume orchestration").
 *
 * Randeaza o componenta la HTML pe server folosind valorile curente ale
 * server-signals (din store) si valorile initiale ale signal-urilor locale.
 * Emite si un payload de resume: ce adrese RAS trebuie sa (re)abonoze clientul
 * ca sa continue reactiv, fara re-fetch (14, 15).
 */
import { evalExpr, type Env } from "./eval.ts";
import type { IRComponent, IRElement, IRChild } from "@raptor/engine/compiler";

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
  // Evenimentele nu se randeaza in SSR; clientul le ataseaza la hydration.

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
  /** Valoarea curenta a unui server signal, dupa adresa (din store). */
  serverValue: (address: string) => unknown;
}

/** Randeaza o componenta IR la HTML + payload de resume. */
export function renderComponent(component: IRComponent, options: SsrOptions): SsrResult {
  const env: Env = {};
  for (const s of component.signals) env[s.name] = evalExpr(s.init, {});
  for (const ss of component.serverSignals) env[ss.name] = options.serverValue(ss.address);
  // Deriveds in ordinea declararii (pot depinde de cele anterioare).
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

/** Document HTML complet cu payload-ul de resume inline (pentru hydration). */
export function renderDocument(result: SsrResult, title = "RaptorRun"): string {
  const resumeJson = escapeHtml(JSON.stringify(result.resume));
  return (
    `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body><div id="raptor-root">${result.html}</div>` +
    `<script type="application/raptor-resume">${resumeJson}</script></body></html>`
  );
}
