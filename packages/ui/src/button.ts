/**
 * Button / IconButton - butoane cu variante, dimensiuni si stare de incarcare.
 *
 * Nu e o componenta-teza si nu pretinde sa fie: un buton nu demonstreaza nimic
 * despre fine-grained. E aici fiindca totul de deasupra are nevoie de el si
 * fiindca detaliile pe care le rezolva (tipul implicit, `aria-busy`, dezactivarea
 * in timpul unei actiuni asincrone) sunt exact cele uitate cand fiecare isi
 * scrie propriul buton.
 */
import { state, type Accessor } from "@raptor/core";
import { R, Show, type Child } from "@raptor/dom";

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  children?: Child;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: Accessor<boolean> | boolean;
  /** Arata spinner si blocheaza clickurile. */
  loading?: Accessor<boolean> | boolean;
  /**
   * `onClick` poate intoarce o promisiune: cat timp e in curs, butonul intra
   * singur in `loading` si nu mai accepta clickuri. Asta elimina bug-ul clasic
   * al dublei trimiteri de formular.
   */
  onClick?: (event: any) => void | Promise<unknown>;
  /** Implicit `button` - NU `submit`, ca sa nu trimita din greseala formulare. */
  type?: "button" | "submit" | "reset";
  /** Continut inaintea/dupa eticheta (iconite). */
  before?: Child;
  after?: Child;
  /** Ocupa toata latimea disponibila. */
  block?: boolean;
  label?: string;
  class?: string;
}

function read(value: Accessor<boolean> | boolean | undefined): boolean {
  if (value === undefined) return false;
  return typeof value === "function" ? value() : value;
}

export function Button(props: ButtonProps): El {
  // Incarcare interna, pentru `onClick` asincron.
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
  /** Obligatoriu: un buton doar-icon fara nume accesibil e invizibil la screen reader. */
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
