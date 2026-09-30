/**
 * Carousel, Gallery, Lightbox, ImageZoom, VideoPlayer, AudioPlayer, Waveform,
 * QRCode, ImageUpload, UploadProgress, FilePreview.
 *
 * Media and images. The players wrap the native `<video>`/`<audio>` elements:
 * decoding, subtitles and streaming are the browser's job; we only add
 * stylable, accessible controls.
 */
import { state, derived, effect, onCleanup, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { Portal } from "./primitives/portal.ts";
import { focusTrap } from "./primitives/focus-trap.ts";
import { onDoc, type El } from "./primitives/env.ts";
import { formatSize, type FileLike } from "./files.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/* -------------------------------------------------------------- Carousel -- */

export interface CarouselProps {
  slides: readonly Child[];
  /** The current index; give it a signal if you want external control. */
  index?: State<number>;
  /** Ms between automatic advances. `0` = none. */
  autoplay?: number;
  loop?: boolean;
  /** Navigation dots below the slides. Default `true`. */
  dots?: boolean;
  arrows?: boolean;
  label?: string;
  class?: string;
}

export interface CarouselHandle {
  el: El;
  index: Accessor<number>;
  go: (index: number) => void;
  next: () => void;
  prev: () => void;
}

/**
 * Carousel - slides with navigation.
 *
 * `aria-roledescription="carousel"` and `aria-live` on the container: when the
 * slide changes, the screen reader announces "3 of 5". Autoplay stops on hover
 * AND on focus - a carousel that moves while you're reading is an accessibility
 * problem (WCAG 2.2.2), not just annoying.
 */
export function carousel(props: CarouselProps): CarouselHandle {
  const id = "rui-car-" + ++idSeq;
  const index = props.index ?? state(0);
  const count = props.slides.length;
  const paused = state(false);

  const go = (next: number): void => {
    if (count === 0) return;
    const bounded = props.loop
      ? ((next % count) + count) % count
      : Math.min(count - 1, Math.max(0, next));
    index.set(bounded);
  };
  const next = (): void => go(index.peek() + 1);
  const prev = (): void => go(index.peek() - 1);

  effect(() => {
    const every = props.autoplay ?? 0;
    if (every <= 0 || paused()) return;
    const timer = setInterval(() => go(index.peek() + 1), every);
    onCleanup(() => clearInterval(timer));
  });

  const el = R.div(
    {
      id,
      class: props.class ? "rui-carousel " + props.class : "rui-carousel",
      role: "group",
      "aria-roledescription": "carousel",
      "aria-label": props.label ?? "Gallery",
      "on:pointerenter": () => paused.set(true),
      "on:pointerleave": () => paused.set(false),
      "on:focusin": () => paused.set(true),
      "on:focusout": () => paused.set(false),
      "on:keydown": (e: any) => {
        if (e.key === "ArrowRight") {
          e.preventDefault?.();
          next();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault?.();
          prev();
        }
      },
    },
    R.div(
      { class: "rui-carousel-viewport", "aria-live": () => (props.autoplay ? "off" : "polite") },
      R.div(
        {
          class: "rui-carousel-track",
          style: () => "transform:translateX(-" + index() * 100 + "%)",
        },
        props.slides.map((slide, i) =>
          R.div(
            {
              class: "rui-carousel-slide",
              role: "group",
              "aria-roledescription": "slide",
              "aria-label": i + 1 + " of " + count,
              "aria-hidden": () => String(index() !== i),
              // Hidden slides must not be tabbable.
              inert: () => (index() !== i ? "" : undefined),
            },
            slide,
          ),
        ),
      ),
    ),
    props.arrows !== false
      ? R.div(
          { class: "rui-carousel-arrows" },
          R.button({
            type: "button",
            class: "rui-carousel-arrow rui-prev",
            "aria-label": "Previous slide",
            disabled: () => !props.loop && index() === 0,
            "on:click": prev,
          }, "‹"),
          R.button({
            type: "button",
            class: "rui-carousel-arrow rui-next",
            "aria-label": "Next slide",
            disabled: () => !props.loop && index() >= count - 1,
            "on:click": next,
          }, "›"),
        )
      : null,
    props.dots !== false
      ? R.div(
          { class: "rui-carousel-dots", role: "tablist", "aria-label": "Choose slide" },
          props.slides.map((_, i) =>
            R.button({
              type: "button",
              class: () => "rui-carousel-dot" + (index() === i ? " rui-active" : ""),
              role: "tab",
              "aria-selected": () => String(index() === i),
              "aria-label": "Slide " + (i + 1),
              "on:click": () => go(i),
            }),
          ),
        )
      : null,
  );

  return { el, index: () => index(), go, next, prev };
}

export function Carousel(props: CarouselProps): El {
  return carousel(props).el;
}

/* -------------------------------------------------- Lightbox si Gallery -- */

export interface LightboxImage {
  src: string;
  alt: string;
  caption?: Child;
  thumbnail?: string;
}

export interface LightboxProps {
  images: readonly LightboxImage[];
  open: State<boolean>;
  index: State<number>;
  onClose?: () => void;
  class?: string;
}

/** Full-screen image, with arrow-key navigation and Escape to close. */
export function Lightbox(props: LightboxProps): Child {
  const close = (): void => {
    props.open.set(false);
    props.onClose?.();
  };

  const go = (delta: number): void => {
    const count = props.images.length;
    if (count === 0) return;
    props.index.set(((props.index.peek() + delta) % count + count) % count);
  };

  effect(() => {
    if (!props.open()) return;
    const unbind = onDoc("keydown", (e: any) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    });
    onCleanup(unbind);
  });

  const current = derived(() => props.images[props.index()] ?? null);

  return Show({
    when: () => props.open(),
    children: Portal({
      children: R.div(
        {
          class: props.class ? "rui-lightbox " + props.class : "rui-lightbox",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "Image viewer",
          ref: focusTrap(),
          "on:click": (e: any) => {
            if (e.target === e.currentTarget) close();
          },
        },
        R.button({
          type: "button",
          class: "rui-lightbox-close",
          "aria-label": "Close",
          "on:click": close,
        }, "✕"),
        R.button({
          type: "button",
          class: "rui-lightbox-prev",
          "aria-label": "Previous image",
          "on:click": () => go(-1),
        }, "‹"),
        R.figure(
          { class: "rui-lightbox-figure" },
          R.img({
            class: "rui-lightbox-img",
            src: () => current()?.src ?? "",
            alt: () => current()?.alt ?? "",
          }),
          Show({
            when: () => current()?.caption !== undefined,
            children: R.figcaption({ class: "rui-lightbox-caption" }, () => current()?.caption ?? ""),
          }),
        ),
        R.button({
          type: "button",
          class: "rui-lightbox-next",
          "aria-label": "Next image",
          "on:click": () => go(1),
        }, "›"),
        R.div({ class: "rui-lightbox-counter", "aria-live": "polite" }, () =>
          props.images.length > 0 ? props.index() + 1 + " of " + props.images.length : "",
        ),
      ),
    }),
  });
}

export interface GalleryProps {
  images: readonly LightboxImage[];
  columns?: number;
  /** Open the lightbox on click. Default `true`. */
  lightbox?: boolean;
  label?: string;
  class?: string;
}

export function Gallery(props: GalleryProps): El {
  const open = state(false);
  const index = state(0);

  return R.div(
    { class: props.class ? "rui-gallery-host " + props.class : "rui-gallery-host" },
    R.ul(
      {
        class: "rui-gallery",
        style: "grid-template-columns:repeat(" + (props.columns ?? 4) + ", minmax(0, 1fr))",
        ...(props.label ? { "aria-label": props.label } : {}),
      },
      props.images.map((image, i) =>
        R.li(
          { class: "rui-gallery-item" },
          R.button(
            {
              type: "button",
              class: "rui-gallery-button",
              "aria-label": "Open: " + image.alt,
              disabled: props.lightbox === false,
              "on:click": () => {
                index.set(i);
                open.set(true);
              },
            },
            R.img({
              class: "rui-gallery-img",
              src: image.thumbnail ?? image.src,
              // Empty `alt`: the button already carries the image's name, otherwise
              // it would be read twice.
              alt: "",
              loading: "lazy",
              decoding: "async",
            }),
          ),
        ),
      ),
    ),
    props.lightbox === false ? null : Lightbox({ images: props.images, open, index }),
  );
}

/* ------------------------------------------------------------- ImageZoom -- */

export interface ImageZoomProps {
  src: string;
  alt: string;
  /** Magnification factor. Default 2.5. */
  zoom?: number;
  width?: string;
  height?: string;
  class?: string;
}

/**
 * ImageZoom - a magnifier that follows the cursor.
 *
 * The effect applies only to a fine pointer (mouse). On touch there's no hover,
 * and `prefers-reduced-motion` disables it - an image that moves under your
 * finger can cause vestibular discomfort.
 */
export function ImageZoom(props: ImageZoomProps): El {
  const zoom = props.zoom ?? 2.5;
  const active = state(false);
  const origin = state<{ x: number; y: number }>({ x: 50, y: 50 });

  return R.span(
    {
      class: () => "rui-zoom" + (active() ? " rui-active" : "") + (props.class ? " " + props.class : ""),
      style: [props.width ? "width:" + props.width : "", props.height ? "height:" + props.height : ""]
        .filter(Boolean)
        .join(";"),
      "on:pointerenter": (e: any) => {
        if (e.pointerType === "touch") return;
        active.set(true);
      },
      "on:pointerleave": () => active.set(false),
      "on:pointermove": (e: any) => {
        if (!active.peek()) return;
        const el = e.currentTarget;
        if (!el || typeof el.getBoundingClientRect !== "function") return;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        origin.set({
          x: ((e.clientX - rect.x) / rect.width) * 100,
          y: ((e.clientY - rect.y) / rect.height) * 100,
        });
      },
    },
    R.img({
      class: "rui-zoom-img",
      src: props.src,
      alt: props.alt,
      style: () =>
        active()
          ? `transform:scale(${zoom});transform-origin:${origin().x.toFixed(1)}% ${origin().y.toFixed(1)}%`
          : "transform:none",
    }),
  );
}

/* ---------------------------------------------- VideoPlayer / AudioPlayer */

export interface MediaPlayerProps {
  src: string;
  /** Subtitle tracks (video only). */
  tracks?: readonly { src: string; label: string; lang: string; default?: boolean }[];
  poster?: string;
  label?: string;
  /** Start automatically. Requires `muted` in most browsers. */
  autoplay?: boolean;
  loop?: boolean;
  class?: string;
}

/** `142` -> `"2:22"`, `3725` -> `"1:02:05"`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

interface PlayerState {
  playing: Accessor<boolean>;
  time: Accessor<number>;
  duration: Accessor<number>;
  volume: Accessor<number>;
  muted: Accessor<boolean>;
}

/** The controls shared by audio and video. */
function mediaControls(
  ref: () => El,
  st: {
    playing: State<boolean>;
    time: State<number>;
    duration: State<number>;
    volume: State<number>;
    muted: State<boolean>;
  },
): El {
  const toggle = (): void => {
    const el = ref();
    if (!el) return;
    if (st.playing.peek()) el.pause?.();
    else el.play?.();
  };

  const seek = (value: number): void => {
    const el = ref();
    if (el) el.currentTime = value;
    st.time.set(value);
  };

  return R.div(
    { class: "rui-player-controls" },
    R.button({
      type: "button",
      class: "rui-player-play",
      "aria-label": () => (st.playing() ? "Pause" : "Play"),
      "on:click": toggle,
    }, () => (st.playing() ? "❚❚" : "▶")),
    R.span({ class: "rui-player-time rui-tabular" }, () => formatDuration(st.time())),
    R.input({
      type: "range",
      class: "rui-player-seek",
      min: "0",
      step: "0.1",
      "aria-label": "Position",
      max: () => String(Math.max(0, st.duration())),
      value: () => String(st.time()),
      "aria-valuetext": () => formatDuration(st.time()) + " of " + formatDuration(st.duration()),
      "on:input": (e: any) => seek(Number(e.target?.value ?? 0)),
    }),
    R.span({ class: "rui-player-time rui-tabular" }, () => formatDuration(st.duration())),
    R.button({
      type: "button",
      class: "rui-player-mute",
      "aria-label": () => (st.muted() ? "Unmute" : "Mute"),
      "aria-pressed": () => String(st.muted()),
      "on:click": () => {
        const el = ref();
        const next = !st.muted.peek();
        if (el) el.muted = next;
        st.muted.set(next);
      },
    }, () => (st.muted() ? "🔇" : "🔊")),
    R.input({
      type: "range",
      class: "rui-player-volume",
      min: "0",
      max: "1",
      step: "0.05",
      "aria-label": "Volume",
      value: () => String(st.volume()),
      "on:input": (e: any) => {
        const next = Number(e.target?.value ?? 1);
        const el = ref();
        if (el) el.volume = next;
        st.volume.set(next);
      },
    }),
  );
}

/** Binds the native events to signals. */
function bindMedia(
  el: El,
  st: {
    playing: State<boolean>;
    time: State<number>;
    duration: State<number>;
    volume: State<number>;
    muted: State<boolean>;
  },
): void {
  if (!el || typeof el.addEventListener !== "function") return;
  const on = (type: string, fn: () => void): void => {
    el.addEventListener(type, fn);
    onCleanup(() => el.removeEventListener(type, fn));
  };
  on("play", () => st.playing.set(true));
  on("pause", () => st.playing.set(false));
  on("timeupdate", () => st.time.set(Number(el.currentTime ?? 0)));
  on("durationchange", () => st.duration.set(Number(el.duration ?? 0)));
  on("volumechange", () => {
    st.volume.set(Number(el.volume ?? 1));
    st.muted.set(Boolean(el.muted));
  });
}

export function VideoPlayer(props: MediaPlayerProps): El {
  const st = {
    playing: state(false),
    time: state(0),
    duration: state(0),
    volume: state(1),
    muted: state(props.autoplay === true),
  };
  let el: El = null;

  return R.div(
    {
      class: props.class ? "rui-player rui-video " + props.class : "rui-player rui-video",
      ...(props.label ? { "aria-label": props.label, role: "region" } : {}),
    },
    R.video(
      {
        class: "rui-player-media",
        src: props.src,
        ...(props.poster ? { poster: props.poster } : {}),
        ...(props.autoplay ? { autoplay: "", muted: "", playsinline: "" } : {}),
        ...(props.loop ? { loop: "" } : {}),
        // No `controls`: we add our own stylable controls. `preload=metadata`
        // fetches the duration without downloading the whole movie.
        preload: "metadata",
        ref: (node: El) => {
          el = node;
          bindMedia(node, st);
        },
        "on:click": () => (st.playing.peek() ? el?.pause?.() : el?.play?.()),
      },
      (props.tracks ?? []).map((track) =>
        R.track({
          kind: "subtitles",
          src: track.src,
          srclang: track.lang,
          label: track.label,
          ...(track.default ? { default: "" } : {}),
        }),
      ),
    ),
    mediaControls(() => el, st),
  );
}

export function AudioPlayer(props: Omit<MediaPlayerProps, "tracks" | "poster">): El {
  const st = {
    playing: state(false),
    time: state(0),
    duration: state(0),
    volume: state(1),
    muted: state(false),
  };
  let el: El = null;

  return R.div(
    {
      class: props.class ? "rui-player rui-audio " + props.class : "rui-player rui-audio",
      ...(props.label ? { "aria-label": props.label, role: "region" } : {}),
    },
    R.audio({
      class: "rui-player-media",
      src: props.src,
      preload: "metadata",
      ...(props.loop ? { loop: "" } : {}),
      ref: (node: El) => {
        el = node;
        bindMedia(node, st);
      },
    }),
    mediaControls(() => el, st),
  );
}

/* -------------------------------------------------------------- Waveform -- */

export interface WaveformProps {
  /**
   * Normalized amplitudes 0..1, one per column.
   *
   * The component does NOT decode audio: decoding needs an `AudioContext` and a
   * whole file in memory, which has no place in a UI component. Compute the
   * peaks on the server or in a worker and send them here.
   */
  peaks: Accessor<readonly number[]> | readonly number[];
  /** The current position, 0..1. */
  progress?: Accessor<number>;
  width?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  onSeek?: (fraction: number) => void;
  label?: string;
  class?: string;
}

/** Reduces a long vector of samples to `count` peaks. */
export function computePeaks(samples: readonly number[], count: number): number[] {
  if (count <= 0 || samples.length === 0) return [];
  const out: number[] = [];
  const size = samples.length / count;
  for (let i = 0; i < count; i++) {
    const from = Math.floor(i * size);
    const to = Math.min(samples.length, Math.floor((i + 1) * size));
    let peak = 0;
    for (let j = from; j < to; j++) {
      const value = Math.abs(samples[j] ?? 0);
      if (value > peak) peak = value;
    }
    out.push(peak);
  }
  const max = Math.max(...out, 1e-9);
  return out.map((p) => p / max);
}

export function Waveform(props: WaveformProps): El {
  const width = props.width ?? 320;
  const height = props.height ?? 56;
  const barWidth = props.barWidth ?? 2;
  const gap = props.gap ?? 1;
  const read = (): readonly number[] =>
    typeof props.peaks === "function" ? props.peaks() : props.peaks;

  const bars = derived(() => {
    const peaks = read();
    const step = barWidth + gap;
    const max = Math.floor(width / step);
    return peaks.length <= max ? [...peaks] : computePeaks(peaks, max);
  });

  return R.div(
    {
      class: props.class ? "rui-waveform " + props.class : "rui-waveform",
      ...(props.onSeek
        ? {
            role: "slider",
            tabindex: "0",
            "aria-label": props.label ?? "Position in track",
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": () => String(Math.round((props.progress?.() ?? 0) * 100)),
            "on:click": (e: any) => {
              const el = e.currentTarget;
              if (!el || typeof el.getBoundingClientRect !== "function") return;
              const rect = el.getBoundingClientRect();
              if (!rect.width) return;
              props.onSeek!(Math.min(1, Math.max(0, (e.clientX - rect.x) / rect.width)));
            },
            "on:keydown": (e: any) => {
              const at = props.progress?.() ?? 0;
              if (e.key === "ArrowRight") {
                e.preventDefault?.();
                props.onSeek!(Math.min(1, at + 0.05));
              } else if (e.key === "ArrowLeft") {
                e.preventDefault?.();
                props.onSeek!(Math.max(0, at - 0.05));
              }
            },
          }
        : { "aria-hidden": "true" }),
    },
    R.svg(
      {
        class: "rui-waveform-svg",
        width: String(width),
        height: String(height),
        viewBox: `0 0 ${width} ${height}`,
        "aria-hidden": "true",
      },
      For({
        each: () => bars().map((_, i) => i),
        children: (i: number) => {
          const value = (): number => bars()[i] ?? 0;
          const x = i * (barWidth + gap);
          const played = (): boolean => x / width <= (props.progress?.() ?? 0);
          return R.rect({
            class: () => "rui-waveform-bar" + (played() ? " rui-played" : ""),
            x: String(x),
            width: String(barWidth),
            rx: String(barWidth / 2),
            height: () => Math.max(1, value() * height).toFixed(2),
            y: () => ((height - Math.max(1, value() * height)) / 2).toFixed(2),
          });
        },
      }),
    ),
  );
}

/* ------------------------------------------ ImageUpload / UploadProgress -- */

export interface ImageUploadProps {
  /** URL of the current image (object URL or remote). */
  value: State<string | null>;
  /** Called with the chosen file; you decide what to do with it. */
  onSelect?: (file: FileLike) => void;
  onClear?: () => void;
  accept?: string;
  shape?: "circle" | "square";
  size?: string;
  label?: string;
  class?: string;
}

/** Avatar/image picker with a preview. */
export function ImageUpload(props: ImageUploadProps): El {
  const id = "rui-imgup-" + ++idSeq;
  let input: El = null;

  return R.div(
    {
      class:
        "rui-imageupload rui-" + (props.shape ?? "circle") + (props.class ? " " + props.class : ""),
      style: "width:" + (props.size ?? "96px") + ";height:" + (props.size ?? "96px"),
    },
    R.input({
      id,
      type: "file",
      class: "rui-sr-only",
      accept: props.accept ?? "image/*",
      ref: (el: El) => {
        input = el;
      },
      "on:change": (e: any) => {
        const file = e.target?.files?.[0];
        if (file) props.onSelect?.(file);
        if (e.target) e.target.value = "";
      },
    }),
    R.label(
      { class: "rui-imageupload-drop", for: id },
      Show({
        when: () => props.value() !== null,
        children: R.img({ class: "rui-imageupload-img", alt: "", src: () => props.value() ?? "" }),
        fallback: R.span({ class: "rui-imageupload-hint" }, props.label ?? "Choose an image"),
      }),
    ),
    Show({
      when: () => props.value() !== null,
      children: R.button({
        type: "button",
        class: "rui-imageupload-clear",
        "aria-label": "Remove image",
        "on:click": () => {
          props.value.set(null);
          props.onClear?.();
        },
      }, "✕"),
    }),
  );
}

export interface UploadTask {
  name: string;
  /** 0..100. */
  progress: number;
  status?: "pending" | "uploading" | "done" | "error";
  error?: string;
  size?: number;
}

export interface UploadProgressProps {
  tasks: Accessor<readonly UploadTask[]> | readonly UploadTask[];
  onCancel?: (task: UploadTask) => void;
  onRetry?: (task: UploadTask) => void;
  label?: string;
  class?: string;
}

/** List of uploads in progress, with per-file and total progress. */
export function UploadProgress(props: UploadProgressProps): El {
  const read = (): readonly UploadTask[] =>
    typeof props.tasks === "function" ? props.tasks() : props.tasks;

  const total = derived(() => {
    const tasks = read();
    if (tasks.length === 0) return 0;
    return tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length;
  });

  return R.div(
    {
      class: props.class ? "rui-uploads " + props.class : "rui-uploads",
      role: "region",
      "aria-label": props.label ?? "Uploads",
    },
    R.div(
      {
        class: "rui-uploads-total",
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": () => String(Math.round(total())),
        "aria-label": "Total progress",
      },
      R.div({ class: "rui-uploads-total-bar", style: () => "width:" + total().toFixed(1) + "%" }),
    ),
    R.ul(
      { class: "rui-uploads-list" },
      For({
        each: read,
        children: (task: UploadTask) =>
          R.li(
            { class: "rui-upload rui-upload-" + (task.status ?? "uploading") },
            R.span({ class: "rui-upload-name" }, task.name),
            task.size !== undefined
              ? R.span({ class: "rui-upload-size" }, formatSize(task.size))
              : null,
            R.span(
              {
                class: "rui-upload-bar-track",
                role: "progressbar",
                "aria-valuemin": "0",
                "aria-valuemax": "100",
                "aria-valuenow": String(Math.round(task.progress)),
                "aria-label": task.name,
              },
              R.span({ class: "rui-upload-bar", style: "width:" + task.progress + "%" }),
            ),
            task.status === "error"
              ? R.span({ class: "rui-upload-error", role: "alert" }, task.error ?? "Error")
              : null,
            task.status === "error" && props.onRetry
              ? R.button({
                  type: "button",
                  class: "rui-upload-retry",
                  "aria-label": "Retry " + task.name,
                  "on:click": () => props.onRetry!(task),
                }, "↻")
              : null,
            task.status !== "done" && props.onCancel
              ? R.button({
                  type: "button",
                  class: "rui-upload-cancel",
                  "aria-label": "Cancel " + task.name,
                  "on:click": () => props.onCancel!(task),
                }, "✕")
              : null,
          ),
      }),
    ),
  );
}

/* ----------------------------------------------------------- FilePreview -- */

export interface FilePreviewProps {
  file: FileLike;
  /** Preview URL (object URL). Without it, only the icon is shown. */
  url?: string;
  size?: string;
  class?: string;
}

/** The icon that fits a file type. */
export function fileIcon(type: string, name: string): string {
  const mime = (type || "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("video/")) return "🎞";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime === "application/pdf" || ext === "pdf") return "📕";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜";
  if (["js", "ts", "tsx", "json", "html", "css", "py", "rs", "go"].includes(ext)) return "🧾";
  if (["doc", "docx", "odt"].includes(ext)) return "📄";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "📊";
  return "📎";
}

export function FilePreview(props: FilePreviewProps): El {
  const isImage = (props.file.type || "").startsWith("image/");
  return R.div(
    {
      class: props.class ? "rui-filepreview " + props.class : "rui-filepreview",
      style: "width:" + (props.size ?? "72px"),
    },
    isImage && props.url
      ? R.img({ class: "rui-filepreview-img", src: props.url, alt: "", loading: "lazy" })
      : R.span({ class: "rui-filepreview-icon", "aria-hidden": "true" }, fileIcon(props.file.type, props.file.name)),
    R.span({ class: "rui-filepreview-name", title: props.file.name }, props.file.name),
    R.span({ class: "rui-filepreview-size" }, formatSize(props.file.size)),
  );
}
