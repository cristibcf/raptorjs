/**
 * Headless primitives - behavior with no markup and no CSS.
 *
 * They attach via `ref` (`R.div({ ref: clickOutside(close) })`) or return
 * signals (`const wide = mediaQuery("(min-width: 768px)")`). They all clean up
 * after themselves on dispose: no global listener outlives the component.
 *
 * They are the foundation for the rest of the library - `Dialog` needs `Portal` +
 * `focusTrap`, `Popover` needs `clickOutside`, `DataGrid` needs `virtualizer`.
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
