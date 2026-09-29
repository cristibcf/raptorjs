/**
 * Regresii pentru runda 3 de audit: optimizatorul schimba intelesul programului.
 *
 * Contextul care da severitatea: teza proiectului (whitepaper §24) e „adaptive
 * strategies, not adaptive correctness". DSE si Fusion sunt prezentate ca
 * transformari sigure — deci un caz in care schimba rezultatul, sau emit cod
 * care arunca, e o gaura in chiar afirmatia centrala a pilonului de compilare.
 *
 * Fiecare test de aici a fost intai un program care se compila gresit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModule, exprToJs, type Expr } from "@raptor/engine/compiler";
import { optimize } from "../../src/engine/optimize.ts";
import { buildModule } from "../../src/engine/index.ts";

/** Expresiile tuturor bindingurilor de text dintr-un modul, ca text JS. */
function textBindings(module: ReturnType<typeof parseModule>): string[] {
  const out: string[] = [];
  const walk = (node: Record<string, unknown>): void => {
    if (node["kind"] === "TextBinding" && node["expr"]) {
      out.push(exprToJs(node["expr"] as Expr, new Set()));
    }
    if (Array.isArray(node["children"])) {
      for (const child of node["children"] as Array<Record<string, unknown>>) walk(child);
    }
  };
  for (const comp of module.components) walk(comp.root as unknown as Record<string, unknown>);
  return out;
}

function names(module: ReturnType<typeof parseModule>): string[] {
  return module.components.flatMap((c) => [
    ...c.signals.map((s) => s.name),
    ...c.deriveds.map((d) => d.name),
  ]);
}

/* ------------------------------------------------ U1: captura de variabila -- */

test("U1: fuziunea nu captureaza o variabila legata la locul folosirii", () => {
  // `a` citeste SEMNALUL `x`. La locul folosirii, `x` e parametrul lui `map`.
  // Inlocuirea naiva dadea `items.map(x => x + 1)` - alt program - si pe
  // deasupra declara `x` ca dependinta, deci bindingul se abona la un semnal pe
  // care codul emis nici nu-l mai citea.
  const module = parseModule(
    `component App {
      const x = state(1)
      const a = derived(() => x + 1)
      const b = derived(() => items.map(x => a))
      <div>{b}</div>
    }`,
    "App.raptor",
  );

  const optimized = optimize(module, { fusion: true });
  const binding = textBindings(optimized.module)[0]!;
  assert.doesNotMatch(binding, /\(x\) => \(x \+ 1\)/, `captura: ${binding}`);
  assert.ok(
    optimized.trace.some((t) => t.action === "blocked" && t.detail.includes("captura")),
    "refuzul trebuie sa apara in trace, ca `inspect` sa poata spune de ce",
  );
});

/* ------------------------------------------------ U2: duplicarea lucrului --- */

test("U2: fuziunea nu duplica lucrul cand consumatorul foloseste valoarea de doua ori", () => {
  // Un consumator UNIC nu inseamna o singura FOLOSIRE. Inlocuind, expresia s-ar
  // calcula de doua ori si s-ar sterge tocmai memo-ul care o calcula o data.
  const module = parseModule(
    `component App {
      const n = state(1)
      const scump = derived(() => n * n * n)
      <div>{scump + scump}</div>
    }`,
    "App.raptor",
  );

  const optimized = optimize(module, { fusion: true });
  assert.ok(names(optimized.module).includes("scump"), "memo-ul trebuie sa supravietuiasca");
  assert.equal(textBindings(optimized.module)[0], "(scump + scump)");
  assert.ok(optimized.trace.some((t) => t.action === "blocked" && t.detail.includes("duplica")));
});

test("U2: o singura folosire se fuzioneaza in continuare", () => {
  // Reparatia nu are voie sa opreasca optimizarea in cazul pentru care exista.
  const module = parseModule(
    `component App {
      const n = state(1)
      const eticheta = derived(() => "n = " + n)
      <div>{eticheta}</div>
    }`,
    "App.raptor",
  );
  const optimized = optimize(module, { fusion: true });
  assert.ok(!names(optimized.module).includes("eticheta"), "un consumator, o folosire: se fuzioneaza");
});

/* ------------------------------- U4/U5: DSE si handlerele de evenimente ----- */

test("U4: un derived citit doar intr-un handler nu e eliminat", () => {
  // Inainte: DSE il stergea (handlerele nu erau sinks si nu aveau muchii de
  // citire), iar codul emis ramanea cu o referinta catre un nume inexistent -
  // `ReferenceError` la primul click, dintr-un build raportat ca reusit.
  const built = buildModule(
    `component App {
      const count = state(0)
      const pas = derived(() => 10)
      <button on:click={count += pas}>+</button>
    }`,
    "App.raptor",
  );
  const browser = built.browser;
  assert.match(browser, /on:click/);
  assert.doesNotMatch(
    browser,
    /\bpas\b(?!\s*=)/,
    "ori `pas` e declarat, ori a fost inlocuit cu valoarea lui - dar nu lasat atarnand",
  );
  for (const nume of referintele(browser)) {
    assert.ok(declarat(browser, nume), `codul emis foloseste '${nume}' fara sa-l declare`);
  }
});

test("U5: un semnal scris doar intr-un handler nu e eliminat", () => {
  const built = buildModule(
    `component App {
      const vizite = state(0)
      <div><button on:click={vizite++}>numara</button><span>static</span></div>
    }`,
    "App.raptor",
  );
  const browser = built.browser;
  assert.match(browser, /const vizite = state\(0\)/, "semnalul scris de handler trebuie sa existe");
  assert.match(browser, /vizite\.set\(/, "iar handler-ul chiar scrie in el");
});

test("U4/U5: un derived cu adevarat mort este in continuare eliminat", () => {
  const built = buildModule(
    `component App {
      const n = state(1)
      const mort = derived(() => n * 999)
      <div>{n}</div>
    }`,
    "App.raptor",
  );
  assert.doesNotMatch(built.browser, /mort/, "DSE trebuie sa ramana folositor");
});

/* ------------------------------------------------------------- ajutoare ---- */

/** Identificatorii folositi in codul emis care ar trebui sa fie locali. */
function referintele(code: string): string[] {
  const found = new Set<string>();
  for (const m of code.matchAll(/\b([a-z][A-Za-z0-9_]*)\(\)/g)) found.add(m[1]!);
  // Numele care vin din import-uri, nu din componenta.
  for (const nume of ["state", "derived", "effect", "createElement", "applyProps", "mountChild"]) {
    found.delete(nume);
  }
  return [...found];
}

function declarat(code: string, nume: string): boolean {
  return new RegExp(`const ${nume}\\b`).test(code);
}
