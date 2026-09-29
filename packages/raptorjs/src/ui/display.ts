/**
 * Display - componente de continut: carduri, insigne, avataruri, stari.
 *
 * Majoritatea sunt functii pure fara stare. Valoarea lor e in detaliile de
 * accesibilitate pe care le rezolva o data pentru totdeauna: un `Badge` cu
 * numar trebuie sa aiba un nume citibil ("3 notificări necitite"), nu doar
 * cifra; un `Avatar` cu initiale e decorativ si nu trebuie citit de doua ori;
 * un `Skeleton` trebuie sa fie `aria-hidden` ca sa nu anunte zgomot.
 */
import { derived, type Accessor } from "raptorjs";
import { R, For, Show, type Child } from "raptorjs/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/* ------------------------------------------------------------------ Card -- */

export interface CardProps {
  children?: Child;
  header?: Child;
  footer?: Child;
  /** Titlu simplu; ignorat daca dai `header`. */
  title?: Child;
  /** Card interactiv: capata rol de buton si raspunde la Enter/Space. */
  onClick?: () => void;
  /** Eticheta obligatorie cand cardul e interactiv fara text clar. */
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
            // Un `div` cu `role=button` NU raspunde singur la tastatura.
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
  /** Numar; peste `max` se afiseaza "99+". */
  count?: Accessor<number> | number;
  max?: number;
  /** Doar un punct, fara continut. */
  dot?: boolean;
  tone?: Tone;
  /** Ascunde cand numarul e 0. Implicit `true`. */
  hideZero?: boolean;
  /** Nume citibil; fara el, un badge cu "3" nu spune nimic. */
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
      // Punctul nu are continut: fara eticheta e pur decorativ.
      ...(props.dot && !props.label ? { "aria-hidden": "true" } : {}),
    },
    props.dot ? null : props.count !== undefined ? () => text() : (props.children ?? null),
  );
}

/* ------------------------------------------------------------------- Tag -- */

export interface TagProps {
  children: Child;
  tone?: Tone;
  /** Arata ✕ si cheama `onRemove`. */
  onRemove?: () => void;
  /** Nume pentru butonul de stergere (ex. numele tagului). */
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
            "aria-label": props.removeLabel ?? "Elimină",
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
  /** URL de imagine. Lipsa sau eroare => initiale. */
  src?: Accessor<string | null> | string;
  /** Numele persoanei; din el se scot initialele. */
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Forma. Implicit cerc. */
  square?: boolean;
  class?: string;
}

/** Initialele: primul si ultimul cuvant, maxim doua litere. */
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
      // Numele e pe container, o singura data: imaginea si initialele de
      // dedesubt sunt decorative, altfel screen readerul l-ar citi de doua ori.
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
  /** Cati se arata inainte de "+N". Implicit 4. */
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
            "aria-label": "și încă " + rest,
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
  /** Variatie fata de perioada anterioara, in procente. */
  delta?: Accessor<number> | number;
  /** Pentru majoritatea metricilor cresterea e buna; la "churn" nu e. */
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
  /** Termenii pe aceeasi linie cu descrierea. */
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

/* --------------------------------------------------------- stari si note -- */

export interface AlertProps {
  children: Child;
  title?: Child;
  tone?: Tone;
  /** Buton de inchidere. */
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
      // `alert` intrerupe cititorul; il folosim doar pentru erori.
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
          { type: "button", class: "rui-alert-close", "aria-label": "Închide", "on:click": props.onDismiss },
          "✕",
        )
      : null,
  );
}

export interface CalloutProps extends Omit<AlertProps, "onDismiss"> {}

/** Nota evidentiata in text. Ca `Alert`, dar fara rol de anunt. */
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
      "aria-label": "Anunț",
    },
    R.div({ class: "rui-banner-body" }, props.children),
    props.action ?? null,
    props.onDismiss
      ? R.button(
          { type: "button", class: "rui-banner-close", "aria-label": "Închide anunțul", "on:click": props.onDismiss },
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

/* ------------------------------------------------------------ incarcare -- */

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  /** Text citit de screen reader. Implicit "Se încarcă". */
  label?: string;
  class?: string;
}

export function Spinner(props: SpinnerProps): El {
  return R.span(
    { class: "rui-spinner rui-spinner-" + (props.size ?? "md") + (props.class ? " " + props.class : ""), role: "status" },
    R.span({ class: "rui-spinner-circle", "aria-hidden": "true" }),
    R.span({ class: "rui-sr-only" }, props.label ?? "Se încarcă"),
  );
}

export interface SkeletonProps {
  /** `text`, `circle` sau `rect`. */
  variant?: "text" | "circle" | "rect";
  width?: string;
  height?: string;
  /** Numar de randuri pentru varianta `text`. */
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

  // `aria-hidden`: un placeholder nu are ce sa anunte. Starea de incarcare se
  // comunica din containerul cu `aria-busy`, nu din fiecare dreptunghi gri.
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
      // Ultimul rand mai scurt, ca un paragraf real.
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

/** Acopera o zona cat se incarca, pastrand continutul dedesubt. */
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
        Spinner({ label: props.label ?? "Se încarcă" }),
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
  /** Gol INTENTIONAT pentru imagini decorative. */
  alt: string;
  width?: string;
  height?: string;
  ratio?: number;
  /** Imagine afisata la eroare de incarcare. */
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
