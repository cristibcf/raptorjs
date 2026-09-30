import { test } from "node:test";
import assert from "node:assert/strict";
import { installMiniDom, resetStats, stats, type MiniElement } from "raptorjs/dom/testing";
import { render, R } from "raptorjs/dom";
import { state, createRoot } from "raptorjs";
import {
  addDays, addMonths, daysInMonth, parseIso, isoOf, monthGrid, compareDates, sameDay,
  calendar, datePicker, DateRangePicker, TimePicker, formatTime, type CalendarDate,
} from "../../src/ui/date.ts";
import { Breadcrumbs, Pagination, paginationRange, Stepper, SidebarNav, AppShell, NavigationMenu } from "../../src/ui/navigation.ts";
import { treeView, listView, multiSelect, autocomplete, commandPalette } from "../../src/ui/data-views.ts";
import { validateFiles, matchesAccept, formatSize, FileInput, dropzone, FileList } from "../../src/ui/files.ts";
import { Drawer, ContextMenu, Notification, Backdrop, ErrorBoundary } from "../../src/ui/overlay-extra.ts";
import { scaleLinear, scaleBand, niceTicks, extent, LineChart, BarChart, AreaChart } from "../../src/ui/chart.ts";

const doc = installMiniDom() as any;
(globalThis as any).document = doc;

function div(): MiniElement {
  return doc.createElement("div") as MiniElement;
}
function mount(build: () => unknown): MiniElement {
  const root = div();
  render(build as any, root);
  return root;
}
function clearBody(): void {
  for (const child of doc.body.childNodes.slice()) doc.body.removeChild(child);
}
const byRole = (root: MiniElement, tag: string, role: string): MiniElement | undefined =>
  root.querySelectorAll(tag).find((e) => e.getAttribute("role") === role);
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ------------------------------------------------------------ date math -- */

test("date arithmetic doesn't go through UTC and doesn't break at month ends", () => {
  // The classic trap: `new Date("2026-03-15")` is UTC.
  assert.deepEqual(parseIso("2026-03-15"), { y: 2026, m: 3, d: 15 });
  assert.equal(isoOf({ y: 2026, m: 3, d: 5 }), "2026-03-05");

  assert.deepEqual(addDays({ y: 2026, m: 1, d: 31 }, 1), { y: 2026, m: 2, d: 1 });
  assert.deepEqual(addDays({ y: 2026, m: 1, d: 1 }, -1), { y: 2025, m: 12, d: 31 });

  // January 31 + 1 month doesn't exist in February.
  assert.deepEqual(addMonths({ y: 2026, m: 1, d: 31 }, 1), { y: 2026, m: 2, d: 28 });
  assert.deepEqual(addMonths({ y: 2024, m: 1, d: 31 }, 1), { y: 2024, m: 2, d: 29 }, "leap year");

  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
});

test("parseIso rejects impossible dates", () => {
  assert.equal(parseIso("2026-02-30"), null);
  assert.equal(parseIso("2026-13-01"), null);
  assert.equal(parseIso("not-a-date"), null);
  assert.equal(parseIso("2026-1-1"), null, "requires zero-padding");
});

test("monthGrid fills complete weeks with neighboring days", () => {
  const grid = monthGrid(2026, 3, 1); // March 2026, week starts Monday
  assert.equal(grid.length, 42);
  const inMonth = grid.filter((c) => c.inMonth);
  assert.equal(inMonth.length, 31);
  assert.deepEqual(inMonth[0]!.date, { y: 2026, m: 3, d: 1 });
  // The first cell is from February (filler).
  assert.equal(grid[0]!.inMonth, false);
});

test("compareDates and sameDay", () => {
  assert.ok(compareDates({ y: 2026, m: 1, d: 1 }, { y: 2026, m: 2, d: 1 }) < 0);
  assert.equal(compareDates({ y: 2026, m: 5, d: 9 }, { y: 2026, m: 5, d: 9 }), 0);
  assert.equal(sameDay({ y: 2026, m: 5, d: 9 }, { y: 2026, m: 5, d: 9 }), true);
  assert.equal(sameDay(null, { y: 2026, m: 5, d: 9 }), false);
});

/* -------------------------------------------------------------- Calendar -- */

test("Calendar: grid ARIA, roving tabindex, selection", () => {
  const value = state<CalendarDate | null>({ y: 2026, m: 3, d: 10 });
  const cal = createRoot(() => calendar({ value, month: state({ y: 2026, m: 3 }) }));
  const root = mount(() => cal.el);

  assert.ok(byRole(root, "table", "grid"));
  const days = root.querySelectorAll("button").filter((b) => (b.getAttribute("class") ?? "").includes("rui-cal-day"));
  assert.ok(days.length >= 28);

  // Only a single button is tabbable in the whole grid.
  assert.equal(days.filter((d) => d.getAttribute("tabindex") === "0").length, 1);

  // The day has a full name, not just the number.
  const tenth = days.find((d) => d.textContent === "10")!;
  assert.ok((tenth.getAttribute("aria-label") ?? "").length > 3);

  days.find((d) => d.textContent === "15")!.click();
  assert.deepEqual(value(), { y: 2026, m: 3, d: 15 });
});

test("Calendar: the arrows move focus, min/max block", () => {
  const value = state<CalendarDate | null>(null);
  const cal = createRoot(() =>
    calendar({
      value,
      month: state({ y: 2026, m: 3 }),
      min: { y: 2026, m: 3, d: 5 },
      max: { y: 2026, m: 3, d: 20 },
    }),
  );
  const root = mount(() => cal.el);
  const container = root.querySelector("div")!;

  const days = () => root.querySelectorAll("button").filter((b) => (b.getAttribute("class") ?? "").includes("rui-cal-day"));
  assert.equal(days().find((d) => d.textContent === "1")!.getAttribute("disabled"), "", "below min");
  assert.equal(days().find((d) => d.textContent === "25")!.getAttribute("disabled"), "", "above max");

  days().find((d) => d.textContent === "10")!.click();
  assert.deepEqual(value(), { y: 2026, m: 3, d: 10 });

  container.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.deepEqual(cal.focused(), { y: 2026, m: 3, d: 11 });
  container.dispatch("keydown", { key: "ArrowDown", preventDefault() {} });
  assert.deepEqual(cal.focused(), { y: 2026, m: 3, d: 18 });
});

test("Calendar in range mode: the second click completes, the third restarts", () => {
  const range = state<readonly [CalendarDate | null, CalendarDate | null]>([null, null]);
  const cal = createRoot(() => calendar({ range, month: state({ y: 2026, m: 3 }) }));
  const root = mount(() => cal.el);
  const day = (n: string) => root.querySelectorAll("button").find((b) => b.textContent === n && (b.getAttribute("class") ?? "").includes("rui-cal-day"))!;

  day("10").click();
  assert.deepEqual(range()[0], { y: 2026, m: 3, d: 10 });
  assert.equal(range()[1], null);

  day("5").click();
  assert.deepEqual(range(), [{ y: 2026, m: 3, d: 5 }, { y: 2026, m: 3, d: 10 }], "sorted ascending");

  day("20").click();
  assert.deepEqual(range()[0], { y: 2026, m: 3, d: 20 });
  assert.equal(range()[1], null, "complete range => restarts");
});

test("DatePicker: valid text confirms, invalid text is restored", () => {
  const value = state<CalendarDate | null>({ y: 2026, m: 3, d: 1 });
  const dp = createRoot(() => datePicker({ value }));
  const root = mount(() => dp.el);
  const input = root.querySelector("input")!;

  assert.equal(input.getAttribute("value"), "2026-03-01");

  input.dispatch("input", { target: { value: "2026-04-15" } });
  input.dispatch("blur");
  assert.deepEqual(value(), { y: 2026, m: 4, d: 15 });

  input.dispatch("input", { target: { value: "nonsense" } });
  input.dispatch("blur");
  assert.deepEqual(value(), { y: 2026, m: 4, d: 15 }, "the value is NOT silently cleared");
  assert.equal(input.getAttribute("value"), "2026-04-15", "the text is restored");
});

test("DatePicker: a value changed from outside is reflected in the text", () => {
  const value = state<CalendarDate | null>(null);
  const dp = createRoot(() => datePicker({ value }));
  const root = mount(() => dp.el);
  value.set({ y: 2030, m: 12, d: 25 });
  assert.equal(root.querySelector("input")!.getAttribute("value"), "2030-12-25");
});

test("TimePicker: spinbutton segments that cycle at the ends", () => {
  const value = state<{ h: number; min: number } | null>({ h: 23, min: 58 });
  const root = mount(() => TimePicker({ value: value as any, step: 1 }));
  const segs = root.querySelectorAll("input");
  assert.equal(segs.length, 2);
  assert.equal(segs[0]!.getAttribute("role"), "spinbutton");
  assert.equal(segs[0]!.getAttribute("value"), "23");

  segs[0]!.dispatch("keydown", { key: "ArrowUp", preventDefault() {} });
  assert.equal(value()!.h, 0, "after 23 comes 00");

  segs[1]!.dispatch("keydown", { key: "ArrowUp", preventDefault() {} });
  assert.equal(value()!.min, 59);
  segs[1]!.dispatch("keydown", { key: "ArrowUp", preventDefault() {} });
  assert.equal(value()!.min, 0);
});

test("formatTime in 12h and 24h", () => {
  assert.equal(formatTime({ h: 0, min: 5 }), "00:05");
  assert.equal(formatTime({ h: 0, min: 5 }, true), "12:05 AM");
  assert.equal(formatTime({ h: 13, min: 30 }, true), "1:30 PM");
  assert.equal(formatTime({ h: 9, min: 7, s: 3 }, false, true), "09:07:03");
});

/* ------------------------------------------------------------- navigation -- */

test("paginationRange: ellipses only when at least two pages are skipped", () => {
  assert.deepEqual(paginationRange(1, 5), [1, 2, 3, 4, 5], "few pages => all");
  assert.deepEqual(paginationRange(1, 10), [1, 2, null, 10]);
  assert.deepEqual(paginationRange(5, 10), [1, null, 4, 5, 6, null, 10]);
  assert.deepEqual(paginationRange(10, 10), [1, null, 9, 10]);
  assert.deepEqual(paginationRange(2, 10), [1, 2, 3, null, 10], "no ellipsis for a single page");
  assert.deepEqual(paginationRange(1, 0), []);
});

test("Pagination: aria-current, end buttons disabled", () => {
  const page = state(1);
  const root = mount(() => Pagination({ page, pageCount: 5 }));

  assert.equal(root.querySelector("nav")!.getAttribute("aria-label"), "Pagination");
  const prev = root.querySelectorAll("button")[0]!;
  assert.equal(prev.getAttribute("disabled"), "");

  const pageBtn = (n: string) => root.querySelectorAll("button").find((b) => b.textContent === n)!;
  assert.equal(pageBtn("1").getAttribute("aria-current"), "page");

  pageBtn("3").click();
  assert.equal(page(), 3);
  assert.equal(pageBtn("3").getAttribute("aria-current"), "page");
  assert.equal(pageBtn("1").getAttribute("aria-current"), null);
});

test("Breadcrumbs: the last isn't a link, collapse over maxItems", () => {
  const items = [
    { label: "Home", href: "/" },
    { label: "Projects", href: "/p" },
    { label: "Raptor", href: "/p/r" },
    { label: "Settings" },
  ];
  const root = mount(() => Breadcrumbs({ items }));

  const current = root.querySelectorAll("span").find((s) => s.getAttribute("aria-current") === "page")!;
  assert.equal(current.textContent, "Settings");
  assert.equal(root.querySelectorAll("a").length, 3, "the last isn't a link");

  const collapsed = mount(() => Breadcrumbs({ items, maxItems: 3 }));
  assert.ok(collapsed.textContent.includes("…"));
});

test("Stepper: future steps aren't clickable", () => {
  const current = state(1);
  const root = mount(() =>
    Stepper({
      current,
      clickable: true,
      steps: [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }],
    }),
  );
  const buttons = root.querySelectorAll("button");
  assert.equal(buttons[2]!.getAttribute("disabled"), "", "the next step is blocked");

  buttons[0]!.click();
  assert.equal(current(), 0, "going back is allowed");

  const items = root.querySelectorAll("li");
  assert.equal(items[0]!.getAttribute("aria-current"), "step");
});

test("SidebarNav: aria-current on the active item, sublists", () => {
  const active = state("b");
  const root = mount(() =>
    SidebarNav({
      active: () => active(),
      groups: [
        {
          title: "Menu",
          items: [
            { key: "a", label: "A", href: "/a" },
            { key: "b", label: "B", href: "/b", children: [{ key: "b1", label: "B1", href: "/b1" }] },
          ],
        },
      ],
    }),
  );
  const links = root.querySelectorAll("a");
  assert.equal(links.find((l) => l.textContent.includes("B") && l.getAttribute("href") === "/b")!.getAttribute("aria-current"), "page");
  assert.ok(root.querySelectorAll("ul").length >= 2, "the sublist exists");
});

test("AppShell exposes a <main> with an id for the skip-link", () => {
  const root = mount(() => AppShell({ header: "h", sidebar: "s", children: "c" }));
  const main = root.querySelector("main")!;
  assert.equal(main.getAttribute("id"), "rui-main");
  assert.equal(main.getAttribute("tabindex"), "-1");
});

test("NavigationMenu opens the submenu on focus, not just on hover", () => {
  const root = mount(() =>
    NavigationMenu({
      entries: [{ key: "p", label: "Products", items: [{ key: "x", label: "X", href: "/x" }] }],
    }),
  );
  const trigger = root.querySelector("button")!;
  assert.equal(trigger.getAttribute("aria-expanded"), "false");

  trigger.dispatch("focus");
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(root.textContent.includes("X"));
});

/* -------------------------------------------------------------- TreeView -- */

const TREE = [
  { key: "src", label: "src", children: [
    { key: "a", label: "a.ts" },
    { key: "lib", label: "lib", children: [{ key: "b", label: "b.ts" }] },
  ]},
  { key: "pkg", label: "package.json" },
];

test("TreeView: ARIA tree, roving tabindex, expansion", () => {
  const t = createRoot(() => treeView({ nodes: TREE, label: "Files" }));
  const root = mount(() => t.el);

  assert.equal(root.querySelector("ul")!.getAttribute("role"), "tree");
  const items = root.querySelectorAll("li");
  assert.equal(items[0]!.getAttribute("role"), "treeitem");
  assert.equal(items[0]!.getAttribute("aria-expanded"), "false");
  assert.equal(items[0]!.getAttribute("aria-level"), "1");

  t.toggle("src");
  assert.equal(root.querySelectorAll("li")[0]!.getAttribute("aria-expanded"), "true");
  assert.ok(root.textContent.includes("a.ts"));

  // Only a single row is tabbable in the whole tree.
  const rows = root.querySelectorAll("div").filter((d) => (d.getAttribute("class") ?? "").includes("rui-tree-row"));
  assert.equal(rows.filter((r) => r.getAttribute("tabindex") === "0").length, 1);
});

test("TreeView: right arrow expands then descends, left ascends", () => {
  const t = createRoot(() => treeView({ nodes: TREE }));
  const root = mount(() => t.el);
  const tree = root.querySelector("ul")!;

  tree.dispatch("keydown", { key: "ArrowRight", preventDefault() {} });
  assert.ok(t.expanded().has("src"), "the first press expands");

  tree.dispatch("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.ok(!t.expanded().has("src"), "collapses");
});

test("TreeView: lazy loading of children", async () => {
  let calls = 0;
  const t = createRoot(() =>
    treeView({
      nodes: [{ key: "remote", label: "remote", hasChildren: true }],
      loadChildren: async () => {
        calls++;
        return [{ key: "kid", label: "child" }];
      },
    }),
  );
  const root = mount(() => t.el);
  assert.equal(calls, 0, "nothing loaded before expansion");

  const toggle = root.querySelectorAll("span").find((s) => (s.getAttribute("class") ?? "").includes("rui-tree-toggle"))!;
  toggle.click();
  await tick();
  await tick();

  assert.equal(calls, 1);
  assert.ok(root.textContent.includes("child"));

  t.collapseAll();
  t.toggle("remote");
  await tick();
  assert.equal(calls, 1, "doesn't reload");
});

/* -------------------------------------------------------------- ListView -- */

test("ListView: selection with Shift/Ctrl and grouping", () => {
  const items = ["a", "b", "c", "d"];
  const lv = createRoot(() =>
    listView<string>({
      items: () => items,
      render: (s) => s,
      selectable: true,
      groupBy: (s) => (s < "c" ? "first ones" : "last ones"),
    }),
  );
  const root = mount(() => lv.el);

  assert.equal(root.querySelector("div")!.getAttribute("role"), "listbox");
  assert.equal(root.querySelectorAll("div").filter((d) => d.getAttribute("role") === "group").length, 2);

  const rows = root.querySelectorAll("div").filter((d) => d.getAttribute("role") === "option");
  rows[0]!.dispatch("click", {});
  assert.deepEqual([...lv.selection.selected()], ["a"]);

  rows[2]!.dispatch("click", { shiftKey: true });
  assert.deepEqual([...lv.selection.selected()].sort(), ["a", "b", "c"]);
});

test("ListView: double-click activates, empty state", () => {
  const activated: string[] = [];
  const lv = createRoot(() =>
    listView<string>({ items: () => ["x"], render: (s) => s, onActivate: (s) => activated.push(s) }),
  );
  const root = mount(() => lv.el);
  root.querySelectorAll("div").find((d) => d.getAttribute("role") === "listitem")!.dispatch("dblclick");
  assert.deepEqual(activated, ["x"]);

  const empty = createRoot(() => listView<string>({ items: () => [], render: (s) => s, empty: "Empty" }));
  assert.ok(mount(() => empty.el).textContent.includes("Empty"));
});

/* ----------------------------------------------------------- MultiSelect -- */

test("MultiSelect: chips, Backspace deletes the last, limit", () => {
  const options = ["a", "b", "c"];
  const value = state<readonly string[]>([]);
  const ms = createRoot(() =>
    multiSelect<string>({ options: () => options, value, label: (s) => s, max: 2 }),
  );
  const root = mount(() => ms.el);
  const input = root.querySelector("input")!;

  input.dispatch("focus");
  const opts = () => root.querySelectorAll("li").filter((l) => l.getAttribute("role") === "option");
  opts()[0]!.dispatch("click", {});
  opts()[1]!.dispatch("click", {});
  assert.deepEqual(value(), ["a", "b"]);

  opts()[2]!.dispatch("click", {});
  assert.deepEqual(value(), ["a", "b"], "limit of 2 respected");

  input.dispatch("keydown", { key: "Backspace" });
  assert.deepEqual(value(), ["a"]);

  // The selection chip is outside the input, as a real button.
  const removeBtns = root.querySelectorAll("button").filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Remove"));
  assert.equal(removeBtns.length, 1);
  removeBtns[0]!.dispatch("click", {});
  assert.deepEqual(value(), []);
});

/* ---------------------------------------------------------- Autocomplete -- */

test("Autocomplete ignores the response of a stale request", async () => {
  const value = state("");
  const resolvers: Array<(v: string[]) => void> = [];
  const ac = createRoot(() =>
    autocomplete<string>({
      value,
      debounce: 0,
      label: (s) => s,
      search: () => new Promise<string[]>((res) => resolvers.push(res)),
    }),
  );
  const root = mount(() => ac.el);
  const input = root.querySelector("input")!;

  input.dispatch("input", { target: { value: "ab" } });
  await tick();
  input.dispatch("input", { target: { value: "abc" } });
  await tick();
  assert.equal(resolvers.length, 2);

  // The OLD REQUEST's response arrives last.
  resolvers[1]!(["new result"]);
  await tick();
  resolvers[0]!(["old result"]);
  await tick();

  assert.deepEqual([...ac.results()], ["new result"], "the stale response is ignored");
});

test("Autocomplete respects minLength", async () => {
  const value = state("");
  let calls = 0;
  const ac = createRoot(() =>
    autocomplete<string>({
      value, debounce: 0, minLength: 3, label: (s) => s,
      search: async () => { calls++; return ["x"]; },
    }),
  );
  const root = mount(() => ac.el);
  const input = root.querySelector("input")!;

  input.dispatch("input", { target: { value: "ab" } });
  await tick();
  assert.equal(calls, 0);

  input.dispatch("input", { target: { value: "abc" } });
  await tick();
  await tick();
  assert.equal(calls, 1);
});

/* -------------------------------------------------------- CommandPalette -- */

test("CommandPalette: filtering, groups, Enter runs", () => {
  clearBody();
  const log: string[] = [];
  const cp = createRoot(() =>
    commandPalette({
      commands: [
        { key: "new", label: "New file", group: "File", run: () => log.push("new") },
        { key: "open", label: "Open", group: "File", run: () => log.push("open") },
        { key: "theme", label: "Change theme", group: "View", run: () => log.push("theme") },
      ],
    }),
  );
  mount(() => cp.el);

  assert.equal(doc.body.childNodes.length, 0, "closed => no node");
  cp.toggle();

  const input = doc.body.querySelector("input")!;
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(doc.body.querySelectorAll("div").filter((d: MiniElement) => d.getAttribute("role") === "option").length, 3);

  input.dispatch("input", { target: { value: "ope" } });
  const opts = doc.body.querySelectorAll("div").filter((d: MiniElement) => d.getAttribute("role") === "option");
  assert.equal(opts.length, 1);

  input.dispatch("keydown", { key: "Enter", preventDefault() {} });
  assert.deepEqual(log, ["open"]);
  assert.equal(doc.body.childNodes.length, 0, "closes after running");
});

test("CommandPalette: filtering resets the selection", () => {
  clearBody();
  const log: string[] = [];
  const cp = createRoot(() =>
    commandPalette({
      commands: [
        { key: "a", label: "alpha", run: () => log.push("alpha") },
        { key: "b", label: "beta", run: () => log.push("beta") },
      ],
    }),
  );
  mount(() => cp.el);
  cp.toggle();
  const input = doc.body.querySelector("input")!;

  input.dispatch("keydown", { key: "ArrowDown", preventDefault() {} }); // selects beta
  input.dispatch("input", { target: { value: "al" } }); // only alpha remains
  input.dispatch("keydown", { key: "Enter", preventDefault() {} });
  assert.deepEqual(log, ["alpha"], "doesn't run the wrong command");
});

/* --------------------------------------------------------------- files */

test("matchesAccept: extensions, MIME wildcard, exact type", () => {
  const png = { name: "a.PNG", size: 1, type: "image/png" };
  assert.equal(matchesAccept(png, ".png"), true, "case-insensitive");
  assert.equal(matchesAccept(png, "image/*"), true);
  assert.equal(matchesAccept(png, "image/png"), true);
  assert.equal(matchesAccept(png, ".jpg,.gif"), false);
  assert.equal(matchesAccept(png, undefined), true, "without accept, anything passes");
});

test("validateFiles: type, size, count — in the correct order", () => {
  const files = [
    { name: "a.png", size: 100, type: "image/png" },
    { name: "b.txt", size: 100, type: "text/plain" },
    { name: "c.png", size: 999999, type: "image/png" },
    { name: "d.png", size: 100, type: "image/png" },
    { name: "e.png", size: 100, type: "image/png" },
  ];
  const r = validateFiles(files, { accept: "image/*", maxSize: 1000, maxFiles: 2 });

  assert.deepEqual(r.accepted.map((f) => f.name), ["a.png", "d.png"]);
  assert.deepEqual(
    r.rejected.map((x) => [x.file.name, x.reason]),
    [["b.txt", "type"], ["c.png", "size"], ["e.png", "count"]],
    "rejected files don't consume from the count limit",
  );
});

test("formatSize in binary units", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(1023), "1023 B");
  assert.equal(formatSize(1024), "1 KB");
  assert.equal(formatSize(1536), "1.5 KB");
  assert.equal(formatSize(-1), "—");
});

test("FileInput uses a real <label> linked to the input", () => {
  const files = state<readonly any[]>([]);
  const root = mount(() => FileInput({ files, accept: ".png" }));
  const input = root.querySelector("input")!;
  const label = root.querySelector("label")!;
  assert.equal(label.getAttribute("for"), input.getAttribute("id"));
  assert.equal(input.getAttribute("accept"), ".png");
});

test("Dropzone: dragenter/dragleave counter, drop with validation", () => {
  const files = state<readonly any[]>([]);
  const rejected: string[] = [];
  const dz = createRoot(() =>
    dropzone({ files, accept: "image/*", multiple: true, onReject: (r) => rejected.push(...r.map((x) => x.file.name)) }),
  );
  const root = mount(() => dz.el);
  const zone = root.querySelector("div")!;

  zone.dispatch("dragenter", { preventDefault() {} });
  zone.dispatch("dragenter", { preventDefault() {} }); // enters over a child
  assert.equal(dz.over(), true);
  zone.dispatch("dragleave", { preventDefault() {} });
  assert.equal(dz.over(), true, "still inside: the counter hasn't reached zero");
  zone.dispatch("dragleave", { preventDefault() {} });
  assert.equal(dz.over(), false);

  dz.accept([
    { name: "a.png", size: 10, type: "image/png" },
    { name: "b.exe", size: 10, type: "application/octet-stream" },
  ]);
  assert.deepEqual(files().map((f) => f.name), ["a.png"]);
  assert.deepEqual(rejected, ["b.exe"]);
});

test("FileList: removal and progress", () => {
  const files = state<readonly any[]>([
    { name: "a.png", size: 2048, type: "image/png" },
    { name: "b.png", size: 1024, type: "image/png" },
  ]);
  const progress = state<Record<string, number>>({ "a.png": 40 });
  const root = mount(() => FileList({ files, progress: () => progress() }));

  assert.ok(root.textContent.includes("2 KB"));
  const bar = root.querySelectorAll("span").find((s) => s.getAttribute("role") === "progressbar")!;
  assert.equal(bar.getAttribute("aria-valuenow"), "40");

  root.querySelectorAll("button").find((b) => b.getAttribute("aria-label") === "Remove a.png")!.click();
  assert.deepEqual(files().map((f) => f.name), ["b.png"]);
});

/* ------------------------------------------------------------- overlay 2 */

test("a modal Drawer has aria-modal and locks scroll; modeless doesn't", () => {
  clearBody();
  const open = state(false);
  mount(() => R.div(Drawer({ open, children: "content", title: "Filters" })));

  open.set(true);
  const panel = doc.body.querySelectorAll("div").find((d: MiniElement) => d.getAttribute("role") === "dialog")!;
  assert.equal(panel.getAttribute("aria-modal"), "true");
  assert.equal(doc.body.style.overflow, "hidden");
  open.set(false);
  assert.equal(doc.body.style.overflow, "");

  clearBody();
  const open2 = state(true);
  mount(() => R.div(Drawer({ open: open2, children: "x", modeless: true })));
  const side = doc.body.querySelectorAll("div").find((d: MiniElement) => d.getAttribute("role") === "complementary")!;
  assert.ok(side, "modeless => complementary, not dialog");
  assert.equal(doc.body.style.overflow, "", "modeless doesn't lock the page");
});

test("ContextMenu opens on right-click and on Shift+F10", () => {
  clearBody();
  const log: string[] = [];
  const root = mount(() =>
    ContextMenu({
      entries: [
        { key: "c", label: "Copy", onSelect: () => log.push("copy") },
        { key: "s", separator: true },
        { key: "d", label: "Delete", onSelect: () => log.push("delete") },
      ],
      children: (p) => R.div(p, "zone"),
    }),
  );
  const zone = root.querySelector("div")!;

  zone.dispatch("contextmenu", { clientX: 40, clientY: 60, preventDefault() {} });
  const menu = doc.body.querySelectorAll("ul").find((u: MiniElement) => u.getAttribute("role") === "menu")!;
  assert.ok(menu);
  assert.equal(menu.querySelectorAll("li").filter((l: MiniElement) => l.getAttribute("role") === "menuitem").length, 2);

  menu.querySelectorAll("li").find((l: MiniElement) => l.textContent.includes("Copy"))!.click();
  assert.deepEqual(log, ["copy"]);

  clearBody();
  zone.dispatch("keydown", { key: "F10", shiftKey: true, preventDefault() {} });
  assert.ok(doc.body.querySelectorAll("ul").find((u: MiniElement) => u.getAttribute("role") === "menu"), "accessible by keyboard");
});

test("Notification has no aria-live (its place is a list)", () => {
  const root = mount(() => Notification({ title: "T", children: "message", unread: () => true }));
  const article = root.querySelector("article")!;
  assert.equal(article.getAttribute("aria-live"), null);
  assert.ok((article.getAttribute("class") ?? "").includes("rui-unread"));
});

test("Backdrop is decorative and appears only when requested", () => {
  const visible = state(false);
  const root = mount(() => R.div(Backdrop({ visible: () => visible(), blur: true })));
  assert.equal(root.querySelectorAll("div").filter((d) => (d.getAttribute("class") ?? "").includes("rui-backdrop")).length, 0);

  visible.set(true);
  const bd = root.querySelectorAll("div").find((d) => (d.getAttribute("class") ?? "").includes("rui-backdrop"))!;
  assert.equal(bd.getAttribute("aria-hidden"), "true");
});

test("ErrorBoundary catches the build error and can retry", async () => {
  let fail = true;
  const caught: unknown[] = [];
  const root = mount(() =>
    R.div(
      ErrorBoundary({
        children: () => {
          if (fail) throw new Error("boom");
          return R.span("ok");
        },
        fallback: (err, retry) =>
          R.button({ class: "rui-retry", "on:click": retry }, "error: " + (err as Error).message),
        onError: (e) => caught.push(e),
      }),
    ),
  );

  await tick();
  assert.equal(caught.length, 1);
  const retry = root.querySelector("button")!;
  assert.ok(retry.textContent.includes("boom"));

  fail = false;
  retry.click();
  await tick();
  assert.ok(root.textContent.includes("ok"));
});

/* --------------------------------------------------------------- charts */

test("scaleLinear maps the domain onto the range, including degenerate", () => {
  const s = scaleLinear([0, 100], [0, 200]);
  assert.equal(s(0), 0);
  assert.equal(s(50), 100);
  assert.equal(s(100), 200);
  assert.equal(s.invert(100), 50);

  // All values equal: the middle of the range, not NaN.
  const flat = scaleLinear([5, 5], [0, 100]);
  assert.equal(flat(5), 50);
  assert.ok(!Number.isNaN(flat(5)));
});

test("niceTicks produces round values", () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(3, 3), [3]);
  assert.deepEqual(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
});

test("extent includes zero and handles a constant series", () => {
  assert.deepEqual(extent([10, 20, 30]), [0, 30]);
  assert.deepEqual(extent([10, 20, 30], false), [10, 30]);
  assert.deepEqual(extent([]), [0, 1]);
  const flat = extent([7, 7]);
  assert.ok(flat[0] < flat[1], "a constant series doesn't give a null range");
});

test("scaleBand splits the range with space between bands", () => {
  const b = scaleBand(4, [0, 400], 0.2);
  assert.equal(b.step, 100);
  assert.equal(b.bandwidth, 80);
  assert.equal(b(0), 10);
  assert.equal(b(3), 310);
});

test("LineChart renders SVG with a path per series and axes", () => {
  const root = mount(() =>
    LineChart({
      series: [
        { label: "A", values: [1, 5, 3] },
        { label: "B", values: [2, 2, 6] },
      ],
      labels: ["jan", "feb", "mar"],
      summary: "Two series over three months",
    }),
  );

  const svg = root.querySelector("svg")!;
  assert.equal(svg.getAttribute("role"), "img");
  assert.equal(svg.getAttribute("aria-label"), "Two series over three months");

  const lines = root.querySelectorAll("path").filter((p) => (p.getAttribute("class") ?? "").includes("rui-line"));
  assert.equal(lines.length, 2);
  assert.ok(lines[0]!.getAttribute("d")!.startsWith("M"));
  assert.ok(!lines[0]!.getAttribute("d")!.includes("NaN"));

  // Legend for multiple series.
  assert.ok(root.textContent.includes("A") && root.textContent.includes("B"));
});

test("THESIS: live data in a LineChart rewrites only `d`", () => {
  const values = state<readonly number[]>([1, 2, 3]);
  const root = mount(() =>
    LineChart({ series: () => [{ label: "live", values: values() }], labels: ["a", "b", "c"] }),
  );
  const path = root.querySelectorAll("path").find((p) => (p.getAttribute("class") ?? "").includes("rui-line"))!;
  const before = path.getAttribute("d");

  resetStats();
  values.set([3, 1, 5]);

  assert.notEqual(path.getAttribute("d"), before);
  assert.equal(stats.createElement, 0, "zero new elements");
  assert.equal(stats.createText, 0);
});

test("AreaChart adds the polygon under the line", () => {
  const root = mount(() => AreaChart({ series: [{ label: "A", values: [1, 2] }] }));
  const area = root.querySelectorAll("path").find((p) => (p.getAttribute("class") ?? "").includes("rui-area"))!;
  assert.ok(area.getAttribute("d")!.endsWith("Z"), "the outline is closed");
});

test("BarChart: grouped vs stacked", () => {
  const series = [
    { label: "A", values: [10, 20] },
    { label: "B", values: [5, 5] },
  ];
  const grouped = mount(() => BarChart({ series, labels: ["x", "y"] }));
  assert.equal(grouped.querySelectorAll("rect").length, 4);

  const stacked = mount(() => BarChart({ series, labels: ["x", "y"], stacked: true }));
  const rects = stacked.querySelectorAll("rect");
  assert.equal(rects.length, 4);
  // Stacked: the bars of one category share the same x.
  assert.equal(rects[0]!.getAttribute("x"), rects[1]!.getAttribute("x"));
  for (const r of rects) assert.ok(!r.getAttribute("height")!.includes("NaN"));
});

test("stacked BarChart scales to the per-category sum", () => {
  const root = mount(() =>
    BarChart({ series: [{ label: "A", values: [60] }, { label: "B", values: [60] }], labels: ["x"], stacked: true }),
  );
  const rects = root.querySelectorAll("rect");
  const total = rects.reduce((sum, r) => sum + Number(r.getAttribute("height")), 0);
  // The sum (120) must fit within the plot area, not exceed it.
  const svgHeight = Number(root.querySelector("svg")!.getAttribute("height"));
  assert.ok(total <= svgHeight, "the stacked bars don't spill out of the chart");
});
