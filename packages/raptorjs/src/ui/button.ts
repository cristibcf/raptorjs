/**
 * Button / IconButton - buttons with variants, sizes and a loading state.
 *
 * It's not a thesis component and doesn't pretend to be: a button demonstrates
 * nothing about fine-grained. It's here because everything above needs it and
 * because the details it handles (the default type, `aria-busy`, disabling
 * during an async action) are exactly the ones forgotten when everyone writes
 * their own button.
 */
import { state, type Accessor } from "raptorjs";
import { R, Show, type Child } from "raptorjs/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  children?: Child;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: Accessor<boolean> | boolean;
  /** Shows a spinner and blocks clicks. */
  loading?: Accessor<boolean> | boolean;
  /**
   * `onClick` can return a promise: while it is in progress, the button puts
   * itself into `loading` and stops accepting clicks. This eliminates the
   * classic double-submit bug on forms.
   */
  onClick?: (event: any) => void | Promise<unknown>;
  /** Defaults to `button` - NOT `submit`, so it doesn't submit forms by mistake. */
  type?: "button" | "submit" | "reset";
  /** Content before/after the label (icons). */
  before?: Child;
  after?: Child;
  /** Takes up all the available width. */
  block?: boolean;
  label?: string;
  class?: string;
}

function read(value: Accessor<boolean> | boolean | undefined): boolean {
  if (value === undefined) return false;
  return typeof value === "function" ? value() : value;
}

export function Button(props: ButtonProps): El {
  // Internal loading, for async `onClick`.
  const pending = state(false);
  const busy = (): boolean => read(props.loading) || pending();
  const blocked = (): boolean => busy() || read(props.disabled);

  const onClick = (event: any): void => {
    if (blocked()) {
      event.preventDefault?.();
      return;
    }
    const result = props.onClick?.(event);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      pending.set(true);
      const done = (): void => pending.set(false);
      (result as Promise<unknown>).then(done, done);
    }
  };

  return R.button(
    {
      type: props.type ?? "button",
      class: () => {
        let cls = "rui-btn rui-btn-" + (props.variant ?? "primary") + " rui-btn-" + (props.size ?? "md");
        if (props.block) cls += " rui-btn-block";
        if (busy()) cls += " rui-loading";
        if (props.class) cls += " " + props.class;
        return cls;
      },
      disabled: () => blocked(),
      "aria-busy": () => (busy() ? "true" : "false"),
      ...(props.label ? { "aria-label": props.label } : {}),
      "on:click": onClick,
    },
    Show({
      when: () => busy(),
      children: R.span({ class: "rui-btn-spinner", "aria-hidden": "true" }),
    }),
    props.before ?? null,
    props.children ?? null,
    props.after ?? null,
  );
}

export interface IconButtonProps extends Omit<ButtonProps, "children" | "before" | "after" | "block"> {
  icon: Child;
  /** Required: an icon-only button with no accessible name is invisible to screen readers. */
  label: string;
}

export function IconButton(props: IconButtonProps): El {
  return Button({
    ...props,
    class: "rui-btn-icon" + (props.class ? " " + props.class : ""),
    children: R.span({ "aria-hidden": "true" }, props.icon),
  });
}

export interface ButtonGroupProps {
  children: Child;
  label?: string;
  class?: string;
}

export function ButtonGroup(props: ButtonGroupProps): El {
  return R.div(
    {
      class: props.class ? "rui-btn-group " + props.class : "rui-btn-group",
      role: "group",
      ...(props.label ? { "aria-label": props.label } : {}),
    },
    props.children,
  );
}
