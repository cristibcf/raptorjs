/**
 * The component catalog: every group the site documents, in sidebar order.
 * Adding a component is one entry in its group file — the routes, the sidebar,
 * the index page and prev/next all derive from this array.
 */
import type { CatalogGroup, ComponentDoc } from "./types.ts";
import { LAYOUT } from "./layout.tsx";
import { TYPOGRAPHY } from "./typography.tsx";
import { BUTTONS } from "./buttons.tsx";
import { INPUTS } from "./inputs.tsx";
import { SELECTION } from "./selection.tsx";
import { DATE } from "./date.tsx";
import { FILES } from "./files.tsx";
import { FORMS } from "./forms.tsx";
import { NAVIGATION } from "./navigation.tsx";
import { OVERLAYS } from "./overlays.tsx";
import { DATA } from "./data.tsx";
import { FEEDBACK } from "./feedback.tsx";
import { CHARTS } from "./charts.tsx";
import { MEDIA } from "./media.tsx";
import { PRIMITIVES } from "./primitives.tsx";

export type { CatalogGroup, ComponentDoc, PropDoc } from "./types.ts";

export const CATALOG: CatalogGroup[] = [LAYOUT, TYPOGRAPHY, BUTTONS, INPUTS, SELECTION, DATE, FILES, FORMS, NAVIGATION, OVERLAYS, DATA, FEEDBACK, CHARTS, MEDIA, PRIMITIVES];

/** Flat list in sidebar order, used for lookup and prev/next. */
export const ALL_COMPONENTS: ComponentDoc[] = CATALOG.flatMap((g) => g.items);

export const COMPONENT_COUNT = ALL_COMPONENTS.length;

export function findComponent(slug: string): ComponentDoc | null {
  return ALL_COMPONENTS.find((c) => c.slug === slug) ?? null;
}

export function groupOf(slug: string): CatalogGroup | null {
  return CATALOG.find((g) => g.items.some((c) => c.slug === slug)) ?? null;
}
