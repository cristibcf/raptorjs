/**
 * FileInput / Dropzone / FileList.
 *
 * Validation is the same for selection from the dialog and for drag & drop - a
 * single function, `validateFiles`, exported and testable separately. Otherwise
 * you end up with two sets of rules that diverge.
 */
import { state, type Accessor, type State } from "raptorjs";
import { R, For, Show, type Child } from "raptorjs/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/** The minimal file shape we use; compatible with `File`. */
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
  /** The `accept` list: extensions (".png") or MIME types ("image/*"). */
  accept?: string;
  /** Maximum size, in bytes. */
  maxSize?: number;
  /** Maximum number of files accepted in total. */
  maxFiles?: number;
}

/** Formats a size in binary units (1 KiB = 1024 B). */
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

/** `true` if the file matches the `accept` list. */
export function matchesAccept(file: FileLike, accept: string | undefined): boolean {
  if (!accept || accept.trim() === "") return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();

  return accept.split(",").some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (rule === "") return false;
    if (rule.startsWith(".")) return name.endsWith(rule);
    // "image/*" covers any subtype.
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

export interface ValidationResult<T extends FileLike> {
  accepted: T[];
  rejected: FileRejection[];
}

/**
 * Applies all the constraints. The count rule is applied AFTER the type and
 * size filters: otherwise a rejected file would consume a slot from the limit.
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
      rejected.push({ file, reason: "type", message: "Unsupported file type" });
      continue;
    }
    if (constraints.maxSize !== undefined && file.size > constraints.maxSize) {
      rejected.push({
        file,
        reason: "size",
        message: "Too large (max " + formatSize(constraints.maxSize) + ")",
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
        message: "Too many files (max " + constraints.maxFiles + ")",
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
        // We clear the input: otherwise re-selecting the same file doesn't fire
        // `change` and the user thinks it didn't work.
        if (e.target) e.target.value = "";
      },
    }),
    // The label is a real `label`, linked to the input: the click works even
    // without JavaScript, and the screen reader announces the control correctly.
    R.label(
      { class: "rui-file-button rui-btn rui-btn-secondary rui-btn-md", for: id },
      props.label ?? "Choose files",
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
  /** Test bridge: delivers files without real DOM events. */
  accept: (files: readonly FileLike[]) => void;
}

/**
 * Dropzone - drag & drop with validation.
 *
 * The `dragenter`/`dragleave` counter isn't cosmetic: the events also fire when
 * the cursor passes over a CHILD of the zone, so a plain boolean makes the zone
 * flicker. We count the enters and leaves.
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
      "aria-label": props.label ?? "Drag files here or click to choose",
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
        // Without `preventDefault` on dragover, the browser does NOT fire `drop`.
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
    R.div({ class: "rui-dropzone-body" }, props.children ?? "Drag files here"),
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
  /** Progress 0..100 per file, by name. */
  progress?: Accessor<Readonly<Record<string, number>>>;
  onRemove?: (file: FileLike, index: number) => void;
  /** Hides the remove button. */
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
      "aria-label": props.label ?? "Files",
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
                    "aria-label": "Progress for " + file.name,
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
                  "aria-label": "Remove " + file.name,
                  "on:click": () => remove(index),
                },
                "✕",
              ),
        ),
    }),
    Show({
      when: () => props.files().length === 0,
      children: R.li({ class: "rui-filelist-empty" }, props.empty ?? "No files"),
    }),
  );
}
