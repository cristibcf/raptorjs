/**
 * Display - content components: cards, badges, avatars, states.
 *
 * Most are pure, stateless functions. Their value is in the accessibility
 * details they solve once and for all: a `Badge` with a number must have a
 * readable name ("3 unread notifications"), not just the digit; an `Avatar`
 * with initials is decorative and must not be read twice; a `Skeleton` must be
 * `aria-hidden` so it doesn't announce noise.
 */
import { derived, type Accessor } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/* ------------------------------------------------------------------ Card -- */

export interface CardProps {
  children?: Child;
  header?: Child;
  footer?: Child;
  /** Simple title; ignored if you pass `header`. */
  title?: Child;
  /** Interactive card: gets a button role and responds to Enter/Space. */
  onClick?: () => void;
  /** Required label when the card is interactive without clear text. */
  label?: string;
  padded?: boolean;
  class?: string;
}

export function Card(props: CardProps): El {
  const interactive = typeof props.onClick === "function";

  return R.div(
    {
      class:
        "rui-card" +
        (interactive ? " rui-card-interactive" : "") +
        (props.padded === false ? "" : " rui-card-padded") +
        (props.class ? " " + props.class : ""),
      ...(interactive
        ? {
            role: "button",
            tabindex: "0",
            ...(props.label ? { "aria-label": props.label } : {}),
            "on:click": () => props.onClick!(),
            // A `div` with `role=button` does NOT respond to the keyboard on its own.
            "on:keydown": (e: any) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault?.();
                props.onClick!();
              }
            },
          }
        : {}),
    },
    props.header !== undefined
      ? R.div({ class: "rui-card-head" }, props.header)
      : props.title !== undefined
        ? R.div({ class: "rui-card-head" }, R.h3({ class: "rui-card-title" }, props.title))
        : null,
    props.children !== undefined ? R.div({ class: "rui-card-body" }, props.children) : null,
    props.footer !== undefined ? R.div({ class: "rui-card-foot" }, props.footer) : null,
  );
}

/* ----------------------------------------------------------------- Badge -- */

export interface BadgeProps {
  children?: Child;
  /** Number; above `max` it shows "99+". */
  count?: Accessor<number> | number;
  max?: number;
  /** Just a dot, no content. */
  dot?: boolean;
  tone?: Tone;
  /** Hide when the number is 0. Default `true`. */
  hideZero?: boolean;
  /** Readable name; without it, a badge showing "3" says nothing. */
  label?: string;
  class?: string;
}

export function Badge(props: BadgeProps): El {
  const max = props.max ?? 99;
  const count = (): number | null => {
    if (props.count === undefined) return null;
    return typeof props.count === "function" ? props.count() : props.count;
  };

  const text = derived<string>(() => {
    const n = count();
    if (n === null) return "";
    return n > max ? max + "+" : String(n);
  });

  const visible = (): boolean => {
    const n = count();
    if (n === null) return true;
    return !(n === 0 && props.hideZero !== false);
  };

  return R.span(
    {
      class: () =>
        "rui-badge rui-tone-" +
        (props.tone ?? "neutral") +
        (props.dot ? " rui-badge-dot" : "") +
        (visible() ? "" : " rui-hidden") +
        (props.class ? " " + props.class : ""),
      ...(props.label ? { "aria-label": props.label, role: "status" } : {}),
      // The dot has no content: without a label it is purely decorative.
      ...(props.dot && !props.label ? { "aria-hidden": "true" } : {}),
    },
    props.dot ? null : props.count !== undefined ? () => text() : (props.children ?? null),
  );
}

/* ------------------------------------------------------------------- Tag -- */

export interface TagProps {
  children: Child;
  tone?: Tone;
  /** Shows ✕ and calls `onRemove`. */
  onRemove?: () => void;
  /** Name for the remove button (e.g. the tag's name). */
  removeLabel?: string;
  size?: "sm" | "md";
  class?: string;
}

export function Tag(props: TagProps): El {
  return R.span(
    {
      class:
        "rui-tag rui-tone-" +
        (props.tone ?? "neutral") +
        " rui-tag-" +
        (props.size ?? "md") +
        (props.class ? " " + props.class : ""),
    },
    R.span({ class: "rui-tag-label" }, props.children),
    props.onRemove
      ? R.button(
          {
            type: "button",
            class: "rui-tag-remove",
            "aria-label": props.removeLabel ?? "Remove",
            "on:click": (e: any) => {
              e.stopPropagation?.();
              props.onRemove!();
            },
          },
          "✕",
        )
      : null,
  );
}

/* ---------------------------------------------------------------- Avatar -- */

export interface AvatarProps {
  /** Image URL. Missing or error => initials. */
  src?: Accessor<string | null> | string;
  /** The person's name; the initials are derived from it. */
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Shape. Default circle. */
  square?: boolean;
  class?: string;
}

/** The initials: first and last word, at most two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export function Avatar(props: AvatarProps): El {
  const src = (): string | null => {
    if (props.src === undefined) return null;
    return typeof props.src === "function" ? props.src() : props.src;
  };

  const cls =
    "rui-avatar rui-avatar-" +
    (props.size ?? "md") +
    (props.square ? " rui-avatar-square" : "") +
    (props.class ? " " + props.class : "");

  return R.span(
    {
      class: cls,
      // The name is on the container, once: the image and initials below are
      // decorative, otherwise the screen reader would read it twice.
      ...(props.name ? { role: "img", "aria-label": props.name } : { "aria-hidden": "true" }),
    },
    Show({
      when: () => src() !== null,
      children: R.img({ class: "rui-avatar-img", alt: "", src: () => src() ?? "" }),
      fallback: R.span({ class: "rui-avatar-initials", "aria-hidden": "true" }, initials(props.name ?? "")),
    }),
  );
}

export interface AvatarGroupProps {
  people: readonly { name?: string; src?: string }[];
  /** How many are shown before "+N". Default 4. */
  max?: number;
  size?: AvatarProps["size"];
  class?: string;
}

export function AvatarGroup(props: AvatarGroupProps): El {
  const max = props.max ?? 4;
  const shown = props.people.slice(0, max);
  const rest = props.people.length - shown.length;

  return R.span(
    { class: props.class ? "rui-avatar-group " + props.class : "rui-avatar-group", role: "group" },
    shown.map((p) => Avatar({ name: p.name, src: p.src, size: props.size })),
    rest > 0
      ? R.span(
          {
            class: "rui-avatar rui-avatar-" + (props.size ?? "md") + " rui-avatar-more",
            role: "img",
            "aria-label": "and " + rest + " more",
          },
          "+" + rest,
        )
      : null,
  );
}

/* ------------------------------------------------------------------ Stat -- */

export interface StatProps {
  label: Child;
  value: Accessor<Child> | Child;
  /** Change from the previous period, in percent. */
  delta?: Accessor<number> | number;
  /** For most metrics growth is good; for "churn" it isn't. */
  invertDelta?: boolean;
  hint?: Child;
  class?: string;
}

export function Stat(props: StatProps): El {
  const value = (): Child => (typeof props.value === "function" ? (props.value as Accessor<Child>)() : props.value);
  const delta = (): number | null => {
    if (props.delta === undefined) return null;
    return typeof props.delta === "function" ? props.delta() : props.delta;
  };

  const tone = (): string => {
    const d = delta();
    if (d === null || d === 0) return "neutral";
    const good = props.invertDelta ? d < 0 : d > 0;
    return good ? "success" : "danger";
  };

  return R.div(
    { class: props.class ? "rui-stat " + props.class : "rui-stat" },
    R.div({ class: "rui-stat-label" }, props.label),
    R.div({ class: "rui-stat-value rui-tabular" }, () => value()),
    Show({
      when: () => delta() !== null,
      children: R.div(
        { class: () => "rui-stat-delta rui-tone-" + tone() },
        R.span({ "aria-hidden": "true" }, () => ((delta() ?? 0) >= 0 ? "▲ " : "▼ ")),
        () => Math.abs(delta() ?? 0).toFixed(1) + "%",
      ),
    }),
    props.hint !== undefined ? R.div({ class: "rui-stat-hint" }, props.hint) : null,
  );
}

/* -------------------------------------------------------- DescriptionList */

export interface DescriptionItem {
  term: Child;
  description: Child;
}

export interface DescriptionListProps {
  items: readonly DescriptionItem[] | Accessor<readonly DescriptionItem[]>;
  /** Terms on the same line as the description. */
  inline?: boolean;
  class?: string;
}

export function DescriptionList(props: DescriptionListProps): El {
  const items = typeof props.items === "function" ? props.items : () => props.items as readonly DescriptionItem[];
  return R.dl(
    { class: "rui-dl" + (props.inline ? " rui-dl-inline" : "") + (props.class ? " " + props.class : "") },
    For({
      each: items,
      children: (item: DescriptionItem) => [
        R.dt({ class: "rui-dt" }, item.term),
        R.dd({ class: "rui-dd" }, item.description),
      ],
    }),
  );
}

/* -------------------------------------------------------- states & notes -- */

export interface AlertProps {
  children: Child;
  title?: Child;
  tone?: Tone;
  /** Close button. */
  onDismiss?: () => void;
  class?: string;
}

const TONE_ICON: Record<Tone, string> = {
  neutral: "•", accent: "•", info: "ℹ", success: "✓", warning: "⚠", danger: "✕",
};

export function Alert(props: AlertProps): El {
  const tone = props.tone ?? "info";
  return R.div(
    {
      class: "rui-alert rui-tone-" + tone + (props.class ? " " + props.class : ""),
      // `alert` interrupts the reader; we use it only for errors.
      role: tone === "danger" ? "alert" : "status",
    },
    R.span({ class: "rui-alert-icon", "aria-hidden": "true" }, TONE_ICON[tone]),
    R.div(
      { class: "rui-alert-body" },
      props.title !== undefined ? R.div({ class: "rui-alert-title" }, props.title) : null,
      R.div({ class: "rui-alert-message" }, props.children),
    ),
    props.onDismiss
      ? R.button(
          { type: "button", class: "rui-alert-close", "aria-label": "Close", "on:click": props.onDismiss },
          "✕",
        )
      : null,
  );
}

export interface CalloutProps extends Omit<AlertProps, "onDismiss"> {}

/** A note highlighted inline. Like `Alert`, but without an announcement role. */
export function Callout(props: CalloutProps): El {
  const tone = props.tone ?? "info";
  return R.div(
    { class: "rui-callout rui-tone-" + tone + (props.class ? " " + props.class : "") },
    R.span({ class: "rui-callout-icon", "aria-hidden": "true" }, TONE_ICON[tone]),
    R.div(
      { class: "rui-callout-body" },
      props.title !== undefined ? R.div({ class: "rui-callout-title" }, props.title) : null,
      props.children,
    ),
  );
}

export interface BannerProps {
  children: Child;
  tone?: Tone;
  action?: Child;
  onDismiss?: () => void;
  class?: string;
}

export function Banner(props: BannerProps): El {
  return R.div(
    {
      class: "rui-banner rui-tone-" + (props.tone ?? "accent") + (props.class ? " " + props.class : ""),
      role: "region",
      "aria-label": "Announcement",
    },
    R.div({ class: "rui-banner-body" }, props.children),
    props.action ?? null,
    props.onDismiss
      ? R.button(
          { type: "button", class: "rui-banner-close", "aria-label": "Close announcement", "on:click": props.onDismiss },
          "✕",
        )
      : null,
  );
}

export interface EmptyStateProps {
  title: Child;
  description?: Child;
  icon?: Child;
  action?: Child;
  class?: string;
}

export function EmptyState(props: EmptyStateProps): El {
  return R.div(
    { class: props.class ? "rui-empty-state " + props.class : "rui-empty-state" },
    props.icon !== undefined ? R.div({ class: "rui-empty-icon", "aria-hidden": "true" }, props.icon) : null,
    R.div({ class: "rui-empty-title" }, props.title),
    props.description !== undefined ? R.div({ class: "rui-empty-desc" }, props.description) : null,
    props.action !== undefined ? R.div({ class: "rui-empty-action" }, props.action) : null,
  );
}

export interface ResultProps {
  status: "success" | "error" | "warning" | "info" | "404" | "403" | "500";
  title: Child;
  description?: Child;
  action?: Child;
  class?: string;
}

const RESULT_ICON: Record<ResultProps["status"], string> = {
  success: "✓", error: "✕", warning: "⚠", info: "ℹ", "404": "?", "403": "⊘", "500": "!",
};

export function Result(props: ResultProps): El {
  return R.div(
    {
      class: "rui-result rui-result-" + props.status + (props.class ? " " + props.class : ""),
      role: props.status === "error" || props.status === "500" ? "alert" : "status",
    },
    R.div({ class: "rui-result-icon", "aria-hidden": "true" }, RESULT_ICON[props.status]),
    R.h2({ class: "rui-result-title" }, props.title),
    props.description !== undefined ? R.p({ class: "rui-result-desc" }, props.description) : null,
    props.action !== undefined ? R.div({ class: "rui-result-action" }, props.action) : null,
  );
}

/* ------------------------------------------------------------- loading --- */

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  /** Text read by the screen reader. Default "Loading". */
  label?: string;
  class?: string;
}

export function Spinner(props: SpinnerProps): El {
  return R.span(
    { class: "rui-spinner rui-spinner-" + (props.size ?? "md") + (props.class ? " " + props.class : ""), role: "status" },
    R.span({ class: "rui-spinner-circle", "aria-hidden": "true" }),
    R.span({ class: "rui-sr-only" }, props.label ?? "Loading"),
  );
}

export interface SkeletonProps {
  /** `text`, `circle` or `rect`. */
  variant?: "text" | "circle" | "rect";
  width?: string;
  height?: string;
  /** Number of rows for the `text` variant. */
  lines?: number;
  class?: string;
}

export function Skeleton(props: SkeletonProps): El {
  const variant = props.variant ?? "text";
  const style = [
    props.width ? "width:" + props.width : null,
    props.height ? "height:" + props.height : null,
  ]
    .filter(Boolean)
    .join(";");

  // `aria-hidden`: a placeholder has nothing to announce. The loading state is
  // conveyed from the container with `aria-busy`, not from each gray rectangle.
  const one = (extra?: string): El =>
    R.span({
      class: "rui-skeleton rui-skeleton-" + variant + (props.class ? " " + props.class : ""),
      "aria-hidden": "true",
      style: extra ? style + ";" + extra : style,
    });

  if (variant === "text" && (props.lines ?? 1) > 1) {
    const lines = props.lines!;
    const out: El[] = [];
    for (let i = 0; i < lines; i++) {
      // The last row shorter, like a real paragraph.
      out.push(one(i === lines - 1 ? "width:60%" : undefined));
    }
    return R.span({ class: "rui-skeleton-lines", "aria-hidden": "true" }, out);
  }
  return one();
}

export interface LoadingOverlayProps {
  visible: Accessor<boolean>;
  children: Child;
  label?: string;
  class?: string;
}

/** Covers a region while it loads, keeping the content underneath. */
export function LoadingOverlay(props: LoadingOverlayProps): El {
  return R.div(
    {
      class: props.class ? "rui-loading-host " + props.class : "rui-loading-host",
      "aria-busy": () => String(props.visible()),
    },
    props.children,
    Show({
      when: () => props.visible(),
      children: R.div(
        { class: "rui-loading-overlay" },
        Spinner({ label: props.label ?? "Loading" }),
      ),
    }),
  );
}

/* -------------------------------------------------------------- Timeline -- */

export interface TimelineItem {
  title: Child;
  description?: Child;
  time?: Child;
  tone?: Tone;
  icon?: Child;
}

export interface TimelineProps {
  items: readonly TimelineItem[] | Accessor<readonly TimelineItem[]>;
  class?: string;
}

export function Timeline(props: TimelineProps): El {
  const items = typeof props.items === "function" ? props.items : () => props.items as readonly TimelineItem[];
  return R.ol(
    { class: props.class ? "rui-timeline " + props.class : "rui-timeline" },
    For({
      each: items,
      children: (item: TimelineItem) =>
        R.li(
          { class: "rui-timeline-item" },
          R.span(
            { class: "rui-timeline-marker rui-tone-" + (item.tone ?? "neutral"), "aria-hidden": "true" },
            item.icon ?? null,
          ),
          R.div(
            { class: "rui-timeline-body" },
            R.div({ class: "rui-timeline-title" }, item.title),
            item.time !== undefined ? R.div({ class: "rui-timeline-time" }, item.time) : null,
            item.description !== undefined ? R.div({ class: "rui-timeline-desc" }, item.description) : null,
          ),
        ),
    }),
  );
}

/* ----------------------------------------------------------------- Image -- */

export interface ImageProps {
  src: Accessor<string> | string;
  /** INTENTIONALLY empty for decorative images. */
  alt: string;
  width?: string;
  height?: string;
  ratio?: number;
  /** Content shown on a load error. */
  fallback?: Child;
  lazy?: boolean;
  class?: string;
}

export function Image(props: ImageProps): El {
  const src = (): string => (typeof props.src === "function" ? props.src() : props.src);

  return R.span(
    {
      class: props.class ? "rui-image " + props.class : "rui-image",
      style: [
        props.width ? "width:" + props.width : null,
        props.height ? "height:" + props.height : null,
        props.ratio ? "aspect-ratio:" + props.ratio : null,
      ]
        .filter(Boolean)
        .join(";"),
    },
    R.img({
      class: "rui-image-img",
      src: () => src(),
      alt: props.alt,
      ...(props.lazy === false ? {} : { loading: "lazy", decoding: "async" }),
    }),
    props.fallback !== undefined ? R.span({ class: "rui-image-fallback" }, props.fallback) : null,
  );
}
