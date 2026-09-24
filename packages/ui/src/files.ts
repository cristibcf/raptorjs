/**
 * FileInput / Dropzone / FileList.
 *
 * Validarea e aceeasi pentru selectia din dialog si pentru drag & drop - o
 * singura functie, `validateFiles`, exportata si testabila separat. Altfel
 * ajungi cu doua seturi de reguli care diverg.
 */
import { state, type Accessor, type State } from "@raptor/core";
import { R, For, Show, type Child } from "@raptor/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/** Forma minima de fisier pe care o folosim; compatibila cu `File`. */
export interface FileLike {
  name: string;
  size: number;
  type: string;
}

export interface FileRejection {
  file: FileLike;
  reason: "type" | "size" | "count";
  message: string;
}

export interface FileConstraints {
  /** Lista `accept`: extensii (".png") sau tipuri MIME ("image/*"). */
  accept?: string;
  /** Marime maxima, in bytes. */
  maxSize?: number;
  /** Numar maxim de fisiere acceptate in total. */
  maxFiles?: number;
}

/** Formateaza o marime in unitati binare (1 KiB = 1024 B). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return (unit === 0 ? value : Number(value.toFixed(1))) + " " + units[unit];
}

/** `true` daca fisierul se potriveste cu lista `accept`. */
export function matchesAccept(file: FileLike, accept: string | undefined): boolean {
  if (!accept || accept.trim() === "") return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();

  return accept.split(",").some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (rule === "") return false;
    if (rule.startsWith(".")) return name.endsWith(rule);
    // "image/*" acopera orice subtip.
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

export interface ValidationResult<T extends FileLike> {
  accepted: T[];
  rejected: FileRejection[];
}

/**
 * Aplica toate constrangerile. Regula de numar se aplica DUPA filtrele de tip
 * si marime: altfel un fisier respins ar consuma un loc din limita.
 */
export function validateFiles<T extends FileLike>(
  files: readonly T[],
  constraints: FileConstraints,
  existingCount = 0,
): ValidationResult<T> {
  const accepted: T[] = [];
  const rejected: FileRejection[] = [];

  for (const file of files) {
    if (!matchesAccept(file, constraints.accept)) {
      rejected.push({ file, reason: "type", message: "Tip de fișier neacceptat" });
      continue;
    }
    if (constraints.maxSize !== undefined && file.size > constraints.maxSize) {
      rejected.push({
        file,
        reason: "size",
        message: "Prea mare (maxim " + formatSize(constraints.maxSize) + ")",
      });
      continue;
    }
    if (
      constraints.maxFiles !== undefined &&
      existingCount + accepted.length >= constraints.maxFiles
    ) {
      rejected.push({
        file,
        reason: "count",
        message: "Prea multe fișiere (maxim " + constraints.maxFiles + ")",
      });
      continue;
    }
    accepted.push(file);
  }

  return { accepted, rejected };
}

/* ------------------------------------------------------------- FileInput -- */

export interface FileInputProps extends FileConstraints {
  files: State<readonly FileLike[]>;
  multiple?: boolean;
  disabled?: Accessor<boolean> | boolean;
  label?: Child;
  id?: string;
  onReject?: (rejections: readonly FileRejection[]) => void;
  class?: string;
}

function readDisabled(value: Accessor<boolean> | boolean | undefined): boolean {
  if (value === undefined) return false;
  return typeof value === "function" ? value() : value;
}

export function FileInput(props: FileInputProps): El {
  const id = props.id ?? "rui-file-" + ++idSeq;
  let inputEl: El = null;

  const take = (list: readonly FileLike[]): void => {
    const existing = props.multiple ? props.files.peek().length : 0;
    const result = validateFiles(list, props, existing);
    if (result.rejected.length > 0) props.onReject?.(result.rejected);
    if (result.accepted.length === 0) return;
    props.files.set(props.multiple ? [...props.files.peek(), ...result.accepted] : result.accepted);
  };

  return R.div(
    { class: props.class ? "rui-file " + props.class : "rui-file" },
    R.input({
      id,
      type: "file",
      class: "rui-sr-only",
      ...(props.accept ? { accept: props.accept } : {}),
      ...(props.multiple ? { multiple: "" } : {}),
      disabled: () => readDisabled(props.disabled),
      ref: (el: El) => {
        inputEl = el;
      },
      "on:change": (e: any) => {
        const list: FileLike[] = Array.from(e.target?.files ?? []);
        take(list);
        // Golim inputul: altfel re-selectarea aceluiasi fisier nu declanseaza
        // `change` si utilizatorul crede ca nu a mers.
        if (e.target) e.target.value = "";
      },
    }),
    // Eticheta e un `label` real, legat de input: click-ul functioneaza si
    // fara JavaScript, iar screen readerul anunta controlul corect.
    R.label(
      { class: "rui-file-button rui-btn rui-btn-secondary rui-btn-md", for: id },
      props.label ?? "Alege fișiere",
    ),
  );
}

/* -------------------------------------------------------------- Dropzone -- */

export interface DropzoneProps extends FileConstraints {
  files: State<readonly FileLike[]>;
  multiple?: boolean;
  disabled?: Accessor<boolean> | boolean;
  children?: Child;
  hint?: Child;
  onReject?: (rejections: readonly FileRejection[]) => void;
  label?: string;
  class?: string;
}

export interface DropzoneHandle {
  el: El;
  over: Accessor<boolean>;
  /** Punte de test: livreaza fisiere fara evenimente DOM reale. */
  accept: (files: readonly FileLike[]) => void;
}

/**
 * Dropzone - drag & drop cu validare.
 *
 * Contorul de `dragenter`/`dragleave` nu e cosmetic: evenimentele se
 * declanseaza si cand cursorul trece peste un COPIL al zonei, asa ca un simplu
 * boolean face zona sa palpaie. Numaram intrarile si iesirile.
 */
export function dropzone(props: DropzoneProps): DropzoneHandle {
  const id = "rui-dz-" + ++idSeq;
  const over = state(false);
  const rejections = state<readonly FileRejection[]>([]);
  let depth = 0;
  let inputEl: El = null;

  const accept = (list: readonly FileLike[]): void => {
    if (readDisabled(props.disabled)) return;
    const existing = props.multiple ? props.files.peek().length : 0;
    const result = validateFiles(list, props, existing);
    rejections.set(result.rejected);
    if (result.rejected.length > 0) props.onReject?.(result.rejected);
    if (result.accepted.length === 0) return;
    props.files.set(props.multiple ? [...props.files.peek(), ...result.accepted] : result.accepted);
  };

  const el = R.div(
    {
      class: () =>
        "rui-dropzone" +
        (over() ? " rui-over" : "") +
        (readDisabled(props.disabled) ? " rui-disabled" : "") +
        (props.class ? " " + props.class : ""),
      role: "button",
      tabindex: "0",
      "aria-label": props.label ?? "Trage fișiere aici sau apasă pentru a alege",
      "aria-describedby": id + "-hint",
      "on:click": () => inputEl?.click?.(),
      "on:keydown": (e: any) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault?.();
          inputEl?.click?.();
        }
      },
      "on:dragenter": (e: any) => {
        e.preventDefault?.();
        depth++;
        over.set(true);
      },
      "on:dragover": (e: any) => {
        // Fara `preventDefault` pe dragover, browserul NU declanseaza `drop`.
        e.preventDefault?.();
      },
      "on:dragleave": (e: any) => {
        e.preventDefault?.();
        depth = Math.max(0, depth - 1);
        if (depth === 0) over.set(false);
      },
      "on:drop": (e: any) => {
        e.preventDefault?.();
        depth = 0;
        over.set(false);
        const list: FileLike[] = Array.from(e.dataTransfer?.files ?? []);
        accept(list);
      },
    },
    R.input({
      type: "file",
      class: "rui-sr-only",
      tabindex: "-1",
      "aria-hidden": "true",
      ...(props.accept ? { accept: props.accept } : {}),
      ...(props.multiple ? { multiple: "" } : {}),
      ref: (node: El) => {
        inputEl = node;
      },
      "on:change": (e: any) => {
        accept(Array.from(e.target?.files ?? []));
        if (e.target) e.target.value = "";
      },
    }),
    R.div({ class: "rui-dropzone-body" }, props.children ?? "Trage fișiere aici"),
    R.div({ id: id + "-hint", class: "rui-dropzone-hint" }, props.hint ?? null),
    Show({
      when: () => rejections().length > 0,
      children: R.ul(
        { class: "rui-dropzone-errors", role: "alert" },
        For({
          each: () => rejections(),
          children: (r: FileRejection) => R.li({}, r.file.name + ": " + r.message),
        }),
      ),
    }),
  );

  return { el, over: () => over(), accept };
}

export function Dropzone(props: DropzoneProps): El {
  return dropzone(props).el;
}

/* -------------------------------------------------------------- FileList -- */

export interface FileListProps {
  files: State<readonly FileLike[]>;
  /** Progres 0..100 per fisier, dupa nume. */
  progress?: Accessor<Readonly<Record<string, number>>>;
  onRemove?: (file: FileLike, index: number) => void;
  /** Ascunde butonul de stergere. */
  readonly?: boolean;
  empty?: Child;
  label?: string;
  class?: string;
}

export function FileList(props: FileListProps): El {
  const remove = (index: number): void => {
    const file = props.files.peek()[index];
    props.files.update((prev) => prev.filter((_, i) => i !== index));
    if (file) props.onRemove?.(file, index);
  };

  return R.ul(
    {
      class: props.class ? "rui-filelist " + props.class : "rui-filelist",
      "aria-label": props.label ?? "Fișiere",
    },
    For({
      each: () => props.files(),
      children: (file: FileLike, index: number) =>
        R.li(
          { class: "rui-filelist-item" },
          R.span({ class: "rui-filelist-name" }, file.name),
          R.span({ class: "rui-filelist-size" }, formatSize(file.size)),
          props.progress
            ? Show({
                when: () => props.progress!()[file.name] !== undefined,
                children: R.span(
                  {
                    class: "rui-filelist-progress",
                    role: "progressbar",
                    "aria-valuemin": "0",
                    "aria-valuemax": "100",
                    "aria-valuenow": () => String(Math.round(props.progress!()[file.name] ?? 0)),
                    "aria-label": "Progres pentru " + file.name,
                  },
                  R.span({
                    class: "rui-filelist-bar",
                    style: () => "width:" + (props.progress!()[file.name] ?? 0) + "%",
                  }),
                ),
              })
            : null,
          props.readonly
            ? null
            : R.button(
                {
                  type: "button",
                  class: "rui-filelist-remove",
                  "aria-label": "Elimină " + file.name,
                  "on:click": () => remove(index),
                },
                "✕",
              ),
        ),
    }),
    Show({
      when: () => props.files().length === 0,
      children: R.li({ class: "rui-filelist-empty" }, props.empty ?? "Niciun fișier"),
    }),
  );
}
