/**
 * Primitive headless - comportament fara markup si fara CSS.
 *
 * Se atașeaza prin `ref` (`R.div({ ref: clickOutside(close) })`) sau intorc
 * semnale (`const wide = mediaQuery("(min-width: 768px)")`). Toate se curata
 * singure la dispose: niciun listener global nu supravietuieste componentei.
 *
 * Sunt fundatia pentru restul bibliotecii - `Dialog` are nevoie de `Portal` +
 * `focusTrap`, `Popover` de `clickOutside`, `DataGrid` de `virtualizer`.
 */
export { Portal, type PortalProps } from "./portal.ts";
export { VisuallyHidden, VisuallyHiddenFocusable } from "./visually-hidden.ts";
export { clickOutside, type ClickOutsideOptions } from "./click-outside.ts";
export { focusTrap, type FocusTrapOptions } from "./focus-trap.ts";
export { hotkeys, type HotkeyMap, type HotkeyOptions } from "./hotkeys.ts";
export { Transition, transitionClass, type TransitionProps } from "./transition.ts";
export { mediaQuery, breakpoints, prefersReducedMotion } from "./media-query.ts";
export { clipboard, type Clipboard } from "./clipboard.ts";
export {
  draggable,
  droppable,
  dragPayload,
  sortable,
  type Draggable,
  type DraggableOptions,
  type DragEvent,
  type Droppable,
  type DroppableOptions,
  type Sortable,
  type SortableOptions,
} from "./drag.ts";
export { resizable, type Resizable, type ResizableOptions } from "./resizable.ts";
export { virtualizer, type Virtualizer, type VirtualizerOptions } from "./virtualizer.ts";
export {
  intersects,
  infiniteScroll,
  type Intersect,
  type IntersectOptions,
  type InfiniteScroll,
  type InfiniteScrollOptions,
} from "./intersect.ts";
export {
  positioner,
  type Positioner,
  type PositionerOptions,
  type Placement,
  type Side,
  type Align,
  type Rect,
} from "./positioner.ts";
export {
  persistedState,
  undoRedo,
  selectionState,
  type PersistOptions,
  type UndoRedo,
  type UndoRedoOptions,
  type SelectionState,
  type SelectionOptions,
  idle,
  networkStatus,
  type IdleOptions,
  type NetworkStatus,
} from "./stores.ts";
