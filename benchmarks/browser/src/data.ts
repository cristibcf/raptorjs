/** Model de date standard din js-framework-benchmark. */

export interface Row {
  id: number;
  label: string;
}

const ADJECTIVES = [
  "pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain",
  "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd",
  "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy",
];
const COLOURS = [
  "red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white",
  "black", "orange",
];
const NOUNS = [
  "table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich",
  "burger", "pizza", "mouse", "keyboard",
];

let nextId = 1;

function pick<T>(arr: T[], r: number): T {
  return arr[Math.round(r * (arr.length - 1))]!;
}

/** Construieste `count` randuri cu id-uri unice globale (ca in benchmark-ul real). */
export function buildData(count: number): Row[] {
  const data: Row[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const label = `${pick(ADJECTIVES, Math.random())} ${pick(COLOURS, Math.random())} ${pick(NOUNS, Math.random())}`;
    data[i] = { id: nextId++, label };
  }
  return data;
}
