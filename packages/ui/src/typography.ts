/**
 * Typography - text cu scara consistenta.
 *
 * `Heading` separa NIVELUL semantic de MARIMEA vizuala: `level` alege tagul
 * (`h1`..`h6`), `size` alege cum arata. Fara separarea asta, oamenii sar de la
 * `h2` la `h4` doar ca sa obtina un text mai mic, si structura documentului
 * devine de necitit pentru un screen reader.
 */
import { R, For, type Child } from "@raptor/dom";
import { type Accessor } from "@raptor/core";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type TextSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
export type TextTone = "default" | "muted" | "accent" | "success" | "warning" | "danger";
export type TextWeight = "normal" | "medium" | "semibold" | "bold";

export interface TextProps {
  children?: Child;
  as?: string;
  size?: TextSize;
  tone?: TextTone;
  weight?: TextWeight;
  align?: "left" | "center" | "right";
  /** Cifre de latime egala - obligatoriu pentru numere care se schimba. */
  tabular?: boolean;
  /** Taie la N randuri cu elipsa. */
  clamp?: number;
  class?: string;
  /** Atribute puse direct pe element. Explicit, nu index signature: altfel
   *  `Omit<TextProps, "as">` ar sterge toti membrii declarati. */
  attrs?: Record<string, unknown>;
}

function textClass(props: TextProps, base: string): string {
  let cls = base;
  if (props.size) cls += " rui-t-" + props.size;
  if (props.tone && props.tone !== "default") cls += " rui-tone-" + props.tone;
  if (props.weight) cls += " rui-w-" + props.weight;
  if (props.align) cls += " rui-align-" + props.align;
  if (props.tabular) cls += " rui-tabular";
  if (props.clamp) cls += " rui-clamp";
  if (props.class) cls += " " + props.class;
  return cls;
}

export function Text(props: TextProps): El {
  return R[props.as ?? "span"]!(
    {
      ...(props.attrs ?? {}),
      class: textClass(props, "rui-text"),
      ...(props.clamp ? { style: "-webkit-line-clamp:" + props.clamp } : {}),
    },
    props.children ?? null,
  );
}

export interface HeadingProps extends Omit<TextProps, "as"> {
  /** Nivelul SEMANTIC (h1..h6). Alege-l după structura documentului. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function Heading(props: HeadingProps): El {
  const level = props.level ?? 2;
  // Marimea implicita urmeaza nivelul, dar poate fi suprascrisa independent.
  const size: TextSize = props.size ?? (["3xl", "2xl", "xl", "lg", "md", "md"] as const)[level - 1]!;
  return R["h" + level]!(
    {
      ...(props.attrs ?? {}),
      class: textClass({ ...props, size }, "rui-heading"),
    },
    props.children ?? null,
  );
}

export interface LinkProps {
  children: Child;
  href?: string;
  /** Navigare in aplicatie; primeste `href` si evenimentul. */
  onNavigate?: (href: string, event: any) => void;
  external?: boolean;
  tone?: TextTone;
  class?: string;
  attrs?: Record<string, unknown>;
}

export function Link(props: LinkProps): El {
  return R.a(
    {
      ...(props.attrs ?? {}),
      class: "rui-link" + (props.tone ? " rui-tone-" + props.tone : "") + (props.class ? " " + props.class : ""),
      ...(props.href ? { href: props.href } : {}),
      // Fara `href`, o ancora nu e focusabila si nu e anuntata ca link.
      ...(props.href ? {} : { role: "link", tabindex: "0" }),
      ...(props.external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {}),
      ...(props.onNavigate && props.href
        ? {
            "on:click": (e: any) => {
              // Lasam browserul sa faca ce stie pentru click-mijloc / Ctrl+click.
              if (e.metaKey || e.ctrlKey || e.shiftKey || (e.button != null && e.button !== 0)) return;
              e.preventDefault?.();
              props.onNavigate!(props.href!, e);
            },
          }
        : {}),
    },
    props.children,
    props.external
      ? R.span({ class: "rui-link-external", "aria-label": " (se deschide în filă nouă)" }, " ↗")
      : null,
  );
}

export interface CodeProps {
  children: Child;
  class?: string;
}

export function Code(props: CodeProps): El {
  return R.code({ class: props.class ? "rui-code " + props.class : "rui-code" }, props.children);
}

export interface CodeBlockProps {
  code: Accessor<string> | string;
  /** Eticheta afisata in bara de sus (nume de fisier, limbaj). */
  file?: string;
  /** Tokenizer extern; primeste codul si intoarce noduri. */
  highlight?: (code: string) => Child;
  /** Arata butonul de copiere. Implicit `true`. */
  copyable?: boolean;
  onCopy?: (code: string) => void;
  class?: string;
}

export function CodeBlock(props: CodeBlockProps): El {
  const read = (): string => (typeof props.code === "function" ? props.code() : props.code);

  return R.div(
    { class: props.class ? "rui-codeblock " + props.class : "rui-codeblock" },
    props.file !== undefined || props.copyable !== false
      ? R.div(
          { class: "rui-codeblock-head" },
          props.file !== undefined ? R.span({ class: "rui-codeblock-file" }, props.file) : null,
          props.copyable === false
            ? null
            : R.button(
                {
                  type: "button",
                  class: "rui-codeblock-copy",
                  "aria-label": "Copiază codul",
                  "on:click": () => props.onCopy?.(read()),
                },
                "copiază",
              ),
        )
      : null,
    R.pre(
      { class: "rui-codeblock-pre" },
      R.code({}, props.highlight ? () => props.highlight!(read()) : () => read()),
    ),
  );
}

export interface KbdProps {
  children: Child;
  class?: string;
}

export function Kbd(props: KbdProps): El {
  return R.kbd({ class: props.class ? "rui-kbd " + props.class : "rui-kbd" }, props.children);
}

export interface TextListProps {
  items: readonly Child[] | Accessor<readonly Child[]>;
  /** `ul` (implicit) sau `ol`. */
  ordered?: boolean;
  /** Fara bulinele/numerele implicite. */
  unstyled?: boolean;
  class?: string;
}

export function TextList(props: TextListProps): El {
  const items = typeof props.items === "function" ? props.items : () => props.items as readonly Child[];
  return R[props.ordered ? "ol" : "ul"]!(
    {
      class:
        "rui-list" + (props.unstyled ? " rui-list-unstyled" : "") + (props.class ? " " + props.class : ""),
    },
    For({ each: items, children: (item: Child) => R.li({ class: "rui-list-item" }, item) }),
  );
}

export interface TruncateProps {
  children: Child;
  /** Numarul de randuri pastrate. Implicit 1. */
  lines?: number;
  /** Pune textul complet in `title`, pentru hover. */
  title?: string;
  class?: string;
}

export function Truncate(props: TruncateProps): El {
  const lines = props.lines ?? 1;
  return R.span(
    {
      class: (lines === 1 ? "rui-truncate" : "rui-clamp") + (props.class ? " " + props.class : ""),
      ...(lines > 1 ? { style: "-webkit-line-clamp:" + lines } : {}),
      ...(props.title ? { title: props.title } : {}),
    },
    props.children,
  );
}

export interface BlockquoteProps {
  children: Child;
  cite?: Child;
  class?: string;
}

export function Blockquote(props: BlockquoteProps): El {
  return R.figure(
    { class: props.class ? "rui-quote " + props.class : "rui-quote" },
    R.blockquote({ class: "rui-quote-body" }, props.children),
    props.cite !== undefined ? R.figcaption({ class: "rui-quote-cite" }, props.cite) : null,
  );
}

export interface MarkProps {
  /** Textul in care se cauta. */
  text: Accessor<string> | string;
  /** Ce se evidentiaza. Gol => text simplu. */
  query: Accessor<string> | string;
  class?: string;
}

/**
 * Mark - evidentiaza potrivirile dintr-un text (rezultate de cautare).
 *
 * Cautarea e case-insensitive dar pastreaza textul original: evidentierea nu
 * trebuie sa schimbe ce citeste utilizatorul.
 */
export function Mark(props: MarkProps): El {
  const text = (): string => (typeof props.text === "function" ? props.text() : props.text);
  const query = (): string => (typeof props.query === "function" ? props.query() : props.query);

  return R.span({ class: props.class ? "rui-mark-host " + props.class : "rui-mark-host" }, () => {
    const source = text();
    const needle = query();
    if (needle === "") return source;

    const out: Child[] = [];
    const lowerSource = source.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lowerSource.indexOf(lowerNeedle, from);
      if (at === -1) break;
      if (at > from) out.push(source.slice(from, at));
      out.push(R.mark({ class: "rui-mark" }, source.slice(at, at + needle.length)));
      from = at + needle.length;
    }
    if (from < source.length) out.push(source.slice(from));
    return out;
  });
}
