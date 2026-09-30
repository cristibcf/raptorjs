/**
 * Calendar / DatePicker / DateRangePicker / TimePicker.
 *
 * Zero dependencies: no date-fns, no luxon. Formatting and day names come from
 * `Intl`, which is in the runtime, not in `node_modules`.
 *
 * **The trap we avoid everywhere:** `new Date("2026-03-15")` is parsed as UTC
 * and, in a timezone west of Greenwich, yields March 14. That's why we work with
 * `{ y, m, d }` triples and build a `Date` only through `new Date(y, m, d)`,
 * which is local. Day arithmetic never uses "+ 86400000" - a day isn't always
 * 24h (daylight saving time).
 */
import { state, derived, effect, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { clickOutside } from "./primitives/click-outside.ts";
import { positioner, type Placement } from "./primitives/positioner.ts";
import { focus, type El } from "./primitives/env.ts";
import { isolate } from "./primitives/isolate.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

/** A calendar day, without time and without timezone. */
export interface CalendarDate {
  y: number;
  /** Month 1-12 (NOT 0-11 like in `Date`). */
  m: number;
  d: number;
}

export function toDate(value: CalendarDate): Date {
  return new Date(value.y, value.m - 1, value.d);
}

export function fromDate(value: Date): CalendarDate {
  return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
}

export function today(): CalendarDate {
  return fromDate(new Date());
}

export function sameDay(a: CalendarDate | null, b: CalendarDate | null): boolean {
  if (!a || !b) return false;
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** Ordering: negative if `a` is before `b`. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

/** Adds days by going through `Date`, so it doesn't get daylight saving wrong. */
export function addDays(value: CalendarDate, days: number): CalendarDate {
  const d = toDate(value);
  d.setDate(d.getDate() + days);
  return fromDate(d);
}

export function addMonths(value: CalendarDate, months: number): CalendarDate {
  const target = new Date(value.y, value.m - 1 + months, 1);
  // January 31 + 1 month doesn't exist in February: we clamp to the last day.
  const last = daysInMonth(target.getFullYear(), target.getMonth() + 1);
  return { y: target.getFullYear(), m: target.getMonth() + 1, d: Math.min(value.d, last) };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function isoOf(value: CalendarDate): string {
  return `${value.y}-${String(value.m).padStart(2, "0")}-${String(value.d).padStart(2, "0")}`;
}

/** Parses `YYYY-MM-DD` without going through UTC. */
export function parseIso(text: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

export function formatDate(value: CalendarDate, locale?: string, options?: Intl.DateTimeFormatOptions): string {
  return formatter(locale, options ?? { year: "numeric", month: "long", day: "numeric" }).format(toDate(value));
}

/** The short day names, starting from `weekStart` (0 = Sunday). */
export function weekdayNames(locale: string | undefined, weekStart: number): string[] {
  const fmt = formatter(locale, { weekday: "short" });
  const out: string[] = [];
  // 2024-01-07 is a Sunday; we count from there.
  for (let i = 0; i < 7; i++) {
    out.push(fmt.format(new Date(2024, 0, 7 + ((weekStart + i) % 7))));
  }
  return out;
}

export interface CalendarCell {
  date: CalendarDate;
  /** `false` for the filler days from the neighboring month. */
  inMonth: boolean;
}

/** The 6-week grid of a month, with neighboring days as filler. */
export function monthGrid(y: number, m: number, weekStart = 1): CalendarCell[] {
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const start = addDays({ y, m, d: 1 }, -offset);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    cells.push({ date, inMonth: date.m === m && date.y === y });
  }
  return cells;
}

/* -------------------------------------------------------------- Calendar -- */

export interface CalendarProps {
  /** The selected day. */
  value?: State<CalendarDate | null>;
  /** For a range: the selected endpoints. */
  range?: State<readonly [CalendarDate | null, CalendarDate | null]>;
  /** The displayed month. If omitted, it's held internally. */
  month?: State<{ y: number; m: number }>;
  min?: CalendarDate;
  max?: CalendarDate;
  disabled?: (date: CalendarDate) => boolean;
  /** 0 = Sunday, 1 = Monday (default). */
  weekStart?: number;
  locale?: string;
  /** Number of months shown side by side. Default 1. */
  months?: number;
  onSelect?: (date: CalendarDate) => void;
  label?: string;
  class?: string;
}

export interface CalendarHandle {
  el: El;
  /** The day that has focus in the grid (roving tabindex). */
  focused: Accessor<CalendarDate>;
  goto: (month: { y: number; m: number }) => void;
}

export function calendar(props: CalendarProps): CalendarHandle {
  const id = "rui-cal-" + ++idSeq;
  const weekStart = props.weekStart ?? 1;
  const monthCount = props.months ?? 1;
  const now = today();

  const initialMonth = (): { y: number; m: number } => {
    const selected = props.value?.peek() ?? props.range?.peek()[0] ?? null;
    return selected ? { y: selected.y, m: selected.m } : { y: now.y, m: now.m };
  };

  const month = props.month ?? state(initialMonth());
  const focused = state<CalendarDate>(props.value?.peek() ?? props.range?.peek()[0] ?? now);
  const cells = new Map<string, El>();

  const outOfBounds = (date: CalendarDate): boolean => {
    if (props.min && compareDates(date, props.min) < 0) return true;
    if (props.max && compareDates(date, props.max) > 0) return true;
    return props.disabled?.(date) === true;
  };

  const inRange = (date: CalendarDate): boolean => {
    const r = props.range?.();
    if (!r || !r[0] || !r[1]) return false;
    return compareDates(date, r[0]) >= 0 && compareDates(date, r[1]) <= 0;
  };

  const isSelected = (date: CalendarDate): boolean => {
    if (props.value) return sameDay(props.value(), date);
    const r = props.range?.();
    return sameDay(r?.[0] ?? null, date) || sameDay(r?.[1] ?? null, date);
  };

  const select = (date: CalendarDate): void => {
    if (outOfBounds(date)) return;
    if (props.value) props.value.set(date);
    if (props.range) {
      props.range.update(([from, to]) => {
        // First click or an already complete range => start over from scratch.
        if (!from || to) return [date, null];
        return compareDates(date, from) < 0 ? [date, from] : [from, date];
      });
    }
    props.onSelect?.(date);
  };

  const goto = (next: { y: number; m: number }): void => month.set(next);

  const shiftMonth = (delta: number): void => {
    const current = month.peek();
    const next = addMonths({ y: current.y, m: current.m, d: 1 }, delta);
    month.set({ y: next.y, m: next.m });
  };

  /** Moves focus and brings the correct month into view. */
  const moveFocus = (next: CalendarDate): void => {
    focused.set(next);
    const current = month.peek();
    const firstVisible = current.y * 12 + current.m;
    const target = next.y * 12 + next.m;
    if (target < firstVisible || target > firstVisible + monthCount - 1) {
      month.set({ y: next.y, m: next.m });
    }
    // The DOM focus is requested after the grid has updated.
    queueMicrotask(() => focus(cells.get(isoOf(next))));
  };

  const onKeydown = (e: any): void => {
    const current = focused.peek();
    let next: CalendarDate | null = null;
    switch (e.key) {
      case "ArrowLeft": next = addDays(current, -1); break;
      case "ArrowRight": next = addDays(current, 1); break;
      case "ArrowUp": next = addDays(current, -7); break;
      case "ArrowDown": next = addDays(current, 7); break;
      case "Home": next = { ...current, d: 1 }; break;
      case "End": next = { ...current, d: daysInMonth(current.y, current.m) }; break;
      case "PageUp": next = addMonths(current, e.shiftKey ? -12 : -1); break;
      case "PageDown": next = addMonths(current, e.shiftKey ? 12 : 1); break;
      case "Enter":
      case " ":
        e.preventDefault?.();
        select(current);
        return;
      default:
        return;
    }
    e.preventDefault?.();
    moveFocus(next);
  };

  const names = weekdayNames(props.locale, weekStart);
  const titleFmt = formatter(props.locale, { month: "long", year: "numeric" });
  const dayFmt = formatter(props.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  function monthPanel(offset: number): El {
    const shown = derived(() => {
      const current = month();
      const shifted = addMonths({ y: current.y, m: current.m, d: 1 }, offset);
      return { y: shifted.y, m: shifted.m };
    });

    return R.div(
      { class: "rui-cal-month" },
      R.div(
        { class: "rui-cal-title", "aria-live": "polite" },
        () => titleFmt.format(new Date(shown().y, shown().m - 1, 1)),
      ),
      R.table(
        { class: "rui-cal-grid", role: "grid", "aria-labelledby": id + "-title" },
        R.thead(
          {},
          R.tr(
            {},
            names.map((name) =>
              R.th({ class: "rui-cal-weekday", scope: "col", abbr: name }, name),
            ),
          ),
        ),
        R.tbody(
          {},
          () => {
            const { y, m } = shown();
            const grid = monthGrid(y, m, weekStart);
            const rows: El[] = [];
            for (let w = 0; w < 6; w++) {
              const week = grid.slice(w * 7, w * 7 + 7);
              // The last week is empty when the month fits in 5: don't render it.
              if (week.every((c) => !c.inMonth)) continue;
              rows.push(
                R.tr(
                  { class: "rui-cal-week" },
                  week.map((cell) => {
                    const off = outOfBounds(cell.date);
                    const iso = isoOf(cell.date);
                    return R.td(
                      { class: "rui-cal-cell", role: "gridcell" },
                      R.button({
                        type: "button",
                        class: () => {
                          let cls = "rui-cal-day";
                          if (!cell.inMonth) cls += " rui-outside";
                          if (isSelected(cell.date)) cls += " rui-selected";
                          if (inRange(cell.date)) cls += " rui-in-range";
                          if (sameDay(cell.date, now)) cls += " rui-today";
                          return cls;
                        },
                        disabled: off,
                        // Roving tabindex: only a single day is tabbable in the whole grid.
                        tabindex: () => (sameDay(focused(), cell.date) ? "0" : "-1"),
                        "aria-selected": () => String(isSelected(cell.date)),
                        "aria-current": sameDay(cell.date, now) ? "date" : undefined,
                        // The full day name: "3" on its own says nothing.
                        "aria-label": dayFmt.format(toDate(cell.date)),
                        ref: (el: El) => {
                          if (el) cells.set(iso, el);
                        },
                        "on:click": () => {
                          focused.set(cell.date);
                          select(cell.date);
                        },
                      }, String(cell.date.d)),
                    );
                  }),
                ),
              );
            }
            return rows;
          },
        ),
      ),
    );
  }

  const panels: El[] = [];
  for (let i = 0; i < monthCount; i++) panels.push(monthPanel(i));

  const el = R.div(
    {
      class: props.class ? "rui-calendar " + props.class : "rui-calendar",
      ...(props.label ? { "aria-label": props.label } : {}),
      "on:keydown": onKeydown,
    },
    R.div(
      { class: "rui-cal-head" },
      R.button({ type: "button", class: "rui-cal-nav", "aria-label": "Previous month", "on:click": () => shiftMonth(-1) }, "‹"),
      R.span({ id: id + "-title", class: "rui-sr-only" }, props.label ?? "Calendar"),
      R.button({ type: "button", class: "rui-cal-nav", "aria-label": "Next month", "on:click": () => shiftMonth(1) }, "›"),
    ),
    R.div({ class: "rui-cal-months" }, panels),
  );

  return { el, focused: () => focused(), goto };
}

export function Calendar(props: CalendarProps): El {
  return calendar(props).el;
}

/* ------------------------------------------------------------ DatePicker -- */

export interface DatePickerProps {
  value: State<CalendarDate | null>;
  min?: CalendarDate;
  max?: CalendarDate;
  disabled?: (date: CalendarDate) => boolean;
  locale?: string;
  weekStart?: number;
  placeholder?: string;
  placement?: Placement;
  label?: string;
  id?: string;
  class?: string;
}

export interface DatePickerHandle {
  el: El;
  open: Accessor<boolean>;
}

/**
 * DatePicker - an input with a calendar.
 *
 * The input also accepts direct typing in ISO format. Typing isn't blocked in
 * real time: we validate on `blur`, so we don't prevent typing "2026-0".
 */
export function datePicker(props: DatePickerProps): DatePickerHandle {
  const id = props.id ?? "rui-dp-" + ++idSeq;
  const open = state(false);
  const text = state(props.value.peek() ? isoOf(props.value.peek()!) : "");
  let triggerEl: El = null;

  const pos = positioner({ placement: props.placement ?? "bottom-start", enabled: () => open() });

  const cal = calendar({
    value: props.value,
    min: props.min,
    max: props.max,
    disabled: props.disabled,
    locale: props.locale,
    weekStart: props.weekStart,
    onSelect: (date) => {
      text.set(isoOf(date));
      open.set(false);
      focus(triggerEl);
    },
  });

  const commitText = (): void => {
    const raw = text.peek();
    if (raw === "") {
      props.value.set(null);
      return;
    }
    const parsed = parseIso(raw);
    if (parsed) props.value.set(parsed);
    // Invalid text: restore what was there, instead of silently clearing the value.
    else text.set(props.value.peek() ? isoOf(props.value.peek()!) : "");
  };

  const el = R.div(
    {
      class: props.class ? "rui-datepicker " + props.class : "rui-datepicker",
      ref: (node: El) => {
        clickOutside(() => open.set(false), { enabled: () => open() })(node);
        pos.reference(node);
      },
    },
    R.div(
      { class: "rui-datepicker-row" },
      R.input({
        id,
        type: "text",
        class: "rui-input-control",
        inputmode: "numeric",
        placeholder: props.placeholder ?? "YYYY-MM-DD",
        ...(props.label ? { "aria-label": props.label } : {}),
        value: () => text(),
        "on:input": (e: any) => text.set(String(e.target?.value ?? "")),
        "on:blur": commitText,
        "on:keydown": (e: any) => {
          if (e.key === "Enter") {
            e.preventDefault?.();
            commitText();
          } else if (e.key === "ArrowDown" && !open()) {
            e.preventDefault?.();
            open.set(true);
          } else if (e.key === "Escape" && open()) {
            e.preventDefault?.();
            open.set(false);
          }
        },
      }),
      R.button({
        type: "button",
        class: "rui-datepicker-toggle",
        "aria-label": "Open the calendar",
        "aria-haspopup": "dialog",
        "aria-expanded": () => String(open()),
        ref: (node: El) => {
          triggerEl = node;
        },
        "on:click": (e: any) => {
          e.stopPropagation?.();
          open.set(!open.peek());
        },
      }, "▦"),
    ),
    Show({
      when: () => open(),
      children: R.div(
        {
          class: "rui-datepicker-pop",
          role: "dialog",
          "aria-label": "Choose a date",
          ref: pos.floating,
          style: () => pos.style(),
        },
        cal.el,
      ),
    }),
  );

  // A value changed from the outside (a form reset, a load from the server) is
  // reflected in the text. `peek` on the comparison, so the effect depends only
  // on `props.value`, not on its own write.
  effect(() => {
    const v = props.value();
    const next = v ? isoOf(v) : "";
    if (next !== text.peek()) text.set(next);
  });

  return { el, open: () => open() };
}

export function DatePicker(props: DatePickerProps): El {
  // Construction doesn't subscribe the caller's computation; see `isolate`.
  return isolate(() => DatePickerImpl(props));
}

function DatePickerImpl(props: DatePickerProps): El {
  return datePicker(props).el;
}

/* ------------------------------------------------------- DateRangePicker -- */

export interface DateRangePickerProps extends Omit<DatePickerProps, "value"> {
  value: State<readonly [CalendarDate | null, CalendarDate | null]>;
  /** How many months are shown at once. Default 2. */
  months?: number;
}

export function DateRangePicker(props: DateRangePickerProps): El {
  // Construction doesn't subscribe the caller's computation; see `isolate`.
  return isolate(() => DateRangePickerImpl(props));
}

function DateRangePickerImpl(props: DateRangePickerProps): El {
  const open = state(false);
  let triggerEl: El = null;
  const pos = positioner({ placement: props.placement ?? "bottom-start", enabled: () => open() });

  const cal = calendar({
    range: props.value,
    min: props.min,
    max: props.max,
    disabled: props.disabled,
    locale: props.locale,
    weekStart: props.weekStart,
    months: props.months ?? 2,
  });

  const label = derived(() => {
    const [from, to] = props.value();
    if (!from) return props.placeholder ?? "Choose a range";
    const a = formatDate(from, props.locale, { day: "numeric", month: "short", year: "numeric" });
    if (!to) return a + " → …";
    return a + " → " + formatDate(to, props.locale, { day: "numeric", month: "short", year: "numeric" });
  });

  return R.div(
    {
      class: props.class ? "rui-daterange " + props.class : "rui-daterange",
      ref: (node: El) => {
        clickOutside(() => open.set(false), { enabled: () => open() })(node);
        pos.reference(node);
      },
    },
    R.button({
      type: "button",
      class: "rui-daterange-trigger",
      "aria-haspopup": "dialog",
      "aria-expanded": () => String(open()),
      ...(props.label ? { "aria-label": props.label } : {}),
      ref: (node: El) => {
        triggerEl = node;
      },
      "on:click": (e: any) => {
        e.stopPropagation?.();
        open.set(!open.peek());
      },
    }, () => label()),
    Show({
      when: () => open(),
      children: R.div(
        {
          class: "rui-daterange-pop",
          role: "dialog",
          "aria-label": "Choose the range",
          ref: pos.floating,
          style: () => pos.style(),
        },
        cal.el,
      ),
    }),
  );
}

/* ------------------------------------------------------------ TimePicker -- */

export interface TimeValue {
  h: number;
  min: number;
  s?: number;
}

export interface TimePickerProps {
  value: State<TimeValue | null>;
  /** Step in minutes for the arrows. Default 1. */
  step?: number;
  /** Include the seconds. */
  seconds?: boolean;
  /** 12h format with AM/PM. Default 24h. */
  hour12?: boolean;
  disabled?: Accessor<boolean> | boolean;
  label?: string;
  id?: string;
  class?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatTime(value: TimeValue, hour12 = false, seconds = false): string {
  if (hour12) {
    const suffix = value.h < 12 ? "AM" : "PM";
    const h = value.h % 12 === 0 ? 12 : value.h % 12;
    return `${h}:${pad(value.min)}${seconds ? ":" + pad(value.s ?? 0) : ""} ${suffix}`;
  }
  return `${pad(value.h)}:${pad(value.min)}${seconds ? ":" + pad(value.s ?? 0) : ""}`;
}

/**
 * TimePicker - separate fields for hour, minute, second.
 *
 * Segments, not a single `<input type="time">`: that one looks different in
 * every browser and can't be styled. Each segment is a `spinbutton` that wraps
 * at the ends (23 → 00), the way anyone who has used a clock expects.
 */
export function TimePicker(props: TimePickerProps): El {
  const id = props.id ?? "rui-tp-" + ++idSeq;
  const step = props.step ?? 1;
  const withSeconds = props.seconds === true;

  const current = (): TimeValue => props.value() ?? { h: 0, min: 0, s: 0 };
  const off = (): boolean =>
    typeof props.disabled === "function" ? props.disabled() : props.disabled === true;

  const write = (next: TimeValue): void => {
    if (off()) return;
    props.value.set(next);
  };

  const segment = (
    kind: "h" | "min" | "s",
    max: number,
    stepSize: number,
    name: string,
  ): El => {
    const read = (): number => {
      const v = current();
      return kind === "h" ? v.h : kind === "min" ? v.min : (v.s ?? 0);
    };
    const set = (raw: number): void => {
      // Wrap at the ends: after 23 comes 00, it doesn't stop.
      const wrapped = ((raw % (max + 1)) + (max + 1)) % (max + 1);
      const v = current();
      write(kind === "h" ? { ...v, h: wrapped } : kind === "min" ? { ...v, min: wrapped } : { ...v, s: wrapped });
    };

    return R.input({
      class: "rui-time-seg rui-tabular",
      type: "text",
      inputmode: "numeric",
      maxlength: "2",
      role: "spinbutton",
      "aria-label": name,
      "aria-valuemin": "0",
      "aria-valuemax": String(max),
      "aria-valuenow": () => String(read()),
      "aria-valuetext": () => pad(read()),
      disabled: () => off(),
      value: () => pad(read()),
      "on:input": (e: any) => {
        const digits = String(e.target?.value ?? "").replace(/\D/g, "").slice(-2);
        if (digits === "") return;
        const n = Number(digits);
        if (n <= max) set(n);
      },
      "on:keydown": (e: any) => {
        if (e.key === "ArrowUp") {
          e.preventDefault?.();
          set(read() + stepSize);
        } else if (e.key === "ArrowDown") {
          e.preventDefault?.();
          set(read() - stepSize);
        } else if (e.key === "Home") {
          e.preventDefault?.();
          set(0);
        } else if (e.key === "End") {
          e.preventDefault?.();
          set(max);
        }
      },
    });
  };

  return R.div(
    {
      id,
      class: props.class ? "rui-time " + props.class : "rui-time",
      role: "group",
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    segment("h", 23, 1, "Hours"),
    R.span({ class: "rui-time-sep", "aria-hidden": "true" }, ":"),
    segment("min", 59, step, "Minutes"),
    withSeconds ? R.span({ class: "rui-time-sep", "aria-hidden": "true" }, ":") : null,
    withSeconds ? segment("s", 59, 1, "Seconds") : null,
    props.hour12
      ? R.button({
          type: "button",
          class: "rui-time-ampm",
          "aria-label": "Toggle AM/PM",
          disabled: () => off(),
          "on:click": () => {
            const v = current();
            write({ ...v, h: (v.h + 12) % 24 });
          },
        }, () => (current().h < 12 ? "AM" : "PM"))
      : null,
  );
}

/* ------------------------------ DateTimePicker / MonthPicker / YearPicker */

export interface DateTimePickerProps {
  date: State<CalendarDate | null>;
  time: State<TimeValue | null>;
  seconds?: boolean;
  hour12?: boolean;
  locale?: string;
  label?: string;
  class?: string;
}

/** Calendar + clock, with a readable summary of the chosen value. */
export function DateTimePicker(props: DateTimePickerProps): El {
  const summary = derived(() => {
    const d = props.date();
    const t = props.time();
    if (!d) return "No date chosen";
    return isoOf(d) + (t ? " " + formatTime(t, props.hour12, props.seconds) : "");
  });

  return R.div(
    {
      class: props.class ? "rui-datetime " + props.class : "rui-datetime",
      role: "group",
      "aria-label": props.label ?? "Date and time",
    },
    Calendar({ value: props.date, locale: props.locale }),
    R.div(
      { class: "rui-datetime-time" },
      TimePicker({ value: props.time, seconds: props.seconds, hour12: props.hour12, label: "Time" }),
    ),
    R.div({ class: "rui-datetime-summary", "aria-live": "polite" }, () => summary()),
  );
}

export interface MonthPickerProps {
  value: State<{ y: number; m: number } | null>;
  min?: { y: number; m: number };
  max?: { y: number; m: number };
  locale?: string;
  label?: string;
  class?: string;
}

/** A 12-month grid, with year navigation. */
export function MonthPicker(props: MonthPickerProps): El {
  const year = state(props.value.peek()?.y ?? new Date().getFullYear());

  const names = (): string[] => {
    try {
      const fmt = new Intl.DateTimeFormat(props.locale, { month: "short" });
      return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2024, i, 1)));
    } catch {
      return Array.from({ length: 12 }, (_, i) => String(i + 1));
    }
  };

  const blocked = (m: number): boolean => {
    const y = year();
    if (props.min && (y < props.min.y || (y === props.min.y && m < props.min.m))) return true;
    if (props.max && (y > props.max.y || (y === props.max.y && m > props.max.m))) return true;
    return false;
  };

  return R.div(
    {
      class: props.class ? "rui-monthpicker " + props.class : "rui-monthpicker",
      role: "group",
      "aria-label": props.label ?? "Choose the month",
    },
    R.div(
      { class: "rui-monthpicker-head" },
      R.button({ type: "button", class: "rui-cal-nav", "aria-label": "Previous year", "on:click": () => year.update((y) => y - 1) }, "‹"),
      R.span({ class: "rui-monthpicker-year", "aria-live": "polite" }, () => String(year())),
      R.button({ type: "button", class: "rui-cal-nav", "aria-label": "Next year", "on:click": () => year.update((y) => y + 1) }, "›"),
    ),
    R.div(
      { class: "rui-monthpicker-grid" },
      () =>
        names().map((name, i) => {
          const m = i + 1;
          return R.button({
            type: "button",
            class: () =>
              "rui-monthpicker-month" +
              (props.value()?.y === year() && props.value()?.m === m ? " rui-selected" : ""),
            "aria-pressed": () => String(props.value()?.y === year() && props.value()?.m === m),
            disabled: blocked(m),
            "on:click": () => props.value.set({ y: year(), m }),
          }, name);
        }),
    ),
  );
}

export interface YearPickerProps {
  value: State<number | null>;
  min?: number;
  max?: number;
  /** How many years are shown per page. Default 12. */
  pageSize?: number;
  label?: string;
  class?: string;
}

/** A grid of years, paginated. */
export function YearPicker(props: YearPickerProps): El {
  const size = props.pageSize ?? 12;
  const anchor = state(
    Math.floor((props.value.peek() ?? new Date().getFullYear()) / size) * size,
  );

  const years = derived(() => Array.from({ length: size }, (_, i) => anchor() + i));

  return R.div(
    {
      class: props.class ? "rui-yearpicker " + props.class : "rui-yearpicker",
      role: "group",
      "aria-label": props.label ?? "Choose the year",
    },
    R.div(
      { class: "rui-monthpicker-head" },
      R.button({ type: "button", class: "rui-cal-nav", "aria-label": "Previous years", "on:click": () => anchor.update((a) => a - size) }, "‹"),
      R.span({ class: "rui-monthpicker-year", "aria-live": "polite" }, () => anchor() + " – " + (anchor() + size - 1)),
      R.button({ type: "button", class: "rui-cal-nav", "aria-label": "Next years", "on:click": () => anchor.update((a) => a + size) }, "›"),
    ),
    R.div(
      { class: "rui-monthpicker-grid" },
      For({
        each: () => years(),
        children: (year: number) =>
          R.button({
            type: "button",
            class: () => "rui-monthpicker-month" + (props.value() === year ? " rui-selected" : ""),
            "aria-pressed": () => String(props.value() === year),
            disabled:
              (props.min !== undefined && year < props.min) ||
              (props.max !== undefined && year > props.max),
            "on:click": () => props.value.set(year),
          }, String(year)),
      }),
    ),
  );
}
