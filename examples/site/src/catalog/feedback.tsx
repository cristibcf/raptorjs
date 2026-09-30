/** Feedback and state. */
import { state, R, onCleanup } from "raptorjs/dom";
import { Button } from "raptorjs/ui/button";
import { Meter } from "raptorjs/ui/chart-extra";
import {
  Alert,
  Banner,
  Callout,
  EmptyState,
  LoadingOverlay,
  Result,
  Skeleton,
  Spinner,
} from "raptorjs/ui/display";
import { ErrorBoundary } from "raptorjs/ui/overlay-extra";
import { CircularProgress, Progress } from "raptorjs/ui/progress";
import type { CatalogGroup } from "./types.ts";

export const FEEDBACK: CatalogGroup = {
  slug: "feedback",
  title: "Feedback & state",
  blurb: "Loading, empty, partial, broken. The states an interface spends most of its life in.",
  items: [
    {
      slug: "progress",
      name: "Progress",
      tier: "T1",
      thesis:
        "A progress value that ticks sixty times a second writes one attribute and one inline width — not a re-render, not a diff. The bar is the cheapest possible proof of what fine-grained means.",
      summary:
        "A determinate bar, or an indeterminate one when you do not know the total. `caption: true` prints the percentage next to it.",
      code: `const done = state(0);
Progress({ value: () => done(), max: 100, caption: true, label: "Upload" });
Progress({ indeterminate: true, label: "Working" });`,
      props: [
        { name: "value", type: "Accessor<number>", desc: "Omit it (or set indeterminate) for the unknown-total bar." },
        { name: "min / max", type: "number", desc: "The range. Default 0–100." },
        { name: "caption", type: "Child | true", desc: "true prints the percentage; anything else is shown as given." },
        { name: "label", type: "string", desc: "The name a screen reader reads for the bar." },
      ],
      demo: () => {
        const done = state(18);
        const timer = setInterval(() => done.update((n) => (n >= 100 ? 0 : n + 2)), 120);
        onCleanup(() => clearInterval(timer));
        return (
          <div>
            {Progress({ value: () => done(), caption: true, label: "Upload" })}
            <div style="height:14px"></div>
            {Progress({ indeterminate: true, label: "Working" })}
          </div>
        );
      },
    },
    {
      slug: "circular-progress",
      name: "CircularProgress",
      tier: "T2",
      summary: "The same value drawn as a ring — for tight spaces and dashboards.",
      code: `CircularProgress({ value: () => done(), size: 56, thickness: 6, caption: true });`,
      demo: () => {
        const done = state(64);
        return (
          <div class="cmp-row">
            {CircularProgress({ value: () => done(), size: 64, caption: true, label: "Storage used" })}
            {CircularProgress({ indeterminate: true, size: 40, label: "Loading" })}
            {Button({ children: "−10", size: "sm", onClick: () => done.update((n) => Math.max(0, n - 10)) })}
            {Button({ children: "+10", size: "sm", onClick: () => done.update((n) => Math.min(100, n + 10)) })}
          </div>
        );
      },
    },
    {
      slug: "spinner",
      name: "Spinner",
      tier: "T1",
      summary: "The indeterminate indicator, with a screen-reader label — because a spinning shape announces nothing on its own.",
      code: `Spinner({ size: "md", label: "Loading results" });`,
      demo: () => (
        <div class="cmp-row">
          {Spinner({ size: "sm" })}
          {Spinner({ size: "md" })}
          {Spinner({ size: "lg", label: "Loading results" })}
        </div>
      ),
    },
    {
      slug: "skeleton",
      name: "Skeleton",
      tier: "T1",
      summary:
        "A placeholder in the shape of the content that is coming, so the layout does not jump when it arrives.",
      code: `Skeleton({ variant: "text", lines: 3 });
Skeleton({ variant: "circle", width: "48px", height: "48px" });`,
      demo: () => (
        <div class="cmp-row" style="align-items:flex-start;gap:16px">
          {Skeleton({ variant: "circle", width: "48px", height: "48px" })}
          <div style="flex:1;max-width:320px">{Skeleton({ variant: "text", lines: 3 })}</div>
          {Skeleton({ variant: "rect", width: "120px", height: "72px" })}
        </div>
      ),
    },
    {
      slug: "loading-overlay",
      name: "LoadingOverlay",
      tier: "T2",
      summary:
        "Covers one region while it refreshes, instead of blanking the whole page. The old content stays visible underneath, which is usually what people want.",
      code: `LoadingOverlay({ visible: () => refreshing(), children: panel });`,
      demo: () => {
        const busy = state(false);
        return (
          <div>
            <div class="cmp-row">
              {Button({
                children: "Refresh for 1.5 s",
                onClick: () => {
                  busy.set(true);
                  setTimeout(() => busy.set(false), 1500);
                },
              })}
            </div>
            {LoadingOverlay({
              visible: () => busy(),
              label: "Refreshing",
              children: R.div(
                { class: "cmp-panel", style: "font-size:14px" },
                "This panel stays readable while it refreshes — only dimmed and marked busy.",
              ),
            })}
          </div>
        );
      },
    },
    {
      slug: "alert",
      name: "Alert",
      tier: "T1",
      summary: "A message with a severity and an optional dismiss. It carries the right role, so an error is announced, not just coloured.",
      code: `Alert({ tone: "danger", title: "Build failed", children: "3 tests are red.", onDismiss: hide });`,
      demo: () => {
        const shown = state(true);
        return (
          <div style="display:grid;gap:10px">
            {Alert({ tone: "info", title: "Heads up", children: "The protocol is still at 0.2." })}
            {Alert({ tone: "success", title: "Deployed", children: "v0.1.0-alpha is live." })}
            {Alert({ tone: "warning", children: "Two files were skipped." })}
            {() =>
              shown()
                ? Alert({ tone: "danger", title: "Build failed", children: "3 tests are red.", onDismiss: () => shown.set(false) })
                : Button({ children: "Bring the error back", size: "sm", onClick: () => shown.set(true) })
            }
          </div>
        );
      },
    },
    {
      slug: "callout",
      name: "Callout",
      tier: "T2",
      summary: "The same shape as an Alert, but for prose: it does not announce itself, because a note inside a document is not an event.",
      code: `Callout({ tone: "accent", title: "Note", children: "Signals are pull-based." });`,
      demo: () => (
        <div style="display:grid;gap:10px">
          {Callout({ tone: "info", title: "Note", children: "Reading a signal inside a binding subscribes that binding." })}
          {Callout({ tone: "warning", title: "Careful", children: "Writing a signal inside a derived value is a loop waiting to happen." })}
        </div>
      ),
    },
    {
      slug: "banner",
      name: "Banner",
      tier: "T2",
      summary: "A full-width strip at the top of the page for things that affect everything: maintenance, a trial ending, an outage.",
      code: `Banner({ tone: "warning", action: Button({ children: "Upgrade" }), children: "Your trial ends in 3 days." });`,
      demo: () =>
        Banner({
          tone: "warning",
          children: "Your trial ends in 3 days.",
          action: Button({ children: "Upgrade", size: "sm" }),
          onDismiss: () => {},
        }),
    },
    {
      slug: "result",
      name: "Result",
      tier: "T2",
      summary: "The whole-page outcome: success, error, 404, 403, 500 — with a way out.",
      code: `Result({ status: "404", title: "Page not found", action: Button({ children: "Go home" }) });`,
      demo: () =>
        Result({
          status: "404",
          title: "Page not found",
          description: "The page you asked for is not here — it may have moved.",
          action: Button({ children: "Go home", variant: "primary" }),
        }),
    },
    {
      slug: "empty-state-feedback",
      name: "EmptyState (feedback)",
      tier: "T2",
      summary: "Listed under data display too, because an empty result and an empty collection are the same screen with different words.",
      code: `EmptyState({ title: "No results", description: "Try a shorter query." });`,
      demo: () => EmptyState({ icon: "⌕", title: "No results", description: "Try a shorter query, or clear the filters." }),
    },
    {
      slug: "meter",
      name: "Meter",
      tier: "T3",
      summary:
        "A measurement inside a known range — disk usage, a score, a quota. Unlike progress, it is not going anywhere; `low`, `high` and `optimum` decide whether the current value is good.",
      code: `Meter({ value: () => usedGb(), max: 100, low: 20, high: 80, optimum: 10 });`,
      demo: () => {
        const used = state(72);
        return (
          <div>
            {Meter({ value: () => used(), max: 100, low: 20, high: 80, optimum: 10, label: "Disk used", format: (v: number) => v + " GB of 100 GB" })}
            <div class="cmp-row" style="margin-top:12px">
              {Button({ children: "Free up", size: "sm", onClick: () => used.update((n) => Math.max(0, n - 20)) })}
              {Button({ children: "Fill up", size: "sm", onClick: () => used.update((n) => Math.min(100, n + 20)) })}
            </div>
          </div>
        );
      },
    },
    {
      slug: "error-boundary",
      name: "ErrorBoundary",
      tier: "T2",
      summary:
        "Catches an error thrown while building its children and shows a fallback with a retry, instead of leaving half a page mounted.",
      code: `ErrorBoundary({
  children: () => riskyPanel(),
  fallback: (err, retry) => Result({ status: "error", title: String(err), action: Button({ children: "Retry", onClick: retry }) }),
});`,
      demo: () => {
        let explode = true;
        return ErrorBoundary({
          children: () => {
            if (explode) throw new Error("The panel could not be built");
            return R.div({ class: "cmp-panel", style: "font-size:14px" }, "Rebuilt without throwing this time.");
          },
          fallback: (err: unknown, retry: () => void) =>
            Alert({
              tone: "danger",
              title: "Something went wrong",
              children: R.div(
                {},
                R.div({ style: "margin-bottom:10px" }, String((err as Error)?.message ?? err)),
                Button({
                  children: "Retry",
                  size: "sm",
                  onClick: () => {
                    explode = false;
                    retry();
                  },
                }),
              ),
            }),
        });
      },
      notes: ["The demo throws on the first build and succeeds on the retry."],
    },
  ],
};
