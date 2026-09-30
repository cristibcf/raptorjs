/** Date and time. */
import { state } from "raptorjs/dom";
import { Calendar, type CalendarDate, DatePicker, DateRangePicker, DateTimePicker, MonthPicker, TimePicker, type TimeValue, YearPicker, formatDate, formatTime, isoOf, today } from "raptorjs/ui/date";
import type { CatalogGroup } from "./types.ts";

const show = (d: CalendarDate | null): string => (d ? isoOf(d) : "null");

export const DATE: CatalogGroup = {
  slug: "date",
  title: "Date & time",
  blurb:
    "Dates are plain `{ y, m, d }` objects with months 1–12 — not `Date`, whose zero-based months and local-timezone surprises cause most calendar bugs.",
  items: [
    {
      slug: "calendar",
      name: "Calendar",
      tier: "T2",
      summary:
        "A month grid with roving focus: one cell is tabbable, arrows move day by day, PageUp/PageDown change the month. Show several months side by side with `months`.",
      code: `const day = state<CalendarDate | null>(today());
Calendar({ value: day, weekStart: 1, locale: "en-GB" });`,
      props: [
        { name: "value", type: "State<CalendarDate | null>", desc: "The selected day." },
        { name: "range", type: "State<[CalendarDate | null, CalendarDate | null]>", desc: "Interval selection instead of a single day." },
        { name: "month", type: "State<{ y, m }>", desc: "The displayed month, if you want to control it." },
        { name: "min / max / disabled", type: "CalendarDate / predicate", desc: "Which days can be chosen." },
        { name: "weekStart", type: "number", desc: "0 Sunday, 1 Monday (default)." },
      ],
      demo: () => {
        const day = state<CalendarDate | null>(today());
        return (
          <div class="cmp-row" style="align-items:flex-start">
            {Calendar({ value: day, locale: "en-GB", label: "Pick a day" })}
            <span class="chip">
              value = <b>{() => show(day())}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "date-picker",
      name: "DatePicker",
      tier: "T1",
      summary: "A field plus a calendar in a popover, positioned so it never falls off the screen.",
      code: `DatePicker({ value: due, label: "Due date", locale: "en-GB" });`,
      demo: () => {
        const due = state<CalendarDate | null>(null);
        return (
          <div class="cmp-row">
            {DatePicker({ value: due, label: "Due date", locale: "en-GB", placeholder: "Pick a date" })}
            <span class="chip">
              {() => (due() ? formatDate(due()!, "en-GB", { dateStyle: "medium" }) : "nothing selected")}
            </span>
          </div>
        );
      },
    },
    {
      slug: "date-range-picker",
      name: "DateRangePicker",
      tier: "T2",
      summary: "Two ends of an interval, with two months shown at once and the days in between highlighted as you move.",
      code: `const range = state<readonly [CalendarDate | null, CalendarDate | null]>([null, null]);
DateRangePicker({ value: range, months: 2 });`,
      demo: () => {
        const range = state<readonly [CalendarDate | null, CalendarDate | null]>([null, null]);
        return (
          <div class="cmp-row">
            {DateRangePicker({ value: range, months: 2, label: "Stay", locale: "en-GB" })}
            <span class="chip">
              {() => show(range()[0])} → {() => show(range()[1])}
            </span>
          </div>
        );
      },
    },
    {
      slug: "time-picker",
      name: "TimePicker",
      tier: "T2",
      summary: "Hours, minutes and optionally seconds as separate segments, each one steppable with the arrow keys.",
      code: `const at = state<TimeValue | null>({ h: 9, min: 30 });
TimePicker({ value: at, step: 15 });`,
      demo: () => {
        const at = state<TimeValue | null>({ h: 9, min: 30 });
        const at12 = state<TimeValue | null>({ h: 14, min: 0 });
        return (
          <div class="cmp-row">
            {TimePicker({ value: at, step: 15, label: "24h" })}
            {TimePicker({ value: at12, hour12: true, seconds: true, label: "12h with seconds" })}
            <span class="chip">{() => (at() ? formatTime(at()!) : "—")}</span>
          </div>
        );
      },
    },
    {
      slug: "date-time-picker",
      name: "DateTimePicker",
      tier: "T3",
      summary: "A date and a time as two signals side by side, so each half stays independently valid.",
      code: `DateTimePicker({ date, time, hour12: false });`,
      demo: () => {
        const date = state<CalendarDate | null>(today());
        const time = state<TimeValue | null>({ h: 18, min: 0 });
        return (
          <div class="cmp-row">
            {DateTimePicker({ date, time, locale: "en-GB", label: "Starts" })}
            <span class="chip">
              {() => show(date())} {() => (time() ? formatTime(time()!) : "")}
            </span>
          </div>
        );
      },
    },
    {
      slug: "month-picker",
      name: "MonthPicker",
      tier: "T3",
      summary: "Twelve months in a grid — for reports and billing periods, where a day would be noise.",
      code: `MonthPicker({ value: period, locale: "en-GB" });`,
      demo: () => {
        const period = state<{ y: number; m: number } | null>({ y: today().y, m: today().m });
        return (
          <div class="cmp-row" style="align-items:flex-start">
            {MonthPicker({ value: period, locale: "en-GB", label: "Period" })}
            <span class="chip">{() => (period() ? period()!.y + "-" + String(period()!.m).padStart(2, "0") : "—")}</span>
          </div>
        );
      },
    },
    {
      slug: "year-picker",
      name: "YearPicker",
      tier: "T3",
      summary: "A page of years with bounds — the last step of a birth-date field, or a fiscal-year switch.",
      code: `YearPicker({ value: year, min: 1950, max: 2030 });`,
      demo: () => {
        const year = state<number | null>(today().y);
        return (
          <div class="cmp-row" style="align-items:flex-start">
            {YearPicker({ value: year, min: 2000, max: 2035, label: "Year" })}
            <span class="chip">
              value = <b>{() => String(year() ?? "null")}</b>
            </span>
          </div>
        );
      },
    },
  ],
};
