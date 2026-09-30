/**
 * Typography - text with a consistent scale.
 *
 * `Heading` separates the semantic LEVEL from the visual SIZE: `level` picks the
 * tag (`h1`..`h6`), `size` picks how it looks. Without this separation, people
 * jump from `h2` to `h4` just to get smaller text, and the document structure
 * becomes unreadable for a screen reader.
 */
import { R, For, type Child } from "raptorjs/dom";
import { type Accessor } from "raptorjs";
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
  /** Equal-width digits - mandatory for numbers that change. */
  tabular?: boolean;
  /** Clamps to N lines with an ellipsis. */
  clamp?: number;
  class?: string;
  /** Attributes set directly on the element. Explicit, not an index signature:
   *  otherwise `Omit<TextProps, "as">` would drop all the declared members. */
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
  /** The SEMANTIC level (h1..h6). Choose it by the document structure. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function Heading(props: HeadingProps): El {
  const level = props.level ?? 2;
  // The default size follows the level, but can be overridden independently.
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
  /** In-app navigation; receives `href` and the event. */
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
      // Without `href`, an anchor isn't focusable and isn't announced as a link.
      ...(props.href ? {} : { role: "link", tabindex: "0" }),
      ...(props.external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {}),
      ...(props.onNavigate && props.href
        ? {
            "on:click": (e: any) => {
              // We let the browser do its thing for middle-click / Ctrl+click.
              if (e.metaKey || e.ctrlKey || e.shiftKey || (e.button != null && e.button !== 0)) return;
              e.preventDefault?.();
              props.onNavigate!(props.href!, e);
            },
          }
        : {}),
    },
    props.children,
    props.external
      ? R.span({ class: "rui-link-external", "aria-label": " (opens in a new tab)" }, " ↗")
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
  /** Label shown in the top bar (file name, language). */
  file?: string;
  /** External tokenizer; receives the code and returns nodes. */
  highlight?: (code: string) => Child;
  /** Shows the copy button. Defaults to `true`. */
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
                  "aria-label": "Copy code",
                  "on:click": () => props.onCopy?.(read()),
                },
                "copy",
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
  /** `ul` (default) or `ol`. */
  ordered?: boolean;
  /** Without the default bullets/numbers. */
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
  /** The number of lines kept. Defaults to 1. */
  lines?: number;
  /** Puts the full text in `title`, for hover. */
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
  /** The text to search in. */
  text: Accessor<string> | string;
  /** What gets highlighted. Empty => plain text. */
  query: Accessor<string> | string;
  class?: string;
}

/**
 * Mark - highlights the matches within a text (search results).
 *
 * The search is case-insensitive but keeps the original text: highlighting must
 * not change what the user reads.
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
