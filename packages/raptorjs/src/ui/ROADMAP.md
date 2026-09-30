# raptorjs/ui — roadmap of 200 components

Status: **198 / 200** implemented. Waves 1-6 are complete. The two remaining (`PdfViewer`, `Map`) cannot be done honestly zero-dependency — see the reason in the table.

## How the list is ordered

- **Tier 1 (T1)** — the core. Without these the library isn't usable.
- **Tier 2 (T2)** — expected of a serious library.
- **Tier 3 (T3)** — specialized or large. Each is a project in itself.
- ⚡ = **thesis component**: here fine-grained is *measurably* better than VDOM, and
  the test with `stats.createElement` / `stats.textUpdate` on the mini-dom proves it.
  These are the framework's argument, not just widgets. Build them early.

Every delivered component comes with: a mini-dom test, ARIA, keyboard, zero mandatory
CSS (only `rui-*` classes), an entry in `docs/USAGE.md`.

---

## A. Layout and structure (18)

| # | Component | What it is | Tier |
|---|---|---|---|
| 1 | Box | ✅ **implemented** — style/spacing primitive | T1 |
| 2 | Stack | ✅ **implemented** — VStack / HStack with gap | T1 |
| 3 | Flex | ✅ **implemented** — flexbox wrapper | T1 |
| 4 | Grid | ✅ **implemented** — grid with responsive spans | T1 |
| 5 | SimpleGrid | ✅ **implemented** — automatic columns | T2 |
| 6 | Container | ✅ **implemented** — max width + gutters | T1 |
| 7 | Center | ✅ **implemented** — centering on both axes | T2 |
| 8 | Spacer | ✅ **implemented** — flexible space | T2 |
| 9 | Divider | ✅ **implemented** — horizontal/vertical separator | T1 |
| 10 | AspectRatio | ✅ **implemented** — fixed ratio | T2 |
| 11 | ScrollArea | ✅ **implemented** — scroll with styled bar | T2 |
| 12 | SplitPane ⚡ | ✅ **implemented** — component with panes + handle + persistence, on top of the `resizable` behavior (#189) | T1 |
| 13 | AppShell | ✅ **implemented** — header + sidebar + content | T2 |
| 14 | Sidebar | ✅ **implemented** — collapsible side panel | T2 |
| 15 | Masonry | ✅ **implemented** — layout in uneven columns | T3 |
| 16 | Group | ✅ **implemented** — horizontal grouping with spacing | T2 |
| 17 | Affix / Sticky | ✅ **implemented** — element stuck on scroll | T3 |
| 18 | SafeArea | ✅ **implemented** — padding for mobile notch | T3 |

## B. Typography (10)

| # | Component | What it is | Tier |
|---|---|---|---|
| 19 | Text | ✅ **implemented** — text with semantic variants | T1 |
| 20 | Heading | ✅ **implemented** — h1–h6 with scale | T1 |
| 21 | Link | ✅ **implemented** — anchor with states | T1 |
| 22 | Code | ✅ **implemented** — inline code | T2 |
| 23 | CodeBlock | ✅ **implemented** — block with highlight + copy | T2 |
| 24 | Kbd | ✅ **implemented** — displayed key | T3 |
| 25 | Blockquote | ✅ **implemented** — quote | T3 |
| 26 | TextList | ✅ **implemented** — ordered/unordered list, purely typographic | T2 |
| 27 | Truncate / LineClamp | ✅ **implemented** — cut off at N lines | T2 |
| 28 | Mark / Highlight | ✅ **implemented** — search highlight | T3 |

## C. Buttons and actions (10)

| # | Component | What it is | Tier |
|---|---|---|---|
| 29 | Button | ✅ **implemented** — variants, sizes, loading state | T1 |
| 30 | IconButton | ✅ **implemented** — icon-only button with aria-label | T1 |
| 31 | ButtonGroup | ✅ **implemented** — attached buttons | T2 |
| 32 | ToggleButton | ✅ **implemented** — button with on/off state | T2 |
| 33 | SplitButton | ✅ **implemented** — action + dropdown | T3 |
| 34 | FloatingActionButton | ✅ **implemented** — FAB | T3 |
| 35 | CopyButton | ✅ **implemented** — copy to clipboard + feedback | T2 |
| 36 | CloseButton | ✅ **implemented** — standardized ✕ | T2 |
| 37 | LoadingButton | ✅ **implemented** — not a separate component: `Button({ loading })`, plus automatic `loading` for async `onClick` | T2 |
| 38 | ToggleGroup | ✅ **implemented** — exclusive or multiple group | T2 |

## D. Text input (16)

| # | Component | What it is | Tier |
|---|---|---|---|
| 39 | Input | ✅ **implemented** — text with states and addons | T1 |
| 40 | Textarea | ✅ **implemented** — multi-line | T1 |
| 41 | AutosizeTextarea | ✅ **implemented** — not a separate component: `Textarea({ autosize })` | T2 |
| 42 | NumberInput | ✅ **implemented** — steppers, min/max, precision | T1 |
| 43 | PasswordInput | ✅ **implemented** — visibility toggle + indicator | T2 |
| 44 | SearchInput | ✅ **implemented** — with clear and debounce | T2 |
| 45 | PinInput / OTP | ✅ **implemented** — separate boxes, smart paste | T2 |
| 46 | MaskedInput | ✅ **implemented** — format mask | T3 |
| 47 | CurrencyInput | ✅ **implemented** — live monetary formatting | T3 |
| 48 | PhoneInput | ✅ **implemented** — country prefix + validation | T3 |
| 49 | TagsInput | ✅ **implemented** — tags from text | T2 |
| 50 | Mentions | ✅ **implemented** — autocomplete on @ | T3 |
| 51 | InputGroup | ✅ **implemented** — prefix/suffix, attached buttons | T2 |
| 52 | Editable | ✅ **implemented** — in-place editing (click-to-edit) | T2 |
| 53 | RichTextEditor | ✅ **implemented** — WYSIWYG | T3 |
| 54 | CodeEditor | ✅ **implemented** — editor with highlight and line numbers | T3 |

## E. Selection input (19)

| # | Component | What it is | Tier |
|---|---|---|---|
| 55 | Select | ✅ **implemented** — single dropdown | T1 |
| 56 | NativeSelect | ✅ **implemented** — styled `select` | T2 |
| 57 | MultiSelect | ✅ **implemented** — multiple selection with chips | T1 |
| 58 | Combobox ⚡ | ✅ **implemented** — input + filtered list | T1 |
| 59 | Autocomplete ⚡ | ✅ **implemented** — async suggestions, debounce | T2 |
| 60 | Checkbox | ✅ **implemented** — including indeterminate state | T1 |
| 61 | CheckboxGroup | ✅ **implemented** — group with select-all | T2 |
| 62 | Radio | ✅ **implemented** — radio button | T1 |
| 63 | RadioGroup | ✅ **implemented** — group with arrow-key navigation | T1 |
| 64 | Switch | ✅ **implemented** — toggle | T1 |
| 65 | Slider ⚡ | ✅ **implemented** — drag → a single style write per frame | T1 |
| 66 | RangeSlider ⚡ | ✅ **implemented** — two ends | T2 |
| 67 | SegmentedControl | ✅ **implemented** — button-tabs | T2 |
| 68 | Rating | ✅ **implemented** — stars, halves | T3 |
| 69 | ColorPicker | ✅ **implemented** — wheel + hex/rgb | T3 |
| 70 | ColorSwatchPicker | ✅ **implemented** — predefined palette | T3 |
| 71 | TransferList | ✅ **implemented** — move between two lists | T3 |
| 72 | TreeSelect | ✅ **implemented** — selection from a tree | T3 |
| 73 | Cascader | ✅ **implemented** — cascading selection | T3 |

## F. Date and time (8)

| # | Component | What it is | Tier |
|---|---|---|---|
| 74 | Calendar | ✅ **implemented** — navigable monthly grid | T2 |
| 75 | DatePicker | ✅ **implemented** — input + calendar | T1 |
| 76 | DateRangePicker | ✅ **implemented** — range, two months | T2 |
| 77 | TimePicker | ✅ **implemented** — hour/minute/second | T2 |
| 78 | DateTimePicker | ✅ **implemented** — combined | T3 |
| 79 | MonthPicker | ✅ **implemented** — month selection | T3 |
| 80 | YearPicker | ✅ **implemented** — year selection | T3 |
| 81 | DateInput | ✅ **implemented** — direct typing with parsing | T3 |

## G. Files and upload (6)

| # | Component | What it is | Tier |
|---|---|---|---|
| 82 | FileInput | ✅ **implemented** — file selector | T2 |
| 83 | Dropzone | ✅ **implemented** — drag & drop with validation | T2 |
| 84 | FileList | ✅ **implemented** — list with deletion | T2 |
| 85 | ImageUpload | ✅ **implemented** — crop + preview | T3 |
| 86 | UploadProgress | ✅ **implemented** — per-file progress | T3 |
| 87 | FilePreview | ✅ **implemented** — preview by type | T3 |

## H. Forms (8)

| # | Component | What it is | Tier |
|---|---|---|---|
| 88 | Form ⚡ | ✅ **implemented** — validation on `derived`, no re-render | T1 |
| 89 | FormField | ✅ **implemented** — label + control + error wrapper | T1 |
| 90 | Label | ✅ **implemented** — correctly linked label | T1 |
| 91 | HelperText | ✅ **implemented** — helper text | T2 |
| 92 | ErrorMessage | ✅ **implemented** — error with `aria-live` | T1 |
| 93 | Fieldset | ✅ **implemented** — group with legend | T2 |
| 94 | FormSection | ✅ **implemented** — titled section | T3 |
| 95 | ValidationSummary | ✅ **implemented** — error summary with focus | T3 |

## I. Navigation (14)

| # | Component | What it is | Tier |
|---|---|---|---|
| 96 | Navbar | ✅ **implemented** — responsive main bar | T2 |
| 97 | NavigationMenu | ✅ **implemented** — menu with submenus | T2 |
| 98 | Menubar | ✅ **implemented** — desktop-style bar | T3 |
| 99 | SidebarNav | ✅ **implemented** — side navigation with groups | T2 |
| 100 | Tabs | ✅ **implemented** — tabs with keyboard | T1 |
| 101 | Breadcrumbs | ✅ **implemented** — breadcrumbs with collapse | T2 |
| 102 | Pagination | ✅ **implemented** — pagination with ellipsis | T1 |
| 103 | Stepper | ✅ **implemented** — steps with state | T2 |
| 104 | Wizard | ✅ **implemented** — multi-step flow with validation | T3 |
| 105 | Anchor / TOC | ✅ **implemented** — table of contents with scroll-spy | T2 |
| 106 | CommandPalette ⚡ | ✅ **implemented** — Ctrl+K, live filtering | T2 |
| 107 | BottomNavigation | ✅ **implemented** — mobile navigation | T3 |
| 108 | Dock | ✅ **implemented** — action bar | T3 |
| 109 | SkipNav | ✅ **implemented** — accessibility link | T3 |

## J. Overlays (16)

| # | Component | What it is | Tier |
|---|---|---|---|
| 110 | Dialog / Modal | ✅ **implemented** — focus trap, scroll lock on body, `aria-modal` | T1 |
| 111 | ConfirmDialog | ✅ **implemented** — confirmation for destructive actions | T1 |
| 112 | Drawer / Sheet | ✅ **implemented** — side or bottom panel | T1 |
| 113 | Popover | ✅ **implemented** — positioned, with click-outside | T1 |
| 114 | Tooltip | ✅ **implemented** — delay, positioning | T1 |
| 115 | HoverCard | ✅ **implemented** — card on hover | T3 |
| 116 | ContextMenu | ✅ **implemented** — right click | T2 |
| 117 | DropdownMenu | ✅ **implemented** | T1 |
| 118 | Toast | ✅ **implemented** — temporary notification | T1 |
| 119 | Toaster | ✅ **implemented** — queue, stacking, pause on hover | T1 |
| 120 | Notification | ✅ **implemented** — persistent notification | T2 |
| 121 | Lightbox | ✅ **implemented** — full-screen image | T3 |
| 122 | Backdrop | ✅ **implemented** — blurred background | T2 |
| 123 | Positioner | ✅ **implemented** — positioning engine for overlays: flip, shift, collision detection with the screen edge | T1 |
| 124 | Tour / Spotlight | ✅ **implemented** — step-by-step onboarding | T3 |
| 125 | Banner | ✅ **implemented** — announcement strip | T2 |

> **Note:** `Positioner` (#123) is ready and used by `Combobox`, `Select`,
> `Popover`, `Tooltip`, and `DropdownMenu` — no overlay is clipped at the
> screen edge anymore.

## K. Data display (22)

| # | Component | What it is | Tier |
|---|---|---|---|
| 126 | Table | ✅ **implemented** | T1 |
| 127 | DataGrid ⚡ | ✅ **implemented** — virtualized, pinned/resizable columns, editing | T2 |
| 128 | TreeView ⚡ | ✅ **implemented** — expandable tree, lazy | T2 |
| 129 | ListView | ✅ **implemented** — interactive list: selection, per-row actions, groups | T2 |
| 130 | DescriptionList | ✅ **implemented** — key–value pairs | T2 |
| 131 | Card | ✅ **implemented** — container with header/footer | T1 |
| 132 | Stat / KPI | ✅ **implemented** — value + delta + trend | T2 |
| 133 | Badge | ✅ **implemented** — counter or dot | T1 |
| 134 | Tag / Chip | ✅ **implemented** — label, optionally deletable | T1 |
| 135 | Avatar | ✅ **implemented** — image, initials, fallback | T1 |
| 136 | AvatarGroup | ✅ **implemented** — stacking with +N | T2 |
| 137 | Timeline | ✅ **implemented** — chronological events | T2 |
| 138 | Accordion | ✅ **implemented** — expandable sections | T1 |
| 139 | Collapsible | ✅ **implemented** — a single foldable area | T1 |
| 140 | Carousel | ✅ **implemented** — slides with swipe | T3 |
| 141 | Kanban ⚡ | ✅ **implemented** — columns with drag & drop | T3 |
| 142 | JsonViewer ⚡ | ✅ **implemented** — expandable JSON tree | T3 |
| 143 | DiffViewer | ✅ **implemented** — diff by lines/words | T3 |
| 144 | Image | ✅ **implemented** — lazy, skeleton, fallback | T2 |
| 145 | Gallery | ✅ **implemented** — grid with lightbox | T3 |
| 146 | EmptyState | ✅ **implemented** — empty state with action | T2 |
| 147 | ComparisonTable | ✅ **implemented** — comparison table | T3 |

## L. Feedback and state (10)

| # | Component | What it is | Tier |
|---|---|---|---|
| 148 | Spinner | ✅ **implemented** — loading indicator | T1 |
| 149 | Progress ⚡ | ✅ **implemented** — determinate bar — a single attribute write | T1 |
| 150 | CircularProgress | ✅ **implemented** — circular progress | T2 |
| 151 | Skeleton | ✅ **implemented** — loading placeholder | T1 |
| 152 | LoadingOverlay | ✅ **implemented** — overlay over an area | T2 |
| 153 | Alert | ✅ **implemented** — message with severity | T1 |
| 154 | Callout | ✅ **implemented** — highlighted note | T2 |
| 155 | Result | ✅ **implemented** — success / error / 404 page | T2 |
| 156 | Meter | ✅ **implemented** — value within a range | T3 |
| 157 | ErrorBoundary | ✅ **implemented** — catches render errors | T2 |

## M. Charts (16)

> **Charts alone are a separate library.** 16 types means scales, axes,
> legends, tooltips, responsive, and accessibility. My recommendation: do
> `ChartPrimitives` + 4 basic types, then stop until someone asks for more.

| # | Component | What it is | Tier |
|---|---|---|---|
| 158 | ChartPrimitives | ✅ **implemented** — axes, grid, legend, tooltip, scales | T2 |
| 159 | LineChart ⚡ | ✅ **implemented** — live data → a single `path` rewrite | T2 |
| 160 | AreaChart | ✅ **implemented** — line with fill | T2 |
| 161 | BarChart | ✅ **implemented** — grouped/stacked bars | T2 |
| 162 | Sparkline ⚡ | ✅ **implemented** — inline mini-chart | T2 |
| 163 | PieChart | ✅ **implemented** — pie | T3 |
| 164 | DonutChart | ✅ **implemented** — ring with total in the center | T3 |
| 165 | ScatterChart | ✅ **implemented** — point cloud | T3 |
| 166 | BubbleChart | ✅ **implemented** — scatter with size | T3 |
| 167 | Heatmap | ✅ **implemented** — colored matrix | T3 |
| 168 | Gauge | ✅ **implemented** — speedometer | T3 |
| 169 | RadarChart | ✅ **implemented** — radar | T3 |
| 170 | FunnelChart | ✅ **implemented** — conversion funnel | T3 |
| 171 | CandlestickChart | ✅ **implemented** — financial candlesticks | T3 |
| 172 | Treemap | ✅ **implemented** — hierarchical rectangles | T3 |
| 173 | SankeyDiagram | ✅ **implemented** — flows | T3 |

## N. Media (7)

| # | Component | What it is | Tier |
|---|---|---|---|
| 174 | VideoPlayer | ✅ **implemented** — custom controls, subtitles | T3 |
| 175 | AudioPlayer | ✅ **implemented** — player with progress | T3 |
| 176 | ImageZoom | ✅ **implemented** — magnifier on hover | T3 |
| 177 | PdfViewer | ⛔ **not doing** — requires a full PDF parser (pdf.js is ~1MB). Cannot be done zero-dependency without lying about what you ship. Use an `<iframe>` to the browser's viewer, or integrate pdf.js directly. | T3 |
| 178 | Map | ⛔ **not doing** — requires a tile server, projection, and geographic data. A map without tiles isn't a map. Integrate Leaflet or MapLibre. | T3 |
| 179 | QRCode | ✅ **implemented** — QR generation | T3 |
| 180 | Waveform | ✅ **implemented** — audio waveform | T3 |

## O. Headless behaviors and utilities (20)

> These render nothing — they attach via `ref` or return signals. They are the
> cheapest to build and the most reused; most of the components above
> consume them. Worth doing **first**.

| # | Primitive | What it is | Tier |
|---|---|---|---|
| 181 | Portal | ✅ **implemented** — mounting into another node | T1 |
| 182 | FocusTrap | ✅ **implemented** — focus capture | T1 |
| 183 | ClickOutside | ✅ **implemented** — detect click outside | T1 |
| 184 | VisuallyHidden | ✅ **implemented** — screen-reader-only text | T1 |
| 185 | Transition | ✅ **implemented** — enter/exit with cleanup | T1 |
| 186 | Draggable ⚡ | ✅ **implemented** — drag with pointer events | T1 |
| 187 | Droppable | ✅ **implemented** — drop zone | T2 |
| 188 | Sortable ⚡ | ✅ **implemented** — reordering — keyed `For` moves, doesn't recreate | T1 |
| 189 | Resizable ⚡ | ✅ **implemented** — resizing by drag | T1 |
| 190 | Virtualizer ⚡ | ✅ **implemented** — window over N thousand rows | T1 |
| 191 | InfiniteScroll | ✅ **implemented** — load at the end | T2 |
| 192 | IntersectionObserver | ✅ **implemented** — visibility as a signal | T2 |
| 193 | Clipboard | ✅ **implemented** — copy + copied state | T2 |
| 194 | Hotkeys | ✅ **implemented** — shortcuts with scope | T1 |
| 195 | MediaQuery | ✅ **implemented** — breakpoint as a signal | T1 |
| 196 | Idle | ✅ **implemented** — user inactivity | T3 |
| 197 | NetworkStatus | ✅ **implemented** — online / offline | T3 |
| 198 | PersistedState | ✅ **implemented** — signal synced with localStorage | T2 |
| 199 | UndoRedo | ✅ **implemented** — history with undo/redo | T2 |
| 200 | SelectionState | ✅ **implemented** — multi-select with shift/ctrl | T2 |

---

## Recommended order

**Wave 1 — the headless primitives (181–195).** ✅ **Done.** They render nothing, are built
quickly, and almost everything that follows consumes them. `Portal`, `FocusTrap`, and
`ClickOutside` are preconditions for any overlay.

**Wave 2 — the thesis components ⚡.** ✅ **Done.** `Progress`, `CircularProgress`,
`Slider`, `RangeSlider`, `SplitPane`, `Sparkline`, `Combobox`, `DataGrid`, plus
`Positioner`. Each with a test that counts DOM mutations. **These are the framework's
marketing material** — a pretty `Button` demonstrates nothing, a
`DataGrid` that holds 50,000 rows with 14 nodes in the DOM does.

Still ⚡ undone, for later: `Autocomplete` (#59), `Form` (#88),
`CommandPalette` (#106), `TreeView` (#128), `Kanban` (#141), `JsonViewer` (#142),
`LineChart` (#159).

**Wave 3 — the form and overlay core.** ✅ **Done.** Button, IconButton,
ButtonGroup, Input, Textarea, Checkbox, Switch, RadioGroup, Select, Form,
FormField, Label, ErrorMessage, Dialog, ConfirmDialog, Popover, Tooltip, Toast,
Toaster, Tabs. Here the library becomes usable in production.

**Wave 4 — layout, typography, display, controls, state primitives.**
✅ **Done.** ~60 components: the entire layout and typography palette, the cards /
badges / avatars / empty states, disclosure (Collapsible, Accordion),
the second-round form controls (NumberInput, PinInput, TagsInput,
SearchInput, PasswordInput, CheckboxGroup, SegmentedControl...) and the state
primitives (persistedState, undoRedo, selectionState).

**Wave 5 — data, navigation, files, trees, charts.** ✅ **Done.** Calendar /
DatePicker / DateRangePicker / TimePicker, Breadcrumbs / Pagination / Stepper /
Anchor / Navbar / NavigationMenu / SidebarNav / Sidebar / AppShell, TreeView /
ListView / MultiSelect / Autocomplete / CommandPalette, FileInput / Dropzone /
FileList, Drawer / ContextMenu / Notification / Backdrop / ErrorBoundary, and
ChartPrimitives / LineChart / AreaChart / BarChart.

**Wave 6 — T3.** ✅ **Done, 59 of 61.** Specialized layout, masked inputs,
11 new chart types, editors (RichText, Code, JSON, Diff), media (Carousel,
Lightbox, players, Waveform, QRCode) and the rest (Kanban, Wizard, Menubar,
HoverCard, Tour).

**The two that are NOT being done:** `PdfViewer` (#177) and `Map` (#178). Both require
large, real dependencies — a PDF parser, and a tile server with geographic
data respectively. A "PdfViewer" without a parser and a "map" without tiles would just be
names on empty components.
