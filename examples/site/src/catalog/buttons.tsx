/** Buttons and actions. */
import { state } from "@raptorstack/raptorjs/dom";
import { Button, ButtonGroup, IconButton } from "@raptorstack/raptorjs/ui/button";
import { CloseButton, CopyButton, ToggleButton, ToggleGroup } from "@raptorstack/raptorjs/ui/controls";
import { FloatingActionButton, SplitButton } from "@raptorstack/raptorjs/ui/layout-extra";
import { menuItem, menuSeparator } from "@raptorstack/raptorjs/ui/menu";
import type { CatalogGroup } from "./types.ts";

export const BUTTONS: CatalogGroup = {
  slug: "buttons",
  title: "Buttons & actions",
  blurb: "Variants, sizes, and the loading state you get for free from an async handler.",
  items: [
    {
      slug: "button",
      name: "Button",
      tier: "T1",
      summary:
        "Four variants, three sizes. If onClick returns a promise the button enters loading on its own and stops accepting clicks — the classic double-submit bug never happens.",
      code: `Button({ children: "Primary", variant: "primary", onClick: () => {} });

// async handler -> automatic loading state
Button({
  children: "Save",
  onClick: async () => {
    await save();
  },
});`,
      props: [
        { name: "variant", type: `"primary" | "secondary" | "ghost" | "danger"`, desc: "Visual weight. Default primary." },
        { name: "size", type: `"sm" | "md" | "lg"`, desc: "Control height." },
        { name: "onClick", type: "(e) => void | Promise<unknown>", desc: "A promise puts the button in loading until it settles." },
        { name: "loading", type: "Accessor<boolean> | boolean", desc: "Drive the spinner yourself." },
        { name: "before / after", type: "Child", desc: "Content around the label (icons)." },
        { name: "block", type: "boolean", desc: "Fill the available width." },
      ],
      demo: () => {
        const saved = state(0);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Primary", variant: "primary" })}
              {Button({ children: "Secondary" })}
              {Button({ children: "Ghost", variant: "ghost" })}
              {Button({ children: "Danger", variant: "danger" })}
              {Button({ children: "Disabled", disabled: true })}
            </div>
            <div class="cmp-row">
              {Button({ children: "Small", size: "sm" })}
              {Button({ children: "Medium" })}
              {Button({ children: "Large", size: "lg" })}
            </div>
            <div class="cmp-row">
              {Button({
                children: "Save (async)",
                variant: "primary",
                onClick: () =>
                  new Promise<void>((resolve) =>
                    setTimeout(() => {
                      saved.update((n) => n + 1);
                      resolve();
                    }, 900),
                  ),
              })}
              <span class="chip">
                saved <b>{saved}</b> times
              </span>
            </div>
          </div>
        );
      },
      notes: [
        "`type` defaults to `button`, not `submit`, so a button inside a form never submits it by accident.",
      ],
    },
    {
      slug: "icon-button",
      name: "IconButton",
      tier: "T1",
      summary: "A square, icon-only button. `label` is required — an icon with no accessible name is invisible to a screen reader.",
      code: `IconButton({ icon: "x", label: "Close", variant: "ghost" });`,
      props: [
        { name: "icon", type: "Child", desc: "The glyph or SVG node." },
        { name: "label", type: "string", desc: "Required accessible name." },
      ],
      demo: () => (
        <div class="cmp-row">
          {IconButton({ icon: "✕", label: "Close" })}
          {IconButton({ icon: "＋", label: "Add", variant: "primary" })}
          {IconButton({ icon: "⟳", label: "Refresh", variant: "ghost" })}
          {IconButton({ icon: "🗑", label: "Delete", variant: "danger", size: "sm" })}
        </div>
      ),
    },
    {
      slug: "button-group",
      name: "ButtonGroup",
      tier: "T2",
      summary: "Joins buttons into one control: shared borders, rounded only on the ends.",
      code: `ButtonGroup({
  label: "Alignment",
  children: [Button({ children: "Left" }), Button({ children: "Center" }), Button({ children: "Right" })],
});`,
      demo: () =>
        ButtonGroup({
          label: "Alignment",
          children: [
            Button({ children: "Left" }),
            Button({ children: "Center" }),
            Button({ children: "Right" }),
          ],
        }),
    },
    {
      slug: "toggle-button",
      name: "ToggleButton",
      tier: "T2",
      summary: "A button with an on/off state, reported through `aria-pressed`. You own the signal.",
      code: `const bold = state(false);
ToggleButton({ pressed: bold, children: "B", label: "Bold" });`,
      props: [
        { name: "pressed", type: "State<boolean>", desc: "The signal you own; the button only writes it." },
        { name: "onChange", type: "(pressed: boolean) => void", desc: "Called after the state flips." },
      ],
      demo: () => {
        const bold = state(false);
        const italic = state(true);
        return (
          <div>
            <div class="cmp-row">
              {ToggleButton({ pressed: bold, children: <b>B</b>, label: "Bold" })}
              {ToggleButton({ pressed: italic, children: <i>I</i>, label: "Italic" })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                bold = <b>{() => String(bold())}</b>
              </span>
              <span class="chip">
                italic = <b>{() => String(italic())}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "toggle-group",
      name: "ToggleGroup",
      tier: "T2",
      summary: "A row of toggles that behaves either like radios (`single`) or like checkboxes (`multiple`).",
      code: `const view = state<string | null>("grid");
ToggleGroup({
  mode: "single",
  value: view,
  options: [
    { value: "list", label: "List" },
    { value: "grid", label: "Grid" },
    { value: "board", label: "Board" },
  ],
});`,
      demo: () => {
        const view = state<string | null>("grid");
        const tools = state<ReadonlySet<string>>(new Set(["bold"]));
        return (
          <div>
            <div class="cmp-row">
              {ToggleGroup({
                mode: "single",
                value: view,
                label: "View",
                options: [
                  { value: "list", label: "List" },
                  { value: "grid", label: "Grid" },
                  { value: "board", label: "Board" },
                ],
              })}
              <span class="chip">
                view = <b>{() => String(view())}</b>
              </span>
            </div>
            <div class="cmp-row">
              {ToggleGroup({
                mode: "multiple",
                value: tools,
                label: "Format",
                options: [
                  { value: "bold", label: "Bold" },
                  { value: "italic", label: "Italic" },
                  { value: "under", label: "Underline" },
                ],
              })}
              <span class="chip">
                on = <b>{() => [...tools()].join(", ") || "—"}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "copy-button",
      name: "CopyButton",
      tier: "T2",
      summary: "Copies text to the clipboard and swaps its own label for a moment. Built on the `clipboard` primitive.",
      code: `CopyButton({ text: "npm i @raptorstack/raptorjs" });`,
      props: [
        { name: "text", type: "Accessor<string> | string", desc: "What gets copied." },
        { name: "resetAfter", type: "number", desc: "How long the copied state lasts, in ms. Default 1500." },
      ],
      demo: () => (
        <div class="cmp-row">
          <code class="inl">npm i @raptorstack/raptorjs</code>
          {CopyButton({ text: "npm i @raptorstack/raptorjs" })}
        </div>
      ),
    },
    {
      slug: "close-button",
      name: "CloseButton",
      tier: "T2",
      summary: "The standard ✕. A small surface, but it shows up in every dialog, drawer, toast and tag — so it exists once.",
      code: `CloseButton({ onClick: () => open.set(false), label: "Close" });`,
      demo: () => {
        const gone = state(false);
        return (
          <div class="cmp-row">
            {() =>
              gone()
                ? Button({ children: "Bring it back", size: "sm", onClick: () => gone.set(false) })
                : (
                    <span class="chip" style="display:inline-flex;align-items:center;gap:8px">
                      Dismiss me
                      {CloseButton({ onClick: () => gone.set(true), label: "Dismiss" })}
                    </span>
                  )
            }
          </div>
        );
      },
    },
    {
      slug: "split-button",
      name: "SplitButton",
      tier: "T3",
      summary: "A main action plus a menu of the near-misses — Save, and next to it Save as, Save a copy.",
      code: `SplitButton({
  children: "Save",
  onClick: save,
  entries: [menuItem("Save as…", saveAs), menuSeparator(), menuItem("Save a copy", saveCopy)],
});`,
      demo: () => {
        const last = state("—");
        return (
          <div class="cmp-row">
            {SplitButton({
              children: "Save",
              variant: "primary",
              onClick: () => last.set("Save"),
              entries: [
                menuItem("Save as…", () => last.set("Save as")),
                menuItem("Save a copy", () => last.set("Save a copy")),
                menuSeparator(),
                menuItem("Export", () => last.set("Export")),
              ],
            })}
            <span class="chip">
              chose: <b>{last}</b>
            </span>
          </div>
        );
      },
    },
    {
      slug: "floating-action-button",
      name: "FloatingActionButton",
      tier: "T3",
      summary: "The one action that follows you down the page. Extended, it carries a label next to the icon.",
      code: `FloatingActionButton({ icon: "+", label: "New task", onClick: create, extended: "New task" });`,
      demo: () => {
        const created = state(0);
        return (
          <div
            class="cmp-panel"
            style="position:relative;transform:translate(0);height:150px;overflow:hidden;font-size:14px"
          >
            <span>The button is pinned to the corner of this box.</span>
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                created <b>{created}</b>
              </span>
            </div>
            {FloatingActionButton({
              icon: "＋",
              label: "New task",
              extended: "New task",
              onClick: () => created.update((n) => n + 1),
            })}
          </div>
        );
      },
    },
  ],
};
