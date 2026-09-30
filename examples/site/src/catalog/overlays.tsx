/** Overlays. */
import { state, R } from "raptorjs/dom";
import { HoverCard, Tour } from "raptorjs/ui/advanced";
import { Button } from "raptorjs/ui/button";
import { SegmentedControl } from "raptorjs/ui/controls";
import { Lightbox } from "raptorjs/ui/media";
import { DropdownMenu, menuItem, menuSeparator } from "raptorjs/ui/menu";
import { ConfirmDialog, Dialog, Popover, Tooltip } from "raptorjs/ui/overlay";
import { Backdrop, ContextMenu, Drawer, Notification } from "raptorjs/ui/overlay-extra";
import { type Placement } from "raptorjs/ui/primitives";
import { Toaster, createToaster } from "raptorjs/ui/toast";
import { SAMPLE_IMAGES } from "./sample.ts";
import type { CatalogGroup } from "./types.ts";

/** A trigger that looks like a Button but forwards the props the overlay needs. */
function triggerButton(text: string) {
  return (p: Record<string, unknown>) => R.button({ type: "button", class: "rui-btn rui-btn-secondary rui-btn-md", ...p }, text);
}


export const OVERLAYS: CatalogGroup = {
  slug: "overlays",
  title: "Overlays",
  blurb:
    "Everything that floats: focus is trapped where it should be, Escape always works, and nothing is ever positioned off the edge of the screen.",
  items: [
    {
      slug: "dialog",
      name: "Dialog",
      tier: "T1",
      summary:
        "A modal with a focus trap, a scroll lock on the body, Escape and backdrop closing, and focus returned to whatever opened it.",
      code: `const open = state(false);
Dialog({
  open,
  title: "Rename project",
  children: form,
  footer: [Button({ children: "Cancel", onClick: () => open.set(false) }), Button({ children: "Save", variant: "primary" })],
});`,
      props: [
        { name: "open", type: "State<boolean>", desc: "Your signal — the dialog is a function of it." },
        { name: "title / footer", type: "Child", desc: "Header and action row." },
        { name: "size", type: `"sm" | "md" | "lg" | "full"`, desc: "Width." },
        { name: "closeOnEscape / closeOnBackdrop", type: "boolean", desc: "Both default to true." },
        { name: "onClose", type: "() => void", desc: "Called whichever way it closes." },
      ],
      demo: () => {
        const open = state(false);
        return (
          <div>
            <div class="cmp-row">{Button({ children: "Open dialog", variant: "primary", onClick: () => open.set(true) })}</div>
            {Dialog({
              open,
              title: "Rename project",
              children: R.div({ style: "font-size:14px" }, "Tab around: focus stays inside. Press Escape to close."),
              footer: R.div(
                { class: "cmp-row", style: "margin:0;justify-content:flex-end" },
                Button({ children: "Cancel", onClick: () => open.set(false) }),
                Button({ children: "Save", variant: "primary", onClick: () => open.set(false) }),
              ),
            })}
          </div>
        );
      },
    },
    {
      slug: "confirm-dialog",
      name: "ConfirmDialog",
      tier: "T1",
      summary:
        "The destructive-action guard. `onConfirm` may return a promise, and the confirm button stays in its loading state until it settles.",
      code: `ConfirmDialog({
  open,
  title: "Delete branch?",
  message: "This cannot be undone.",
  variant: "danger",
  onConfirm: () => api.delete(branch),
});`,
      demo: () => {
        const open = state(false);
        const deleted = state(0);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Delete branch", variant: "danger", onClick: () => open.set(true) })}
              <span class="chip">
                deleted <b>{deleted}</b>×
              </span>
            </div>
            {ConfirmDialog({
              open,
              title: "Delete branch?",
              message: "The branch and its unmerged commits are gone for good.",
              confirmLabel: "Delete",
              variant: "danger",
              onConfirm: () =>
                new Promise<void>((resolve) =>
                  setTimeout(() => {
                    deleted.update((n) => n + 1);
                    resolve();
                  }, 700),
                ),
            })}
          </div>
        );
      },
    },
    {
      slug: "drawer",
      name: "Drawer",
      tier: "T1",
      summary:
        "A panel from any edge. Modal by default; `modeless` gives you a side panel that leaves the page behind it usable — no focus trap, no scroll lock.",
      code: `Drawer({ open, side: "right", title: "Filters", children: filters });`,
      demo: () => {
        const right = state(false);
        const bottom = state(false);
        return (
          <div class="cmp-row">
            {Button({ children: "From the right", onClick: () => right.set(true) })}
            {Button({ children: "From the bottom", onClick: () => bottom.set(true) })}
            {Drawer({
              open: right,
              side: "right",
              title: "Filters",
              children: R.div({ style: "font-size:14px" }, "Escape closes it, and focus comes back to the button."),
            })}
            {Drawer({
              open: bottom,
              side: "bottom",
              size: "220px",
              title: "Details",
              children: R.div({ style: "font-size:14px" }, "Same component, different edge."),
            })}
          </div>
        );
      },
    },
    {
      slug: "popover",
      name: "Popover",
      tier: "T1",
      summary:
        "Content anchored to a trigger, closed by clicking outside. The trigger is a function so the component can hand it the ARIA attributes it needs.",
      code: `Popover({
  trigger: (p) => R.button({ ...p }, "Options"),
  placement: "bottom-start",
  children: panel,
});`,
      demo: () =>
        Popover({
          trigger: triggerButton("Open popover"),
          placement: "bottom-start",
          children: R.div({ style: "font-size:14px;max-width:220px" }, "Anchored, flipped if it would not fit, and closed by a click outside."),
        }),
    },
    {
      slug: "tooltip",
      name: "Tooltip",
      tier: "T1",
      summary: "A short label on hover or focus, after a delay — and it appears on keyboard focus too, which most tooltips forget.",
      code: `Tooltip({ trigger: (p) => R.button({ ...p }, "?"), content: "Signals are pull-based", delay: 300 });`,
      demo: () => (
        <div class="cmp-row">
          {Tooltip({ trigger: triggerButton("Hover me"), content: "Appears after 400 ms" })}
          {Tooltip({ trigger: triggerButton("Or focus me with Tab"), content: "Focus counts as hover", placement: "right" })}
        </div>
      ),
    },
    {
      slug: "hover-card",
      name: "HoverCard",
      tier: "T3",
      summary:
        "The richer cousin of a tooltip: a card with real content, opened lazily on hover and kept open while the pointer travels toward it.",
      code: `HoverCard({ trigger: (p) => R.a({ ...p }, "@ana"), children: profileCard });`,
      demo: () =>
        HoverCard({
          trigger: triggerButton("@ana"),
          openDelay: 250,
          children: R.div(
            { style: "font-size:14px;max-width:240px" },
            R.b({}, "Ana Petrescu"),
            R.div({ style: "color:var(--muted);margin-top:4px" }, "Compiler team · joined 2024"),
          ),
        }),
    },
    {
      slug: "context-menu",
      name: "ContextMenu",
      tier: "T2",
      summary: "Right-click (or the context key) inside a region, and the menu opens at the pointer, clamped to the viewport.",
      code: `ContextMenu({
  entries: [{ key: "rename", label: "Rename", onSelect: rename }],
  children: (p) => R.div({ ...p }, fileRow),
});`,
      demo: () => {
        const last = state("—");
        return (
          <div>
            {ContextMenu({
              entries: [
                { key: "open", label: "Open", onSelect: () => last.set("Open") },
                { key: "rename", label: "Rename", hint: "F2", onSelect: () => last.set("Rename") },
                { key: "sep", separator: true },
                { key: "delete", label: "Delete", onSelect: () => last.set("Delete") },
              ],
              children: (p: Record<string, unknown>) =>
                R.div(
                  {
                    ...p,
                    style:
                      "border:1px dashed var(--border-strong);border-radius:8px;padding:22px;text-align:center;font-size:14px;color:var(--muted)",
                  },
                  "Right-click anywhere in this box",
                ),
            })}
            <div class="cmp-row" style="margin-top:10px">
              <span class="chip">
                chose: <b>{last}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "dropdown-menu",
      name: "DropdownMenu",
      tier: "T1",
      summary:
        "A button that opens a menu: arrows move, typing jumps, Escape closes, and the outside-click listener is attached only while it is open.",
      code: `DropdownMenu({
  trigger: "Actions",
  entries: [menuItem("Duplicate", dup, { hint: "Ctrl+D" }), menuSeparator(), menuItem("Delete", del)],
});`,
      demo: () => {
        const last = state("—");
        return (
          <div class="cmp-row">
            {DropdownMenu({
              trigger: "Actions",
              entries: [
                menuItem("Duplicate", () => last.set("Duplicate"), { hint: "Ctrl+D" }),
                menuItem("Move to…", () => last.set("Move")),
                menuItem("Archive", () => last.set("Archive"), { disabled: true }),
                menuSeparator(),
                menuItem("Delete", () => last.set("Delete")),
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
      slug: "toaster",
      name: "Toast & Toaster",
      tier: "T1",
      summary:
        "A queue with a cap, de-duplication by key, pause on hover, and an optional action per toast. `createToaster()` is the store; `Toaster` only renders it.",
      code: `const toaster = createToaster({ duration: 4000, max: 3 });
toaster.success("Saved");
toaster.error("Could not save", { action: { label: "Retry", onClick: retry } });

// once, near the root:
Toaster({ toaster, position: "bottom-right" });`,
      props: [
        { name: "createToaster(options)", type: "Toaster", desc: "duration and max; returns push/dismiss/clear plus info/success/warning/error." },
        { name: "ToastOptions.key", type: "string", desc: "De-duplication: a second toast with the same key replaces the first." },
        { name: "ToastOptions.duration", type: "number", desc: "0 keeps it until dismissed." },
        { name: "position", type: `"top-right" | … | "bottom-center"`, desc: "Where the stack sits." },
      ],
      demo: () => {
        const toaster = createToaster({ duration: 3500, max: 3 });
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Info", size: "sm", onClick: () => { toaster.info("Rebuilt in 42 ms"); } })}
              {Button({ children: "Success", size: "sm", variant: "primary", onClick: () => { toaster.success("Saved"); } })}
              {Button({ children: "Warning", size: "sm", onClick: () => { toaster.warning("Two files skipped"); } })}
              {Button({
                children: "Error + action",
                size: "sm",
                variant: "danger",
                onClick: () => {
                  toaster.error("Could not reach the server", {
                    duration: 0,
                    action: { label: "Retry", onClick: () => { toaster.success("Connected"); } },
                  });
                },
              })}
              {Button({ children: "Clear", size: "sm", onClick: () => toaster.clear() })}
            </div>
            {Toaster({ toaster, position: "bottom-right" })}
          </div>
        );
      },
      notes: ["Hover the stack: the timers pause until the pointer leaves."],
    },
    {
      slug: "notification",
      name: "Notification",
      tier: "T2",
      summary: "The persistent sibling of a toast — an entry in a notification centre, with a timestamp, actions and an unread dot.",
      code: `Notification({ title: "Build failed", children: "3 tests are red.", tone: "danger", actions: …, unread: () => true });`,
      demo: () => (
        <div style="display:grid;gap:10px;max-width:420px">
          {Notification({
            title: "Build failed",
            tone: "danger",
            timestamp: "2 min ago",
            unread: () => true,
            children: "3 tests are red on branch wire/resync.",
            actions: R.div({ class: "cmp-row", style: "margin:0" }, Button({ children: "View log", size: "sm" })),
          })}
          {Notification({ title: "Deploy finished", tone: "success", timestamp: "1 h ago", children: "v0.1.0-alpha is live." })}
        </div>
      ),
    },
    {
      slug: "backdrop",
      name: "Backdrop",
      tier: "T2",
      summary: "The dimming layer behind an overlay, with an optional blur and a click handler — used on its own when you build your own overlay.",
      code: `Backdrop({ visible: () => open(), blur: true, onClick: () => open.set(false) });`,
      demo: () => {
        const on = state(false);
        return (
          <div>
            <div class="cmp-row">{Button({ children: "Show backdrop for 1.5 s", onClick: () => { on.set(true); setTimeout(() => on.set(false), 1500); } })}</div>
            {Backdrop({ visible: () => on(), blur: true, onClick: () => on.set(false) })}
          </div>
        );
      },
    },
    {
      slug: "lightbox",
      name: "Lightbox",
      tier: "T3",
      summary: "One image, full screen, with arrow-key navigation and a caption. `Gallery` opens it for you; you can also drive it yourself.",
      code: `Lightbox({ images, open, index });`,
      demo: () => {
        const open = state(false);
        const index = state(0);
        return (
          <div>
            <div class="cmp-row">
              {Button({ children: "Open lightbox", onClick: () => { index.set(0); open.set(true); } })}
            </div>
            {Lightbox({ images: SAMPLE_IMAGES, open, index })}
          </div>
        );
      },
    },
    {
      slug: "tour",
      name: "Tour",
      tier: "T3",
      summary: "Step-by-step onboarding: each step spotlights an element by id and explains it, with skip and finish.",
      code: `Tour({ open, steps: [{ target: "sidebar", title: "Navigation", content: "…" }] });`,
      demo: () => {
        const open = state(false);
        return (
          <div>
            <div class="cmp-row">
              <span id="tour-demo-a" class="chip">
                first stop
              </span>
              <span id="tour-demo-b" class="chip">
                second stop
              </span>
              {Button({ children: "Start the tour", variant: "primary", onClick: () => open.set(true) })}
            </div>
            {Tour({
              open,
              steps: [
                { target: "tour-demo-a", title: "This one first", content: "The spotlight follows the element you name." },
                { target: "tour-demo-b", title: "Then this", content: "Arrows and Escape work throughout." },
                { title: "That is it", content: "A step with no target is centred." },
              ],
            })}
          </div>
        );
      },
    },
    {
      slug: "positioner",
      name: "Positioner",
      tier: "T1",
      summary:
        "The headless engine under every overlay here: it computes a position for a floating element, flips it to the opposite side when it would not fit, and slides it along the other axis to stay on screen.",
      code: `const pos = positioner({ placement: "bottom-start", offset: 6 });
R.button({ ref: pos.reference }, "Trigger");
R.div({ ref: pos.floating, style: pos.style }, panel);
pos.placement(); // the side actually used, after flipping`,
      props: [
        { name: "placement", type: "Placement", desc: `Side plus alignment: "top", "bottom-start", "right-end"…` },
        { name: "offset / padding", type: "number", desc: "Distance from the trigger, and the margin kept from the screen edge." },
        { name: "flip / shift", type: "boolean", desc: "Collision strategies; both on by default." },
        { name: "update(rects?)", type: "function", desc: "Recompute — with explicit rectangles in tests, so positioning is testable without layout." },
      ],
      demo: () => {
        const placement = state<string>("bottom-start");
        return (
          <div>
            <div class="cmp-row">
              {SegmentedControl({
                value: placement,
                label: "Placement",
                options: [
                  { value: "top", label: "top" },
                  { value: "bottom-start", label: "bottom-start" },
                  { value: "right", label: "right" },
                  { value: "left-end", label: "left-end" },
                ],
              })}
            </div>
            <div class="cmp-row" style="justify-content:center;padding:20px 0">
              {() =>
                Popover({
                  trigger: triggerButton("Open here"),
                  placement: placement() as Placement,
                  children: R.div({ style: "font-size:14px;max-width:200px" }, "Scroll the page with this open — it is repositioned, and flips when it runs out of room."),
                })
              }
            </div>
          </div>
        );
      },
    },
  ],
};
