/** Selection input. */
import { state, derived } from "@raptor/dom";
import { Combobox } from "@raptor/ui/combobox";
import { CheckboxGroup, NativeSelect, SegmentedControl } from "@raptor/ui/controls";
import { Autocomplete, MultiSelect } from "@raptor/ui/data-views";
import { Checkbox, RadioGroup, Switch } from "@raptor/ui/input";
import { Cascader, ColorPicker, ColorSwatchPicker, type OptionNode, Rating, TransferList, TreeSelect } from "@raptor/ui/input-extra";
import { Select } from "@raptor/ui/select";
import { RangeSlider, Slider } from "@raptor/ui/slider";
import type { CatalogGroup } from "./types.ts";

interface Pkg {
  id: string;
  name: string;
}
const PACKAGES: Pkg[] = [
  { id: "core", name: "@raptor/core" },
  { id: "dom", name: "@raptor/dom" },
  { id: "wire-core", name: "@raptor/wire-core" },
  { id: "wire-client", name: "@raptor/wire-client" },
  { id: "server", name: "@raptor/server" },
  { id: "compiler", name: "@raptor/compiler" },
  { id: "engine", name: "@raptor/engine" },
  { id: "bundle", name: "@raptor/bundle" },
  { id: "ui", name: "@raptor/ui" },
];

const TREE: OptionNode[] = [
  {
    value: "packages",
    label: "packages",
    children: [
      { value: "core", label: "core" },
      { value: "dom", label: "dom" },
      {
        value: "wire",
        label: "wire",
        children: [
          { value: "wire-codec", label: "codec" },
          { value: "wire-core", label: "core" },
        ],
      },
    ],
  },
  {
    value: "examples",
    label: "examples",
    children: [
      { value: "counter", label: "counter" },
      { value: "site", label: "site" },
    ],
  },
];

export const SELECTION: CatalogGroup = {
  slug: "selection",
  title: "Selection input",
  blurb: "Pickers, toggles and sliders. Options are objects you own — the component never copies your list.",
  items: [
    {
      slug: "select",
      name: "Select",
      tier: "T1",
      summary:
        "A single-choice dropdown with full keyboard support and a listbox that flips instead of falling off the screen.",
      code: `const pkg = state<Pkg | null>(null);
Select({
  options: () => PACKAGES,
  value: pkg,
  label: (p) => p.name,
  placeholder: "Pick a package",
});`,
      props: [
        { name: "options", type: "Accessor<readonly T[]>", desc: "An accessor, so the list can change while the menu is open." },
        { name: "value", type: "State<T | null>", desc: "The signal that holds the chosen option." },
        { name: "label", type: "(option: T) => string", desc: "Text for an option — options stay your own objects." },
        { name: "render", type: "(option: T) => Child", desc: "Rich rendering for an option row." },
        { name: "placement", type: "Placement", desc: "Preferred side; collisions flip it automatically." },
      ],
      demo: () => {
        const pkg = state<Pkg | null>(null);
        return (
          <div class="cmp-row">
            {Select({ options: () => PACKAGES, value: pkg, label: (p: Pkg) => p.name, placeholder: "Pick a package" })}
            <span class="chip">
              value = <b>{() => pkg()?.name ?? "null"}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "native-select",
      name: "NativeSelect",
      tier: "T2",
      summary: "The platform `<select>`, styled to match. On a phone this is the control people expect — use it when you do not need custom rows.",
      code: `NativeSelect({ value: env, options: [{ value: "dev", label: "Development" }, …] });`,
      demo: () => {
        const env = state("prod");
        return (
          <div class="cmp-row">
            {NativeSelect({
              value: env,
              label: "Environment",
              options: [
                { value: "dev", label: "Development" },
                { value: "stage", label: "Staging" },
                { value: "prod", label: "Production" },
              ],
            })}
            <span class="chip">
              value = <b>{env}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "multi-select",
      name: "MultiSelect",
      tier: "T1",
      summary: "Several choices, shown as removable chips, with an optional search box and a cap on how many can be picked.",
      code: `const chosen = state<readonly Pkg[]>([]);
MultiSelect({ options: () => PACKAGES, value: chosen, label: (p) => p.name, max: 4 });`,
      demo: () => {
        const chosen = state<readonly Pkg[]>([PACKAGES[0]!]);
        return (
          <div>
            <div class="cmp-row">
              {MultiSelect({ options: () => PACKAGES, value: chosen, label: (p: Pkg) => p.name, max: 4, placeholder: "Pick up to 4" })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                {() => chosen().map((p) => p.id).join(", ") || "nothing selected"}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "combobox",
      name: "Combobox",
      tier: "T1",
      thesis:
        "Filtering rebinds the rows instead of rebuilding them: the option objects are stable, so a keyed list moves the existing nodes and only the ones that truly left the result set are removed.",
      summary: "A text field plus a filtered list — type to narrow, arrows to move, Enter to choose.",
      code: `Combobox({
  options: () => PACKAGES,
  value: pkg,
  label: (p) => p.name,
  placeholder: "Filter packages…",
});`,
      demo: () => {
        const pkg = state<Pkg | null>(null);
        return (
          <div class="cmp-row">
            {Combobox({ options: () => PACKAGES, value: pkg, label: (p: Pkg) => p.name, placeholder: "Filter packages…" })}
            <span class="chip">
              value = <b>{() => pkg()?.name ?? "null"}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "autocomplete",
      name: "Autocomplete",
      tier: "T2",
      summary:
        "Suggestions from an async source, debounced, with out-of-order responses discarded — a slow request that lands late can never overwrite a newer result.",
      code: `Autocomplete({
  value: query,
  search: (q) => fetch("/api/search?q=" + q).then((r) => r.json()),
  label: (item) => item.name,
  debounce: 250,
});`,
      demo: () => {
        const query = state("");
        const picked = state("—");
        const search = (q: string): Promise<readonly Pkg[]> =>
          new Promise((resolve) =>
            setTimeout(() => resolve(PACKAGES.filter((p) => p.name.includes(q.toLowerCase()))), 250),
          );
        return (
          <div>
            <div class="cmp-row">
              {Autocomplete({
                value: query,
                search,
                label: (p: Pkg) => p.name,
                placeholder: "Type 'wire'…",
                onSelect: (p: Pkg) => picked.set(p.name),
              })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                picked: <b>{picked}</b>
              </span>
              <span class="chip">the demo's fake backend answers after 250 ms</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "checkbox",
      name: "Checkbox",
      tier: "T1",
      summary: "A checkbox that also understands the indeterminate state — the one a parent row needs when only some children are ticked.",
      code: `Checkbox({ checked: agreed, label: "I agree" });
Checkbox({ checked: all, indeterminate: () => some() && !all(), label: "Select all" });`,
      demo: () => {
        const a = state(true);
        const b = state(false);
        const all = state(false);
        const some = derived(() => a() !== b());
        return (
          <div>
            <div class="cmp-row">
              {Checkbox({ checked: all, indeterminate: () => some(), label: "Parent (indeterminate while children differ)" })}
            </div>
            <div class="cmp-row" style="padding-left:24px">
              {Checkbox({ checked: a, label: "Child A" })}
              {Checkbox({ checked: b, label: "Child B" })}
              {Checkbox({ checked: state(false), disabled: true, label: "Disabled" })}
            </div>
          </div>
        );
      },
    },
    {
      slug: "checkbox-group",
      name: "CheckboxGroup",
      tier: "T2",
      summary: "A set of checkboxes over a `Set` signal, with a working select-all that reports the partial state.",
      code: `const picked = state<ReadonlySet<string>>(new Set());
CheckboxGroup({ value: picked, options, selectAll: true, label: "Packages" });`,
      demo: () => {
        const picked = state<ReadonlySet<string>>(new Set(["core"]));
        return (
          <div>
            <div class="cmp-row">
              {CheckboxGroup({
                value: picked,
                label: "Packages",
                selectAll: true,
                options: PACKAGES.slice(0, 4).map((p) => ({ value: p.id, label: p.name })),
              })}
            </div>
            <div class="cmp-row">
              <span class="chip">{() => [...picked()].join(", ") || "none"}</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "radio-group",
      name: "RadioGroup",
      tier: "T1",
      summary: "One choice out of a few, with the arrow-key navigation a radio group is supposed to have.",
      code: `RadioGroup({ value: plan, options: [{ value: "free", label: "Free" }, …] });`,
      demo: () => {
        const plan = state("team");
        return (
          <div class="cmp-row" style="align-items:flex-start">
            {RadioGroup({
              value: plan,
              label: "Plan",
              options: [
                { value: "free", label: "Free" },
                { value: "team", label: "Team" },
                { value: "enterprise", label: "Enterprise", disabled: true },
              ],
            })}
            <span class="chip">
              value = <b>{plan}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "switch",
      name: "Switch",
      tier: "T1",
      summary: "An on/off control for something that takes effect immediately — as opposed to a checkbox, which is usually submitted later.",
      code: `Switch({ checked: dark, label: "Dark mode" });`,
      demo: () => {
        const live = state(true);
        return (
          <div class="cmp-row">
            {Switch({ checked: live, label: "Live updates" })}
            {Switch({ checked: state(false), disabled: true, label: "Disabled" })}
            <span class="chip">
              live = <b>{() => String(live())}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "slider",
      name: "Slider",
      tier: "T1",
      thesis:
        "A drag writes one number. That number is read by one style binding and one text node, so a frame of dragging costs two DOM writes no matter how big the page is.",
      summary: "A value in a range, with keyboard steps, an optional quantisation and a spoken value you can override.",
      code: `const volume = state(60);
Slider({ value: volume, min: 0, max: 100, valueText: (v) => v + "%" });`,
      props: [
        { name: "value", type: "State<number>", desc: "Your signal; the slider only writes it." },
        { name: "min / max / step", type: "number", desc: "Range and quantisation. step 0 means continuous." },
        { name: "valueText", type: "(value: number) => string", desc: "What a screen reader announces instead of the bare number." },
        { name: "onCommit", type: "(value: number) => void", desc: "Fired at the end of a drag — the moment to save." },
      ],
      demo: () => {
        const volume = state(60);
        const commits = state(0);
        return (
          <div>
            <div class="cmp-row">
              {Slider({
                value: volume,
                min: 0,
                max: 100,
                label: "Volume",
                valueText: (v: number) => v + "%",
                onCommit: () => commits.update((n) => n + 1),
              })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                value = <b>{volume}</b>
              </span>
              <span class="chip">
                committed <b>{commits}</b>× (on release)
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "range-slider",
      name: "RangeSlider",
      tier: "T2",
      summary: "Two handles over one range. They cannot cross, and each announces its own end of the interval.",
      code: `const price = state<readonly [number, number]>([20, 80]);
RangeSlider({ value: price, min: 0, max: 100 });`,
      demo: () => {
        const price = state<readonly [number, number]>([20, 80]);
        return (
          <div>
            <div class="cmp-row">{RangeSlider({ value: price, min: 0, max: 100, label: "Price range" })}</div>
            <div class="cmp-row">
              <span class="chip">
                {() => price()[0]} – {() => price()[1]}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "segmented-control",
      name: "SegmentedControl",
      tier: "T2",
      summary: "A compact set of exclusive options. Same semantics as a radio group, shaped like a switchable toolbar.",
      code: `SegmentedControl({ value: range, options: [{ value: "1d", label: "1D" }, …] });`,
      demo: () => {
        const range = state("7d");
        return (
          <div class="cmp-row">
            {SegmentedControl({
              value: range,
              label: "Range",
              options: [
                { value: "1d", label: "1D" },
                { value: "7d", label: "7D" },
                { value: "30d", label: "30D" },
                { value: "all", label: "All" },
              ],
            })}
            <span class="chip">
              range = <b>{range}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "rating",
      name: "Rating",
      tier: "T3",
      summary: "Stars, optionally in halves, readable by keyboard and usable read-only for displaying a score.",
      code: `Rating({ value: score, max: 5, half: true });`,
      demo: () => {
        const score = state(3.5);
        return (
          <div class="cmp-row">
            {Rating({ value: score, max: 5, half: true, label: "Score" })}
            <span class="chip">
              value = <b>{() => String(score())}</b>
            </span>
            {Rating({ value: state(4), readonly: true, label: "Average" })}
          </div>
        );
      },
    },
    {
      slug: "color-picker",
      name: "ColorPicker",
      tier: "T3",
      summary:
        "A colour field with presets and a live contrast ratio against a background you name — so the picker tells you whether the text will be readable.",
      code: `ColorPicker({ value: brand, presets: [...], contrastAgainst: "#ffffff" });`,
      demo: () => {
        const brand = state("#17457a");
        return (
          <div class="cmp-row">
            {ColorPicker({
              value: brand,
              label: "Brand colour",
              contrastAgainst: "#ffffff",
              presets: ["#17457a", "#0f6e4f", "#b45309", "#8250a8", "#b42318"],
            })}
            <span class="chip">
              value = <b>{brand}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "color-swatch-picker",
      name: "ColorSwatchPicker",
      tier: "T3",
      summary: "A fixed palette instead of a free colour space — the right control when only the brand colours are allowed.",
      code: `ColorSwatchPicker({ value: tag, colors: PALETTE, names: { "#17457a": "Navy" } });`,
      demo: () => {
        const tag = state("#0f6e4f");
        return (
          <div class="cmp-row">
            {ColorSwatchPicker({
              value: tag,
              columns: 5,
              label: "Label colour",
              colors: ["#17457a", "#0f6e4f", "#b45309", "#8250a8", "#b42318", "#0e7490", "#4a515e", "#15181d"],
              names: { "#17457a": "Navy", "#0f6e4f": "Green", "#b45309": "Amber" },
            })}
            <span class="chip">
              value = <b>{tag}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "transfer-list",
      name: "TransferList",
      tier: "T3",
      summary: "Two lists and the buttons between them — for assigning members, permissions or columns.",
      code: `TransferList({ items, selected, titles: ["Available", "Chosen"] });`,
      demo: () => {
        const selected = state<readonly string[]>(["dom"]);
        return (
          <div>
            {TransferList({
              items: PACKAGES.slice(0, 6).map((p) => ({ key: p.id, label: p.name })),
              selected,
              titles: ["Available", "Chosen"],
              label: "Packages",
            })}
            <div class="cmp-row" style="margin-top:12px">
              <span class="chip">{() => selected().join(", ") || "none"}</span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "tree-select",
      name: "TreeSelect",
      tier: "T3",
      summary: "Picking one node out of a tree, in a dropdown — folders, categories, an org chart.",
      code: `TreeSelect({ options: TREE, value: node, placeholder: "Choose a folder" });`,
      demo: () => {
        const node = state<string | null>(null);
        return (
          <div class="cmp-row">
            {TreeSelect({ options: TREE, value: node, placeholder: "Choose a folder", label: "Folder" })}
            <span class="chip">
              value = <b>{() => node() ?? "null"}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "cascader",
      name: "Cascader",
      tier: "T3",
      summary: "The same tree, walked one column at a time. `anyLevel` decides whether an intermediate node counts as an answer.",
      code: `Cascader({ options: TREE, value: path, separator: " / " });`,
      demo: () => {
        const path = state<string | null>(null);
        return (
          <div class="cmp-row">
            {Cascader({ options: TREE, value: path, placeholder: "Pick a path", label: "Path" })}
            <span class="chip">
              value = <b>{() => path() ?? "null"}</b>
            </span>
          </div>
        );
      },
    },
  ],
};
