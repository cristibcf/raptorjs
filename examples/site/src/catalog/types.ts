/**
 * Shape of the component catalog. Every entry is data plus a `demo` that builds
 * real DOM with the shipped component — nothing on this page is a screenshot.
 */

export interface PropDoc {
  name: string;
  type: string;
  desc: string;
}

export interface ComponentDoc {
  /** URL segment: #/components/<slug>. */
  slug: string;
  name: string;
  summary: string;
  /** How central the component is: T1 core, T2 expected, T3 specialised. */
  tier?: "T1" | "T2" | "T3";
  /** Why fine-grained updates are measurably better here (the ⚡ entries). */
  thesis?: string;
  /** Source of the demo, shown under it. */
  code: string;
  /** Builds the live demo. Called fresh every time the page is opened. */
  demo: () => any;
  props?: PropDoc[];
  /** Extra remarks, rendered as a list with inline markup. */
  notes?: string[];
}

export interface CatalogGroup {
  slug: string;
  title: string;
  blurb: string;
  items: ComponentDoc[];
}
