/**
 * QRCode - generator de coduri QR, fara dependinte.
 *
 * Implementeaza ISO/IEC 18004 pentru **modul byte**, versiunile 1-10, cu toate
 * cele patru niveluri de corectie. Modul byte acopera URL-uri si text UTF-8,
 * adica 99% din utilizari; modurile numeric si alfanumeric ar comprima mai bine
 * dar ar dubla codul pentru un castig pe care rareori il observi.
 *
 * Partile care nu pot fi aproximate, si de aceea sunt implementate complet:
 * aritmetica in GF(256), codurile Reed-Solomon, intreteserea blocurilor,
 * cele opt masti cu scorul lor de penalizare si bitii BCH de format. Un QR cu
 * masca gresit aleasa se scaneaza prost; unul cu RS gresit nu se scaneaza deloc.
 */
import { derived, type Accessor } from "@raptor/core";
import { R, type Child } from "@raptor/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EcLevel = "L" | "M" | "Q" | "H";

/* ---------------------------------------------------------- GF(256) ------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    // Polinomul primitiv al QR: x^8 + x^4 + x^3 + x^2 + 1 (0x11D).
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** Polinomul generator pentru `degree` codewords de corectie. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** Restul impartirii datelor la polinomul generator = codewords de corectie. */
export function reedSolomon(data: readonly number[], ecCount: number): number[] {
  const gen = generatorPoly(ecCount);
  const remainder = new Array<number>(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) {
        remainder[i] = remainder[i]! ^ gfMul(gen[i + 1]!, factor);
      }
    }
  }
  return remainder;
}

/* ------------------------------------------------------- tabele versiuni -- */

/** `[ecPerBlock, blocuriGrup1, dateGrup1, blocuriGrup2, dateGrup2]`. */
const BLOCKS: Record<EcLevel, ReadonlyArray<readonly [number, number, number, number, number]>> = {
  L: [
    [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
  ],
  M: [
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
  ],
  Q: [
    [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0], [18, 2, 15, 2, 16],
    [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19], [20, 4, 16, 4, 17], [24, 6, 19, 2, 20],
  ],
  H: [
    [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0], [22, 2, 11, 2, 12],
    [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16],
  ],
};

/** Centrele tiparelor de aliniere, per versiune. */
const ALIGNMENT: ReadonlyArray<readonly number[]> = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

const EC_BITS: Record<EcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

export const MAX_VERSION = 10;

/** Cate codewords de date incap intr-o versiune la un nivel dat. */
export function dataCapacity(version: number, ec: EcLevel): number {
  const spec = BLOCKS[ec][version - 1];
  if (!spec) return 0;
  const [, g1, d1, g2, d2] = spec;
  return g1 * d1 + g2 * d2;
}

/** Cea mai mica versiune in care incap `byteLength` octeti. */
export function pickVersion(byteLength: number, ec: EcLevel): number | null {
  for (let version = 1; version <= MAX_VERSION; version++) {
    // 4 biti mod + 8/16 biti lungime + date.
    const countBits = version < 10 ? 8 : 16;
    const needed = Math.ceil((4 + countBits + byteLength * 8) / 8);
    if (needed <= dataCapacity(version, ec)) return version;
  }
  return null;
}

/* ------------------------------------------------------------- codificare */

class BitWriter {
  private readonly bits: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
  get length(): number {
    return this.bits.length;
  }
  toBytes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      out.push(byte);
    }
    return out;
  }
}

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return out;
}

/** Datele codificate + corectia, intretesute conform standardului. */
export function encodeData(text: string, version: number, ec: EcLevel): number[] {
  const bytes = utf8Bytes(text);
  const capacity = dataCapacity(version, ec);
  const writer = new BitWriter();

  writer.push(0b0100, 4); // mod byte
  writer.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) writer.push(byte, 8);

  // Terminator: pana la 4 biti de zero, dar nu peste capacitate.
  const capacityBits = capacity * 8;
  writer.push(0, Math.min(4, capacityBits - writer.length));
  // Aliniere la octet.
  if (writer.length % 8 !== 0) writer.push(0, 8 - (writer.length % 8));

  const data = writer.toBytes();
  // Umplere alternativa 0xEC / 0x11, cum cere standardul.
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < capacity; i++) data.push(PAD[i % 2]!);

  // Impartirea in blocuri.
  const [ecPerBlock, g1, d1, g2, d2] = BLOCKS[ec][version - 1]!;
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let at = 0;
  for (let i = 0; i < g1; i++) {
    const block = data.slice(at, at + d1);
    at += d1;
    blocks.push(block);
    ecBlocks.push(reedSolomon(block, ecPerBlock));
  }
  for (let i = 0; i < g2; i++) {
    const block = data.slice(at, at + d2);
    at += d2;
    blocks.push(block);
    ecBlocks.push(reedSolomon(block, ecPerBlock));
  }

  // Intretesere: codeword i din fiecare bloc, apoi corectia la fel.
  const out: number[] = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]!);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]!);
  }
  return out;
}

/* --------------------------------------------------------------- matrice -- */

export interface QrMatrix {
  size: number;
  version: number;
  ec: EcLevel;
  mask: number;
  /** `true` = modul negru. Indexare `[rand][coloana]`. */
  modules: boolean[][];
}

function bch(value: number, generator: number, bits: number): number {
  let rest = value << bits;
  const genBits = 32 - Math.clz32(generator);
  while (32 - Math.clz32(rest) >= genBits) {
    rest ^= generator << (32 - Math.clz32(rest) - genBits);
  }
  return rest;
}

const MASK_FN: ReadonlyArray<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Penalizarea unei matrice mascate (regulile 1-4 din standard). */
export function maskPenalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let penalty = 0;

  // Regula 1: serii de 5+ module de aceeasi culoare.
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const a = horizontal ? modules[i]![j]! : modules[j]![i]!;
        const b = horizontal ? modules[i]![j - 1]! : modules[j - 1]![i]!;
        if (a === b) {
          run++;
        } else {
          if (run >= 5) penalty += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) penalty += 3 + (run - 5);
    }
  }

  // Regula 2: blocuri 2x2 de aceeasi culoare.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r]![c]!;
      if (v === modules[r]![c + 1] && v === modules[r + 1]![c] && v === modules[r + 1]![c + 1]) {
        penalty += 3;
      }
    }
  }

  // Regula 3: tipare care seamana cu un finder (1:1:3:1:1 cu spatiu).
  const P1 = [true, false, true, true, true, false, true, false, false, false, false];
  const P2 = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (line: readonly boolean[], at: number, pattern: readonly boolean[]): boolean => {
    for (let k = 0; k < pattern.length; k++) if (line[at + k] !== pattern[k]) return false;
    return true;
  };
  for (let i = 0; i < size; i++) {
    const row = modules[i]!;
    const col = modules.map((r) => r[i]!);
    for (let j = 0; j + 11 <= size; j++) {
      if (matches(row, j, P1) || matches(row, j, P2)) penalty += 40;
      if (matches(col, j, P1) || matches(col, j, P2)) penalty += 40;
    }
  }

  // Regula 4: abaterea de la 50% module negre.
  let dark = 0;
  for (const row of modules) for (const v of row) if (v) dark++;
  const percent = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return penalty;
}

/** Construieste matricea completa: tipare, date, masca aleasa, format. */
export function buildMatrix(text: string, ec: EcLevel = "M", forcedVersion?: number): QrMatrix {
  const bytes = utf8Bytes(text).length;
  const version = forcedVersion ?? pickVersion(bytes, ec);
  if (version === null) {
    throw new Error(
      `[raptor] textul are ${bytes} octeti, prea mult pentru un QR versiunea ${MAX_VERSION} la nivelul ${ec}. ` +
        "Scurteaza textul sau scade nivelul de corectie.",
    );
  }

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const put = (r: number, c: number, value: boolean): void => {
    modules[r]![c] = value;
    reserved[r]![c] = true;
  };

  // Finder patterns + separatoare.
  const finder = (top: number, left: number): void => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = top + r;
        const cc = left + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const isDark =
          inRing &&
          ((r === 0 || r === 6 || c === 0 || c === 6) || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        put(rr, cc, isDark);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    put(6, i, i % 2 === 0);
    put(i, 6, i % 2 === 0);
  }

  // Alignment patterns (nu peste findere).
  const centers = ALIGNMENT[version - 1] ?? [];
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          put(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Modulul intunecat obligatoriu.
  put(size - 8, 8, true);

  // Rezervam zonele de format (se umplu dupa alegerea mastii).
  for (let i = 0; i < 9; i++) {
    if (!reserved[8]![i]) reserved[8]![i] = true;
    if (!reserved[i]![8]) reserved[i]![8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8]![size - 1 - i] = true;
    reserved[size - 1 - i]![8] = true;
  }

  // Informatia de versiune (doar 7+).
  if (version >= 7) {
    const info = (version << 12) | bch(version, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const bit = ((info >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      put(r, c, bit);
      put(c, r, bit);
    }
  }

  // Datele, in zigzag de jos-dreapta spre stanga.
  const codewords = encodeData(text, version, ec);
  let bitIndex = 0;
  const nextBit = (): boolean => {
    const byte = codewords[bitIndex >> 3];
    const bit = byte === undefined ? false : ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
    bitIndex++;
    return bit;
  };

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    // Coloana de timing se sare cu totul.
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row]![col]) continue;
        modules[row]![col] = nextBit();
      }
    }
    upward = !upward;
  }

  // Alegem masca cu penalizarea minima.
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestModules = modules;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row, r) =>
      row.map((value, c) => (reserved[r]![c] ? value : value !== MASK_FN[mask]!(r, c))),
    );
    applyFormat(candidate, reserved, ec, mask, size);
    const score = maskPenalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  return { size, version, ec, mask: bestMask, modules: bestModules };
}

/** Scrie cei 15 biti de format (nivel EC + masca + BCH). */
function applyFormat(
  modules: boolean[][],
  reserved: readonly (readonly boolean[])[],
  ec: EcLevel,
  mask: number,
  size: number,
): void {
  const value = (EC_BITS[ec] << 3) | mask;
  const format = ((value << 10) | bch(value, 0x537, 10)) ^ 0x5412;
  void reserved;

  for (let i = 0; i < 15; i++) {
    const bit = ((format >> i) & 1) === 1;
    // Copia 1: in jurul finderului din stanga-sus.
    if (i < 6) modules[8]![i] = bit;
    else if (i === 6) modules[8]![7] = bit;
    else if (i === 7) modules[8]![8] = bit;
    else if (i === 8) modules[7]![8] = bit;
    else modules[14 - i]![8] = bit;

    // Copia 2: sub finderul din stanga-jos si langa cel din dreapta-sus.
    if (i < 8) modules[size - 1 - i]![8] = bit;
    else modules[8]![size - 15 + i] = bit;
  }
  modules[size - 8]![8] = true; // modulul intunecat
}

/** Extrage nivelul EC si masca din matricea gata construita (pentru teste). */
export function readFormat(matrix: QrMatrix): { ec: EcLevel; mask: number } | null {
  let raw = 0;
  for (let i = 0; i < 15; i++) {
    let bit: boolean;
    if (i < 6) bit = matrix.modules[8]![i]!;
    else if (i === 6) bit = matrix.modules[8]![7]!;
    else if (i === 7) bit = matrix.modules[8]![8]!;
    else if (i === 8) bit = matrix.modules[7]![8]!;
    else bit = matrix.modules[14 - i]![8]!;
    if (bit) raw |= 1 << i;
  }
  const value = (raw ^ 0x5412) >> 10;
  const bits = (value >> 3) & 0b11;
  const level = (Object.keys(EC_BITS) as EcLevel[]).find((k) => EC_BITS[k] === bits);
  return level ? { ec: level, mask: value & 0b111 } : null;
}

/* ------------------------------------------------------------- componenta */

export interface QRCodeProps {
  value: Accessor<string> | string;
  /** Nivel de corectie. `H` rezista la ~30% deteriorare. Implicit `M`. */
  level?: EcLevel;
  /** Latimea totala in px. Implicit 160. */
  size?: number;
  /** Module de margine (zona linistita). Standardul cere 4. */
  quietZone?: number;
  foreground?: string;
  background?: string;
  /** Text alternativ. Fara el, codul e ascuns de screen reader. */
  label?: string;
  /** Continut afisat daca textul nu incape. */
  fallback?: Child;
  class?: string;
}

/**
 * Randeaza codul ca un singur `path` SVG.
 *
 * Un `<rect>` per modul ar insemna ~1000 de elemente pentru o versiune 5.
 * Toate patratele intr-un singur `d` inseamna **un singur nod** si o singura
 * scriere de atribut cand textul se schimba.
 */
export function QRCode(props: QRCodeProps): El {
  const read = (): string => (typeof props.value === "function" ? props.value() : props.value);
  const quiet = props.quietZone ?? 4;
  const size = props.size ?? 160;

  const model = derived<{ matrix: QrMatrix; path: string } | { error: string }>(() => {
    try {
      const matrix = buildMatrix(read(), props.level ?? "M");
      let path = "";
      for (let r = 0; r < matrix.size; r++) {
        for (let c = 0; c < matrix.size; c++) {
          if (matrix.modules[r]![c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
        }
      }
      return { matrix, path };
    } catch (error) {
      return { error: (error as Error).message };
    }
  });

  const side = (): number => {
    const m = model();
    return "matrix" in m ? m.matrix.size + quiet * 2 : 1;
  };

  return R.div(
    { class: props.class ? "rui-qrcode " + props.class : "rui-qrcode" },
    () => {
      const m = model();
      if ("error" in m) {
        return props.fallback ?? R.span({ class: "rui-qrcode-error", role: "alert" }, m.error);
      }
      return R.svg(
        {
          class: "rui-qrcode-svg",
          width: String(size),
          height: String(size),
          viewBox: `0 0 ${side()} ${side()}`,
          "shape-rendering": "crispEdges",
          role: "img",
          ...(props.label ? { "aria-label": props.label } : { "aria-hidden": "true" }),
        },
        R.rect({
          width: String(side()),
          height: String(side()),
          fill: props.background ?? "#ffffff",
        }),
        R.path({ fill: props.foreground ?? "#000000", d: m.path }),
      );
    },
  );
}
