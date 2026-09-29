/**
 * Care componente din catalog re-ruleaza computatia PARINTE cand le atingi.
 *
 * Context: o componenta care CITESTE un semnal in timp ce se construieste
 * aboneaza computatia apelantului la acel semnal. Daca apelantul e un binding
 * reactiv - un `Show`, un `For`, orice regiune dintr-o aplicatie reala - atunci
 * interactiunea cu componenta re-ruleaza toata regiunea parinte, nu doar
 * componenta. Simptomul: un dropdown care, la deschidere, reconstruieste
 * pagina din jurul lui.
 *
 * Site-ul ocoleste asta construind fiecare demo in `untracked(...)`. Ocolul din
 * consumator e insa un semn ca problema e in biblioteca: oricine foloseste
 * `raptorjs/ui` intr-un binding da peste ea fara sa stie de ce.
 *
 * Masuram simptomul, nu cauza: montam demo-ul INAUNTRUL unui effect, apasam
 * primul buton din el, si vedem daca effect-ul s-a re-rulat.
 *
 * Fisierul nu e cod de aplicatie - nimic nu-l importa, deci nu ajunge in
 * bundle-ul site-ului. E punctul de intrare pe care il da bundler-ul unui test.
 */
import { effect, createRoot } from "raptorjs";
import { mountChild } from "raptorjs/dom";
import { CATALOG } from "./index.ts";

export interface LeakReport {
  /** Componente la care o interactiune re-ruleaza computatia parinte. */
  leaking: string[];
  checked: number;
  /** Demo-uri care n-au putut fi exercitate (fara buton de apasat). */
  skipped: number;
}

function firstButton(host: any): any {
  const direct = host.querySelectorAll?.("button") ?? [];
  return direct.length > 0 ? direct[0] : null;
}

export function findLeaks(): LeakReport {
  const doc = (globalThis as { document?: any }).document;
  const leaking: string[] = [];
  let checked = 0;
  let skipped = 0;

  for (const group of CATALOG) {
    for (const item of group.items) {
      let runs = 0;
      let host: any = null;
      let dispose = (): void => {};
      try {
        dispose = createRoot((d) => {
          effect(() => {
            runs += 1;
            host = doc.createElement("div");
            mountChild(host, item.demo() as never, null);
          });
          return d;
        });
      } catch {
        dispose();
        skipped += 1;
        continue;
      }

      const button = host && firstButton(host);
      if (!button) {
        dispose();
        skipped += 1;
        continue;
      }

      checked += 1;
      const inainte = runs;
      try {
        button.click?.();
      } catch {
        /* demo-ul poate cere ceva ce mini-dom-ul nu are; nu e ce masuram */
      }
      if (runs > inainte) leaking.push(`${group.title} / ${item.name}`);
      dispose();
    }
  }

  return { leaking, checked, skipped };
}

(globalThis as Record<string, unknown>).__catalogLeaks = findLeaks();
