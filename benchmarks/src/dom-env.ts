/**
 * Mediu DOM partajat pentru benchmark: un singur jsdom in care randeaza TOATE
 * framework-urile (RaptorJS, React, Preact), ca sa fie masuratori
 * apples-to-apples pe exact aceeasi implementare de DOM.
 *
 * In plus, patch-uim prototipurile jsdom ca sa numaram operatiile DOM reale
 * initiate de fiecare framework (createElement, createText, insert, remove,
 * textUpdate). Contoarele sunt identice pentru toate => comparatie corecta a
 * "cantitatii de munca" pe care o face fiecare framework la un update.
 *
 * IMPORTANT: acest fisier trebuie importat INAINTE de orice framework, ca sa
 * seteze globalele (document/window/...) de care React & co au nevoie.
 */
import { JSDOM } from "jsdom";

export interface DomCounters {
  createElement: number;
  createText: number;
  insert: number;
  remove: number;
  textUpdate: number;
}

export const counters: DomCounters = newCounters();

function newCounters(): DomCounters {
  return { createElement: 0, createText: 0, insert: 0, remove: 0, textUpdate: 0 };
}

export function resetCounters(): void {
  Object.assign(counters, newCounters());
}

export function snapshotCounters(): DomCounters {
  return { ...counters };
}

const jsdom = new JSDOM(
  '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  { pretendToBeVisual: true },
);
const win = jsdom.window as unknown as typeof globalThis & Record<string, unknown>;

// Expune globalele de care au nevoie framework-urile bazate pe DOM. Unele
// globale (navigator) sunt getter-only in Node 24, deci atribuim defensiv.
function def(name: string, value: unknown): void {
  try {
    (globalThis as Record<string, unknown>)[name] = value;
  } catch {
    try {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    } catch {
      /* getter-only si neconfigurabil: il lasam pe cel din Node */
    }
  }
}

def("window", win);
def("document", win.document);
def("navigator", (win as any).navigator);
def("HTMLElement", (win as any).HTMLElement);
def("Node", (win as any).Node);
def("Text", (win as any).Text);
def("Element", (win as any).Element);
def("Document", (win as any).Document);
def("Event", (win as any).Event);
def("CustomEvent", (win as any).CustomEvent);
def("getComputedStyle", (win as any).getComputedStyle);
def("requestAnimationFrame", (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0));
def("cancelAnimationFrame", (id: number) => clearTimeout(id));
// React 19 / act: evita warning-uri.
def("IS_REACT_ACT_ENVIRONMENT", false);

// --- Instrumentare operatii DOM -------------------------------------------
function wrapMethod(proto: any, name: string, onCall: () => void): void {
  const original = proto[name];
  proto[name] = function patched(this: unknown, ...args: unknown[]) {
    onCall();
    return original.apply(this, args);
  };
}

function wrapSetter(proto: any, name: string, onSet: (self: any) => void): void {
  const desc = Object.getOwnPropertyDescriptor(proto, name);
  if (!desc || !desc.set) return;
  const originalSet = desc.set;
  const originalGet = desc.get;
  Object.defineProperty(proto, name, {
    configurable: true,
    enumerable: desc.enumerable,
    get: originalGet,
    set(this: any, value: unknown) {
      onSet(this);
      originalSet.call(this, value);
    },
  });
}

const W = win as any;
wrapMethod(W.Document.prototype, "createElement", () => counters.createElement++);
wrapMethod(W.Document.prototype, "createTextNode", () => counters.createText++);
wrapMethod(W.Node.prototype, "appendChild", () => counters.insert++);
wrapMethod(W.Node.prototype, "insertBefore", () => counters.insert++);
wrapMethod(W.Node.prototype, "removeChild", () => counters.remove++);

// Mutatii de text: setarea .data / .nodeValue pe un text node, sau .textContent
// pe un element cu un singur copil-text (calea rapida a lui React).
wrapSetter(W.CharacterData.prototype, "data", () => counters.textUpdate++);
wrapSetter(W.Node.prototype, "nodeValue", (self) => {
  if (self && self.nodeType === 3) counters.textUpdate++;
});
wrapSetter(W.Node.prototype, "textContent", (self) => {
  // Numaram doar setarile pe elemente (nu pe text nodes, deja numarate mai sus).
  if (self && self.nodeType === 1) counters.textUpdate++;
});

export const document = win.document;
export const rootElement = win.document.getElementById("root") as unknown as HTMLElement;

/** Creeaza un container proaspat sub #root si il intoarce. */
export function freshContainer(): HTMLElement {
  rootElement.innerHTML = "";
  const el = win.document.createElement("div");
  rootElement.appendChild(el);
  return el as unknown as HTMLElement;
}
