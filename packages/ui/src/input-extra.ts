/**
 * MaskedInput, CurrencyInput, PhoneInput, DateInput, Mentions, Rating,
 * ColorPicker, ColorSwatchPicker, TransferList, TreeSelect, Cascader.
 *
 * Controale specializate. Partea de logica (aplicarea unei masti, formatarea
 * monetara, parsarea unui numar de telefon) e exportata separat de componente,
 * ca sa poata fi testata si refolosita fara DOM.
 */
import { state, derived, onCleanup, type Accessor, type State } from "@raptor/core";
import { R, For, Show, type Child } from "@raptor/dom";
import { clickOutside } from "./primitives/click-outside.ts";
import { positioner, type Placement } from "./primitives/positioner.ts";
import { focus, type El } from "./primitives/env.ts";
import { Button } from "./button.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/* ----------------------------------------------------------- MaskedInput -- */

/**
 * Aplica o masca peste text.
 *
 * Simboluri: `9` = cifra, `A` = litera, `*` = orice caracter alfanumeric.
 * Restul caracterelor din masca sunt literale si se insereaza automat, dar
 * **doar intre caractere tastate**: `applyMask("1234", "9999-99-99")` da
 * `"1234"`, nu `"1234-"`. Altfel cursorul ar ajunge dupa o liniuta pe care
 * utilizatorul nu a scris-o, iar Backspace ar parea ca nu face nimic.
 * Intoarce si pozitia cursorului, altfel acesta sare la finalul campului dupa
 * fiecare tastare - cel mai enervant bug al inputurilor cu masca.
 */
export function applyMask(
  raw: string,
  mask: string,
  caret = raw.length,
): { value: string; caret: number } {
  let out = "";
  let cursor = 0;
  let newCaret = 0;
  let consumed = 0;

  for (let i = 0; i < mask.length && cursor < raw.length; i++) {
    const token = mask[i]!;
    const char = raw[cursor];
    if (char === undefined) break;

    if (token === "9" || token === "A" || token === "*") {
      const ok =
        token === "9" ? /\d/.test(char) : token === "A" ? /[a-zA-Z]/.test(char) : /[a-zA-Z0-9]/.test(char);
      if (!ok) {
        cursor++;
        i--; // masca ramane pe acelasi simbol; sarim caracterul invalid
        continue;
      }
      out += char;
      cursor++;
      consumed++;
    } else {
      out += token;
      // Daca utilizatorul a tastat chiar separatorul, il consumam.
      if (char === token) cursor++;
    }
    if (consumed <= caret) newCaret = out.length;
  }

  return { value: out, caret: newCaret };
}

/**
 * Scoate separatorii, lasand doar caracterele de date.
 *
 * Asteapta un text produs de `applyMask` cu ACEEASI masca: comparatia e
 * pozitionala, fiindca o masca poate contine si cifre literale (`"+40 999..."`)
 * pe care o filtrare oarba le-ar pastra gresit.
 */
export function unmask(value: string, mask: string): string {
  let out = "";
  for (let i = 0; i < value.length && i < mask.length; i++) {
    const token = mask[i]!;
    if (token === "9" || token === "A" || token === "*") out += value[i]!;
  }
  return out;
}

export interface MaskedInputProps {
  value: State<string>;
  /** Ex. `"9999-99-99"`, `"(999) 999-9999"`. */
  mask: string;
  placeholder?: string;
  disabled?: Accessor<boolean> | boolean;
  id?: string;
  label?: string;
  /** Primeste valoarea fara separatori. */
  onChange?: (unmasked: string) => void;
  class?: string;
}

function readOff(value: Accessor<boolean> | boolean | undefined): boolean {
  if (value === undefined) return false;
  return typeof value === "function" ? value() : value;
}

export function MaskedInput(props: MaskedInputProps): El {
  const id = props.id ?? "rui-mask-" + ++idSeq;
  let el: El = null;

  return R.input({
    id,
    type: "text",
    class: props.class ? "rui-input-control " + props.class : "rui-input-control",
    ...(props.placeholder ? { placeholder: props.placeholder } : { placeholder: props.mask.replace(/[9A*]/g, "_") }),
    ...(props.label ? { "aria-label": props.label } : {}),
    disabled: () => readOff(props.disabled),
    value: () => props.value(),
    ref: (node: El) => {
      el = node;
    },
    "on:input": (e: any) => {
      const target = e.target;
      const caret = typeof target?.selectionStart === "number" ? target.selectionStart : undefined;
      const result = applyMask(String(target?.value ?? ""), props.mask, caret);
      props.value.set(result.value);
      props.onChange?.(unmask(result.value, props.mask));
      // Repunem cursorul acolo unde il asteapta utilizatorul.
      if (el && typeof el.setSelectionRange === "function") {
        queueMicrotask(() => {
          try {
            el.setSelectionRange(result.caret, result.caret);
          } catch {
            /* input-ul poate sa nu suporte selectie (type=number) */
          }
        });
      }
    },
  });
}

/* --------------------------------------------------------- CurrencyInput -- */

export interface CurrencyInputProps {
  /** Valoarea in unitati MINIMALE (bani, cenți) - numar intreg. */
  value: State<number>;
  currency?: string;
  locale?: string;
  /** Zecimale ale monedei. Implicit 2. */
  decimals?: number;
  min?: number;
  max?: number;
  disabled?: Accessor<boolean> | boolean;
  id?: string;
  label?: string;
  class?: string;
}

/**
 * Formateaza o suma tinuta in unitati minimale.
 *
 * Banii se tin in **intregi**, nu in `float`: `0.1 + 0.2 !== 0.3`, iar o eroare
 * de rotunjire intr-un cos de cumparaturi e un bug real, nu unul cosmetic.
 */
export function formatCurrency(
  minorUnits: number,
  currency = "RON",
  locale?: string,
  decimals = 2,
): string {
  const major = minorUnits / Math.pow(10, decimals);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(major);
  } catch {
    return major.toFixed(decimals) + " " + currency;
  }
}

/** Citeste cifrele dintr-un text si le interpreteaza ca unitati minimale. */
export function parseCurrency(text: string, decimals = 2): number {
  const digits = text.replace(/\D/g, "");
  if (digits === "") return 0;
  void decimals;
  return Number(digits);
}

export function CurrencyInput(props: CurrencyInputProps): El {
  const id = props.id ?? "rui-cur-" + ++idSeq;
  const decimals = props.decimals ?? 2;
  const focused = state(false);

  const display = derived(() =>
    focused()
      ? String(props.value() / Math.pow(10, decimals))
      : formatCurrency(props.value(), props.currency, props.locale, decimals),
  );

  const clamp = (n: number): number => {
    let next = n;
    if (props.min !== undefined) next = Math.max(props.min, next);
    if (props.max !== undefined) next = Math.min(props.max, next);
    return next;
  };

  return R.input({
    id,
    type: "text",
    inputmode: "decimal",
    class: props.class ? "rui-input-control rui-tabular " + props.class : "rui-input-control rui-tabular",
    ...(props.label ? { "aria-label": props.label } : {}),
    disabled: () => readOff(props.disabled),
    value: () => display(),
    "on:focus": () => focused.set(true),
    "on:blur": () => focused.set(false),
    "on:input": (e: any) => {
      // In timpul tastarii citim cifrele ca unitati minimale: tastand "1234"
      // obtii 12,34 lei, ca la un terminal de plata.
      props.value.set(clamp(parseCurrency(String(e.target?.value ?? ""), decimals)));
    },
  });
}

/* ------------------------------------------------------------ PhoneInput -- */

/** Grupeaza cifrele dupa un sablon simplu (ex. `[3,3,4]` -> `123 456 7890`). */
export function groupDigits(digits: string, groups: readonly number[]): string {
  const out: string[] = [];
  let at = 0;
  for (const size of groups) {
    if (at >= digits.length) break;
    out.push(digits.slice(at, at + size));
    at += size;
  }
  if (at < digits.length) out.push(digits.slice(at));
  return out.join(" ");
}

export interface PhoneInputProps {
  value: State<string>;
  /** Prefix afisat (ex. `"+40"`). Nu face parte din valoare. */
  prefix?: string;
  /** Gruparea cifrelor. Implicit `[3, 3, 3]`. */
  groups?: readonly number[];
  /** Numar minim de cifre pentru a fi considerat valid. Implicit 9. */
  minDigits?: number;
  disabled?: Accessor<boolean> | boolean;
  id?: string;
  label?: string;
  class?: string;
}

export function PhoneInput(props: PhoneInputProps): El {
  const id = props.id ?? "rui-tel-" + ++idSeq;
  const groups = props.groups ?? [3, 3, 3];
  const digits = derived(() => props.value().replace(/\D/g, ""));
  const valid = derived(() => digits().length >= (props.minDigits ?? 9));

  return R.div(
    { class: props.class ? "rui-phone " + props.class : "rui-phone" },
    props.prefix !== undefined
      ? R.span({ class: "rui-phone-prefix", "aria-hidden": "true" }, props.prefix)
      : null,
    R.input({
      id,
      type: "tel",
      class: "rui-phone-input rui-tabular",
      inputmode: "tel",
      autocomplete: "tel",
      ...(props.label ? { "aria-label": (props.prefix ? props.prefix + " " : "") + props.label } : {}),
      "aria-invalid": () => String(digits().length > 0 && !valid()),
      disabled: () => readOff(props.disabled),
      value: () => groupDigits(digits(), groups),
      "on:input": (e: any) => props.value.set(String(e.target?.value ?? "").replace(/\D/g, "")),
    }),
  );
}

/* ------------------------------------------------------------- DateInput -- */

export interface DateInputProps {
  value: State<string>;
  /** Formatul asteptat. Implicit `"9999-99-99"` (ISO). */
  mask?: string;
  disabled?: Accessor<boolean> | boolean;
  id?: string;
  label?: string;
  class?: string;
}

/** Input de data cu masca, fara calendar. Pentru cine stie ce scrie. */
export function DateInput(props: DateInputProps): El {
  return MaskedInput({
    value: props.value,
    mask: props.mask ?? "9999-99-99",
    disabled: props.disabled,
    id: props.id,
    label: props.label ?? "Dată (AAAA-LL-ZZ)",
    class: props.class,
  });
}

/* -------------------------------------------------------------- Mentions -- */

export interface MentionOption {
  id: string;
  label: string;
  detail?: string;
}

export interface MentionsProps {
  value: State<string>;
  /** Cauta dupa textul de dupa `trigger`. */
  search: (query: string) => readonly MentionOption[];
  /** Caracterul care deschide lista. Implicit `@`. */
  trigger?: string;
  placeholder?: string;
  rows?: number;
  onMention?: (option: MentionOption) => void;
  label?: string;
  class?: string;
}

/** Gaseste tokenul `@...` in care se afla cursorul, daca exista. */
export function activeMention(
  text: string,
  caret: number,
  trigger = "@",
): { query: string; start: number } | null {
  // Cautam inapoi de la cursor pana la trigger, oprindu-ne la spatiu.
  for (let i = caret - 1; i >= 0; i--) {
    const char = text[i]!;
    if (char === trigger) {
      // Triggerul e valid doar la inceput de cuvant.
      const before = i > 0 ? text[i - 1]! : " ";
      if (!/\s/.test(before) && i !== 0) return null;
      return { query: text.slice(i + 1, caret), start: i };
    }
    if (/\s/.test(char)) return null;
  }
  return null;
}

export function Mentions(props: MentionsProps): El {
  const id = "rui-men-" + ++idSeq;
  const trigger = props.trigger ?? "@";
  const open = state(false);
  const query = state("");
  const active = state(0);
  let tokenStart = -1;
  let el: El = null;

  const options = derived(() => (open() ? props.search(query()) : []));
  const pos = positioner({ placement: "bottom-start", enabled: () => open() });

  const close = (): void => {
    open.set(false);
    tokenStart = -1;
  };

  const insert = (option: MentionOption): void => {
    if (tokenStart < 0) return;
    const text = props.value.peek();
    const caret = typeof el?.selectionStart === "number" ? el.selectionStart : text.length;
    const next = text.slice(0, tokenStart) + trigger + option.label + " " + text.slice(caret);
    props.value.set(next);
    props.onMention?.(option);
    close();
  };

  const refresh = (): void => {
    const text = props.value.peek();
    const caret = typeof el?.selectionStart === "number" ? el.selectionStart : text.length;
    const token = activeMention(text, caret, trigger);
    if (!token) {
      close();
      return;
    }
    tokenStart = token.start;
    query.set(token.query);
    open.set(true);
    active.set(0);
  };

  return R.div(
    {
      class: props.class ? "rui-mentions " + props.class : "rui-mentions",
      ref: (node: El) => {
        clickOutside(close, { enabled: () => open() })(node);
        pos.reference(node);
      },
    },
    R.textarea({
      id,
      class: "rui-textarea",
      rows: String(props.rows ?? 3),
      ...(props.placeholder ? { placeholder: props.placeholder } : {}),
      ...(props.label ? { "aria-label": props.label } : {}),
      "aria-autocomplete": "list",
      "aria-controls": id + "-list",
      "aria-expanded": () => String(open()),
      value: () => props.value(),
      ref: (node: El) => {
        el = node;
      },
      "on:input": (e: any) => {
        props.value.set(String(e.target?.value ?? ""));
        refresh();
      },
      "on:click": refresh,
      "on:keydown": (e: any) => {
        const list = options();
        if (!open() || list.length === 0) return;
        if (e.key === "ArrowDown") {
          e.preventDefault?.();
          active.set((active() + 1) % list.length);
        } else if (e.key === "ArrowUp") {
          e.preventDefault?.();
          active.set((active() - 1 + list.length) % list.length);
        } else if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault?.();
          const option = list[active()];
          if (option) insert(option);
        } else if (e.key === "Escape") {
          e.preventDefault?.();
          close();
        }
      },
    }),
    Show({
      when: () => open() && options().length > 0,
      children: R.ul(
        {
          id: id + "-list",
          class: "rui-mentions-list",
          role: "listbox",
          ref: pos.floating,
          style: () => pos.style(),
        },
        For({
          each: () => options(),
          children: (option: MentionOption, index: number) =>
            R.li(
              {
                class: () => "rui-mentions-option" + (active() === index ? " rui-active" : ""),
                role: "option",
                "aria-selected": () => String(active() === index),
                "on:click": () => insert(option),
                "on:mouseenter": () => active.set(index),
              },
              R.span({ class: "rui-mentions-label" }, option.label),
              option.detail !== undefined
                ? R.span({ class: "rui-mentions-detail" }, option.detail)
                : null,
            ),
        }),
      ),
    }),
  );
}

/* ---------------------------------------------------------------- Rating -- */

export interface RatingProps {
  value: State<number>;
  max?: number;
  /** Permite jumatati de stea. */
  half?: boolean;
  readonly?: boolean;
  disabled?: Accessor<boolean> | boolean;
  icon?: Child;
  label?: string;
  onChange?: (value: number) => void;
  class?: string;
}

/**
 * Rating - stele.
 *
 * E un `slider`, nu un grup de radio: valoarea e ordonata si continua, iar
 * sagetile trebuie sa o mute cu un pas. Un radiogroup ar cere Tab intre stele.
 */
export function Rating(props: RatingProps): El {
  const max = props.max ?? 5;
  const step = props.half ? 0.5 : 1;
  const hover = state<number | null>(null);

  const off = (): boolean => props.readonly === true || readOff(props.disabled);
  const shown = (): number => hover() ?? props.value();

  const set = (next: number): void => {
    if (off()) return;
    const clamped = Math.min(max, Math.max(0, Math.round(next / step) * step));
    props.value.set(clamped);
    props.onChange?.(clamped);
  };

  const fill = (index: number): number => {
    const value = shown() - index;
    return value >= 1 ? 1 : value <= 0 ? 0 : value;
  };

  return R.div(
    {
      class: () => "rui-rating" + (off() ? " rui-readonly" : "") + (props.class ? " " + props.class : ""),
      role: "slider",
      tabindex: off() ? "-1" : "0",
      "aria-valuemin": "0",
      "aria-valuemax": String(max),
      "aria-valuenow": () => String(props.value()),
      "aria-valuetext": () => props.value() + " din " + max,
      ...(props.label ? { "aria-label": props.label } : {}),
      "aria-readonly": () => String(off()),
      "on:keydown": (e: any) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault?.();
          set(props.value.peek() + step);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault?.();
          set(props.value.peek() - step);
        } else if (e.key === "Home") {
          e.preventDefault?.();
          set(0);
        } else if (e.key === "End") {
          e.preventDefault?.();
          set(max);
        }
      },
      "on:pointerleave": () => hover.set(null),
    },
    Array.from({ length: max }, (_, index) =>
      R.span(
        {
          class: "rui-rating-star",
          "aria-hidden": "true",
          "on:pointerenter": () => {
            if (!off()) hover.set(index + 1);
          },
          "on:click": () => set(index + 1),
        },
        R.span({ class: "rui-rating-bg" }, props.icon ?? "★"),
        R.span(
          { class: "rui-rating-fg", style: () => "width:" + fill(index) * 100 + "%" },
          props.icon ?? "★",
        ),
      ),
    ),
  );
}

/* ----------------------------------------------------------- ColorPicker -- */

/** `#rrggbb` -> `{r,g,b}`. Accepta si forma scurta `#rgb`. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return "#" + clamp(r) + clamp(g) + clamp(b);
}

/**
 * Luminanta relativa (WCAG 2.1). Folosita ca sa alegem text alb sau negru peste
 * o culoare - altfel eticheta devine ilizibila pe fundaluri deschise.
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Raportul de contrast dintre doua culori hex (1:1 .. 21:1). */
export function contrastRatio(a: string, b: string): number {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca.r, ca.g, ca.b);
  const lb = relativeLuminance(cb.r, cb.g, cb.b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text lizibil peste o culoare de fundal. */
export function readableOn(background: string): "#000000" | "#ffffff" {
  const rgb = hexToRgb(background);
  if (!rgb) return "#000000";
  return relativeLuminance(rgb.r, rgb.g, rgb.b) > 0.179 ? "#000000" : "#ffffff";
}

export interface ColorSwatchPickerProps {
  value: State<string>;
  /** Paleta de culori hex. */
  colors: readonly string[];
  /** Nume pentru fiecare culoare; fara ele, doar codul hex e citit. */
  names?: Readonly<Record<string, string>>;
  columns?: number;
  label?: string;
  onChange?: (color: string) => void;
  class?: string;
}

/** Paleta fixa de culori. Fiecare pastila e un radio cu nume. */
export function ColorSwatchPicker(props: ColorSwatchPickerProps): El {
  return R.div(
    {
      class: props.class ? "rui-swatches " + props.class : "rui-swatches",
      role: "radiogroup",
      ...(props.label ? { "aria-label": props.label } : {}),
      style: "grid-template-columns:repeat(" + (props.columns ?? 8) + ", auto)",
    },
    props.colors.map((color) =>
      R.button({
        type: "button",
        class: () => "rui-swatch" + (props.value() === color ? " rui-selected" : ""),
        role: "radio",
        "aria-checked": () => String(props.value() === color),
        "aria-label": props.names?.[color] ?? color,
        tabindex: () => (props.value() === color ? "0" : "-1"),
        style: "background:" + color + ";color:" + readableOn(color),
        "on:click": () => {
          props.value.set(color);
          props.onChange?.(color);
        },
      }, () => (props.value() === color ? "✓" : "")),
    ),
  );
}

export interface ColorPickerProps {
  value: State<string>;
  /** Paleta rapida afisata sub selector. */
  presets?: readonly string[];
  /** Culoarea pe care va sta textul; arata raportul de contrast. */
  contrastAgainst?: string;
  label?: string;
  placement?: Placement;
  onChange?: (color: string) => void;
  class?: string;
}

/**
 * ColorPicker - selector nativ + hex + presetari.
 *
 * Foloseste `<input type="color">`, care deschide selectorul sistemului: e
 * accesibil, localizat si gratuit. Peste el adauga un camp hex si, optional,
 * raportul de contrast fata de o culoare data - util cand alegi culori de brand
 * si vrei sa stii daca textul ramane lizibil.
 */
export function colorPicker(props: ColorPickerProps): { el: El; open: Accessor<boolean> } {
  const id = "rui-color-" + ++idSeq;
  const open = state(false);
  const text = state(props.value.peek());
  const pos = positioner({ placement: props.placement ?? "bottom-start", enabled: () => open() });

  const commit = (next: string): void => {
    const rgb = hexToRgb(next);
    if (!rgb) {
      text.set(props.value.peek());
      return;
    }
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    props.value.set(hex);
    text.set(hex);
    props.onChange?.(hex);
  };

  const ratio = derived(() =>
    props.contrastAgainst ? contrastRatio(props.value(), props.contrastAgainst) : null,
  );

  const el = R.div(
    {
      class: props.class ? "rui-colorpicker " + props.class : "rui-colorpicker",
      ref: (node: El) => {
        clickOutside(() => open.set(false), { enabled: () => open() })(node);
        pos.reference(node);
      },
    },
    R.button({
      type: "button",
      class: "rui-color-trigger",
      "aria-haspopup": "dialog",
      "aria-expanded": () => String(open()),
      "aria-label": (props.label ?? "Culoare") + ": " + props.value.peek(),
      style: () => "background:" + props.value(),
      "on:click": (e: any) => {
        e.stopPropagation?.();
        open.set(!open.peek());
      },
    }),
    Show({
      when: () => open(),
      children: R.div(
        {
          class: "rui-color-pop",
          role: "dialog",
          "aria-label": props.label ?? "Alege culoarea",
          ref: pos.floating,
          style: () => pos.style(),
        },
        R.input({
          id,
          type: "color",
          class: "rui-color-native",
          "aria-label": "Selector de culoare",
          value: () => props.value(),
          "on:input": (e: any) => commit(String(e.target?.value ?? "")),
        }),
        R.input({
          type: "text",
          class: "rui-color-hex rui-tabular",
          "aria-label": "Cod hexazecimal",
          value: () => text(),
          "on:input": (e: any) => text.set(String(e.target?.value ?? "")),
          "on:blur": () => commit(text.peek()),
          "on:keydown": (e: any) => {
            if (e.key === "Enter") {
              e.preventDefault?.();
              commit(text.peek());
            }
          },
        }),
        Show({
          when: () => ratio() !== null,
          children: R.div(
            { class: () => "rui-color-contrast" + ((ratio() ?? 0) >= 4.5 ? " rui-ok" : " rui-low") },
            () => "Contrast " + (ratio() ?? 0).toFixed(2) + ":1 " + ((ratio() ?? 0) >= 4.5 ? "✓" : "✕"),
          ),
        }),
        props.presets
          ? ColorSwatchPicker({
              value: props.value,
              colors: props.presets,
              columns: 8,
              label: "Culori predefinite",
              onChange: (c) => {
                text.set(c);
                props.onChange?.(c);
              },
            })
          : null,
      ),
    }),
  );

  return { el, open: () => open() };
}

export function ColorPicker(props: ColorPickerProps): El {
  return colorPicker(props).el;
}

/* ---------------------------------------------------------- TransferList -- */

export interface TransferItem {
  key: string;
  label: Child;
  disabled?: boolean;
}

export interface TransferListProps {
  items: readonly TransferItem[];
  /** Cheile din lista din dreapta. */
  selected: State<readonly string[]>;
  titles?: readonly [Child, Child];
  onChange?: (selected: readonly string[]) => void;
  label?: string;
  class?: string;
}

/**
 * TransferList - mutare intre doua liste.
 *
 * Fiecare panou e un `listbox` multiplu. Butoanele de mutare sunt dezactivate
 * cand nu e nimic bifat - altfel utilizatorul apasa si nu se intampla nimic.
 */
export function TransferList(props: TransferListProps): El {
  const marked = state<ReadonlySet<string>>(new Set());

  const right = derived(() => new Set(props.selected()));
  const left = derived(() => props.items.filter((i) => !right().has(i.key)));
  const rightItems = derived(() => props.items.filter((i) => right().has(i.key)));

  const toggleMark = (key: string): void => {
    marked.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const move = (toRight: boolean): void => {
    const picked = marked.peek();
    const source = toRight ? left() : rightItems();
    const keys = source.filter((i) => picked.has(i.key) && !i.disabled).map((i) => i.key);
    if (keys.length === 0) return;

    const next = toRight
      ? [...props.selected.peek(), ...keys]
      : props.selected.peek().filter((k) => !keys.includes(k));
    props.selected.set(next);
    props.onChange?.(next);
    marked.set(new Set());
  };

  const canMove = (toRight: boolean): boolean => {
    const picked = marked();
    const source = toRight ? left() : rightItems();
    return source.some((i) => picked.has(i.key) && !i.disabled);
  };

  const panel = (items: Accessor<readonly TransferItem[]>, title: Child): El =>
    R.div(
      { class: "rui-transfer-panel" },
      R.div({ class: "rui-transfer-title" }, title),
      R.ul(
        { class: "rui-transfer-list", role: "listbox", "aria-multiselectable": "true" },
        For({
          each: items,
          children: (item: TransferItem) =>
            R.li(
              {
                class: () =>
                  "rui-transfer-item" +
                  (marked().has(item.key) ? " rui-marked" : "") +
                  (item.disabled ? " rui-disabled" : ""),
                role: "option",
                "aria-selected": () => String(marked().has(item.key)),
                ...(item.disabled ? { "aria-disabled": "true" } : {}),
                tabindex: "0",
                "on:click": () => {
                  if (!item.disabled) toggleMark(item.key);
                },
                "on:keydown": (e: any) => {
                  if ((e.key === " " || e.key === "Enter") && !item.disabled) {
                    e.preventDefault?.();
                    toggleMark(item.key);
                  }
                },
              },
              item.label,
            ),
        }),
      ),
    );

  return R.div(
    {
      class: props.class ? "rui-transfer " + props.class : "rui-transfer",
      role: "group",
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    panel(() => left(), props.titles?.[0] ?? "Disponibile"),
    R.div(
      { class: "rui-transfer-actions" },
      Button({
        variant: "secondary",
        size: "sm",
        label: "Mută la dreapta",
        disabled: () => !canMove(true),
        onClick: () => move(true),
        children: "›",
      }),
      Button({
        variant: "secondary",
        size: "sm",
        label: "Mută la stânga",
        disabled: () => !canMove(false),
        onClick: () => move(false),
        children: "‹",
      }),
    ),
    panel(() => rightItems(), props.titles?.[1] ?? "Selectate"),
  );
}

/* ------------------------------------------------- TreeSelect / Cascader -- */

export interface OptionNode {
  value: string;
  label: string;
  children?: readonly OptionNode[];
  disabled?: boolean;
}

/** Cauta calea catre o valoare in arborele de optiuni. */
export function findPath(nodes: readonly OptionNode[], value: string): OptionNode[] | null {
  for (const node of nodes) {
    if (node.value === value) return [node];
    if (node.children) {
      const sub = findPath(node.children, value);
      if (sub) return [node, ...sub];
    }
  }
  return null;
}

export interface CascaderProps {
  options: readonly OptionNode[];
  value: State<string | null>;
  /** Permite alegerea unui nod intermediar, nu doar a frunzelor. */
  anyLevel?: boolean;
  placeholder?: Child;
  separator?: string;
  placement?: Placement;
  onChange?: (value: string, path: readonly OptionNode[]) => void;
  label?: string;
  class?: string;
}

/**
 * Cascader - alegere in cascada, coloana dupa coloana.
 *
 * Implicit doar frunzele sunt alegibile: un "Romania > Cluj" incomplet e rareori
 * ce vrea utilizatorul. `anyLevel: true` schimba asta.
 */
export function Cascader(props: CascaderProps): El {
  const id = "rui-casc-" + ++idSeq;
  const open = state(false);
  /** Calea deschisa in acest moment (nu neaparat si aleasa). */
  const path = state<readonly OptionNode[]>([]);
  const pos = positioner({ placement: props.placement ?? "bottom-start", enabled: () => open() });
  const sep = props.separator ?? " / ";

  const label = derived(() => {
    const value = props.value();
    if (value === null) return null;
    const found = findPath(props.options, value);
    return found ? found.map((n) => n.label).join(sep) : value;
  });

  /** Coloanele afisate: radacina, apoi copiii fiecarui nod din cale. */
  const columns = derived<Array<readonly OptionNode[]>>(() => {
    const out: Array<readonly OptionNode[]> = [props.options];
    for (const node of path()) {
      if (node.children && node.children.length > 0) out.push(node.children);
    }
    return out;
  });

  const choose = (node: OptionNode, depth: number): void => {
    if (node.disabled) return;
    const next = [...path().slice(0, depth), node];
    path.set(next);

    const isLeaf = !node.children || node.children.length === 0;
    if (isLeaf || props.anyLevel) {
      props.value.set(node.value);
      props.onChange?.(node.value, next);
      if (isLeaf) open.set(false);
    }
  };

  return R.div(
    {
      class: props.class ? "rui-cascader " + props.class : "rui-cascader",
      ref: (node: El) => {
        clickOutside(() => open.set(false), { enabled: () => open() })(node);
        pos.reference(node);
      },
    },
    R.button({
      id,
      type: "button",
      class: "rui-cascader-trigger",
      "aria-haspopup": "true",
      "aria-expanded": () => String(open()),
      ...(props.label ? { "aria-label": props.label } : {}),
      "on:click": (e: any) => {
        e.stopPropagation?.();
        if (!open.peek()) {
          const value = props.value.peek();
          path.set(value ? (findPath(props.options, value) ?? []) : []);
        }
        open.set(!open.peek());
      },
    },
    R.span({ class: () => (label() === null ? "rui-cascader-placeholder" : "rui-cascader-value") },
      () => label() ?? props.placeholder ?? "Alege…"),
    R.span({ class: "rui-cascader-arrow", "aria-hidden": "true" }, "▾")),
    Show({
      when: () => open(),
      children: R.div(
        {
          class: "rui-cascader-pop",
          ref: pos.floating,
          style: () => pos.style(),
        },
        For({
          each: () => columns().map((_, i) => i),
          children: (depth: number) =>
            R.ul(
              { class: "rui-cascader-col", role: "listbox" },
              For({
                each: () => columns()[depth] ?? [],
                children: (node: OptionNode) => {
                  const chosen = (): boolean => path()[depth]?.value === node.value;
                  const hasKids = (node.children?.length ?? 0) > 0;
                  return R.li(
                    {
                      class: () =>
                        "rui-cascader-item" +
                        (chosen() ? " rui-active" : "") +
                        (props.value() === node.value ? " rui-selected" : "") +
                        (node.disabled ? " rui-disabled" : ""),
                      role: "option",
                      "aria-selected": () => String(props.value() === node.value),
                      ...(node.disabled ? { "aria-disabled": "true" } : {}),
                      ...(hasKids ? { "aria-haspopup": "true", "aria-expanded": () => String(chosen()) } : {}),
                      "on:click": (e: any) => {
                        e.stopPropagation?.();
                        choose(node, depth);
                      },
                    },
                    R.span({ class: "rui-cascader-label" }, node.label),
                    hasKids ? R.span({ class: "rui-cascader-more", "aria-hidden": "true" }, "›") : null,
                  );
                },
              }),
            ),
        }),
      ),
    }),
  );
}

export interface TreeSelectProps {
  options: readonly OptionNode[];
  value: State<string | null>;
  placeholder?: Child;
  placement?: Placement;
  onChange?: (value: string) => void;
  label?: string;
  class?: string;
}

/** TreeSelect - aceleasi date ca `Cascader`, dar afisate ca arbore vertical. */
export function TreeSelect(props: TreeSelectProps): El {
  const open = state(false);
  const expanded = state<ReadonlySet<string>>(new Set());
  const pos = positioner({ placement: props.placement ?? "bottom-start", enabled: () => open() });

  const label = derived(() => {
    const value = props.value();
    if (value === null) return null;
    const found = findPath(props.options, value);
    return found ? found[found.length - 1]!.label : value;
  });

  const toggle = (value: string): void => {
    expanded.update((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const renderNode = (node: OptionNode, depth: number): El => {
    const hasKids = (node.children?.length ?? 0) > 0;
    return R.li(
      {
        class: "rui-treeselect-item",
        role: "treeitem",
        ...(hasKids ? { "aria-expanded": () => String(expanded().has(node.value)) } : {}),
        "aria-selected": () => String(props.value() === node.value),
      },
      R.div(
        {
          class: () =>
            "rui-treeselect-row" +
            (props.value() === node.value ? " rui-selected" : "") +
            (node.disabled ? " rui-disabled" : ""),
          style: "padding-left:" + (8 + depth * 16) + "px",
          "on:click": () => {
            if (node.disabled) return;
            props.value.set(node.value);
            props.onChange?.(node.value);
            open.set(false);
          },
        },
        hasKids
          ? R.span(
              {
                class: "rui-treeselect-toggle",
                "aria-hidden": "true",
                "on:click": (e: any) => {
                  e.stopPropagation?.();
                  toggle(node.value);
                },
              },
              () => (expanded().has(node.value) ? "▾" : "▸"),
            )
          : R.span({ class: "rui-treeselect-toggle" }),
        node.label,
      ),
      hasKids
        ? Show({
            when: () => expanded().has(node.value),
            children: R.ul(
              { class: "rui-treeselect-group", role: "group" },
              () => (node.children ?? []).map((child) => renderNode(child, depth + 1)),
            ),
          })
        : null,
    );
  };

  return R.div(
    {
      class: props.class ? "rui-treeselect " + props.class : "rui-treeselect",
      ref: (node: El) => {
        clickOutside(() => open.set(false), { enabled: () => open() })(node);
        pos.reference(node);
      },
    },
    R.button({
      type: "button",
      class: "rui-treeselect-trigger",
      "aria-haspopup": "tree",
      "aria-expanded": () => String(open()),
      ...(props.label ? { "aria-label": props.label } : {}),
      "on:click": (e: any) => {
        e.stopPropagation?.();
        open.set(!open.peek());
      },
    },
    R.span({}, () => label() ?? props.placeholder ?? "Alege…"),
    R.span({ class: "rui-treeselect-arrow", "aria-hidden": "true" }, "▾")),
    Show({
      when: () => open(),
      children: R.ul(
        {
          class: "rui-treeselect-pop",
          role: "tree",
          ref: pos.floating,
          style: () => pos.style(),
        },
        () => props.options.map((node) => renderNode(node, 0)),
      ),
    }),
  );
}
