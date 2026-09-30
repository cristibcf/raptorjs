/**
 * Tabs - tabs with roving tabindex and arrow-key navigation.
 *
 * Only the active tab is in the Tab order; arrows move between tabs. That's
 * what the ARIA pattern requires: a set of 8 tabs shouldn't cost 8 Tab presses
 * to get past.
 *
 * `activation: "manual"` (default) moves focus without changing the panel until
 * Enter/Space - important when the panels are expensive or load data.
 */
import { state, type Accessor, type State } from "@raptorstack/raptorjs";
import { R, For, Show, type Child } from "@raptorstack/raptorjs/dom";
import { type El } from "./primitives/env.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

let idSeq = 0;

export interface Tab {
  /** Stable key; becomes part of the ARIA `id`s. */
  key: string;
  label: Child;
  content: Child | (() => Child);
  disabled?: boolean;
}

export interface TabsProps {
  tabs: readonly Tab[];
  /** The active tab. Pass a signal if you want to control it from outside. */
  active?: State<string>;
  /** The initial key, if you don't pass `active`. */
  initial?: string;
  orientation?: "horizontal" | "vertical";
  /**
   * `automatic` changes the panel together with focus (arrows), `manual`
   * requires Enter/Space. Default `manual`.
   */
  activation?: "automatic" | "manual";
  /** Renders the panel only when it becomes active, and keeps it mounted after. */
  lazy?: boolean;
  onChange?: (key: string) => void;
  label?: string;
  class?: string;
}

export interface TabsHandle {
  el: El;
  active: Accessor<string>;
  select: (key: string) => void;
}

export function tabs(props: TabsProps): TabsHandle {
  const id = "rui-tabs-" + ++idSeq;
  const first = props.tabs.find((t) => !t.disabled)?.key ?? props.tabs[0]?.key ?? "";
  const active = props.active ?? state(props.initial ?? first);
  const activation = props.activation ?? "manual";
  const vertical = props.orientation === "vertical";

  // Focus can be on a tab other than the active one (manual activation).
  const focused = state(active.peek());
  const buttons = new Map<string, El>();
  /** The panels already visited, for `lazy`. */
  const seen = new Set<string>([active.peek()]);

  const tabId = (key: string): string => id + "-tab-" + key;
  const panelId = (key: string): string => id + "-panel-" + key;

  const selectable = (): Tab[] => props.tabs.filter((t) => !t.disabled);

  const select = (key: string): void => {
    const tab = props.tabs.find((t) => t.key === key);
    if (!tab || tab.disabled) return;
    seen.add(key);
    focused.set(key);
    if (active.peek() === key) return;
    active.set(key);
    props.onChange?.(key);
  };

  const focusTab = (key: string): void => {
    focused.set(key);
    const el = buttons.get(key);
    if (el && typeof el.focus === "function") el.focus();
    if (activation === "automatic") select(key);
  };

  const move = (delta: number): void => {
    const list = selectable();
    if (list.length === 0) return;
    const current = list.findIndex((t) => t.key === focused.peek());
    const next = current === -1 ? 0 : (current + delta + list.length) % list.length;
    focusTab(list[next]!.key);
  };

  const onKeydown = (e: any): void => {
    const prevKey = vertical ? "ArrowUp" : "ArrowLeft";
    const nextKey = vertical ? "ArrowDown" : "ArrowRight";
    switch (e.key) {
      case nextKey:
        e.preventDefault?.();
        move(1);
        break;
      case prevKey:
        e.preventDefault?.();
        move(-1);
        break;
      case "Home": {
        e.preventDefault?.();
        const list = selectable();
        if (list[0]) focusTab(list[0].key);
        break;
      }
      case "End": {
        e.preventDefault?.();
        const list = selectable();
        if (list[list.length - 1]) focusTab(list[list.length - 1]!.key);
        break;
      }
      case "Enter":
      case " ":
        if (activation === "manual") {
          e.preventDefault?.();
          select(focused.peek());
        }
        break;
    }
  };

  const el = R.div(
    {
      class: () =>
        "rui-tabs rui-" + (vertical ? "vertical" : "horizontal") + (props.class ? " " + props.class : ""),
    },
    R.div(
      {
        class: "rui-tablist",
        role: "tablist",
        "aria-orientation": vertical ? "vertical" : "horizontal",
        ...(props.label ? { "aria-label": props.label } : {}),
        "on:keydown": onKeydown,
      },
      For({
        each: () => props.tabs,
        children: (tab: Tab) =>
          R.button({
            id: tabId(tab.key),
            type: "button",
            class: () => {
              let cls = "rui-tab";
              if (active() === tab.key) cls += " rui-active";
              if (tab.disabled) cls += " rui-disabled";
              return cls;
            },
            role: "tab",
            "aria-selected": () => String(active() === tab.key),
            "aria-controls": panelId(tab.key),
            disabled: tab.disabled === true,
            // Roving tabindex: only one tab is tabbable.
            tabindex: () => (focused() === tab.key ? "0" : "-1"),
            ref: (node: El) => {
              if (node) buttons.set(tab.key, node);
            },
            "on:click": () => select(tab.key),
            "on:focus": () => focused.set(tab.key),
          }, tab.label),
      }),
    ),
    For({
      each: () => props.tabs,
      children: (tab: Tab) =>
        R.div(
          {
            id: panelId(tab.key),
            class: "rui-tabpanel",
            role: "tabpanel",
            "aria-labelledby": tabId(tab.key),
            // The inactive panel stays in the DOM but hidden: that way Ctrl+F
            // finds it and we don't lose its state (filled inputs, scroll).
            hidden: () => active() !== tab.key,
            tabindex: "0",
          },
          props.lazy
            ? Show({
                when: () => active() === tab.key || seen.has(tab.key),
                children: () => (typeof tab.content === "function" ? tab.content() : tab.content),
              })
            : typeof tab.content === "function"
              ? tab.content()
              : tab.content,
        ),
    }),
  );

  return { el, active: () => active(), select };
}

/** Component variant. */
export function Tabs(props: TabsProps): El {
  return tabs(props).el;
}
