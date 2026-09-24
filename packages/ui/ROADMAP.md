# @raptor/ui — roadmap 200 componente

Stare: **198 / 200** implementate. Valurile 1-6 sunt complete. Cele doua ramase (`PdfViewer`, `Map`) nu pot fi facute onest zero-dependency — vezi motivul in tabel.

## Cum e ordonată lista

- **Tier 1 (T1)** — nucleul. Fără astea biblioteca nu e utilizabilă.
- **Tier 2 (T2)** — se așteaptă de la o bibliotecă serioasă.
- **Tier 3 (T3)** — specializate sau mari. Fiecare e un proiect în sine.
- ⚡ = **componentă-teză**: aici fine-grained e *măsurabil* mai bun decât VDOM, iar
  testul cu `stats.createElement` / `stats.textUpdate` pe mini-dom o dovedește.
  Astea sunt argumentul framework-ului, nu doar widget-uri. Construiește-le devreme.

Fiecare componentă livrată vine cu: test pe mini-dom, ARIA, tastatură, zero CSS
obligatoriu (doar clase `rui-*`), intrare în `docs/USAGE.md`.

---

## A. Layout și structură (18)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 1 | Box | ✅ **implementat** — primitivă de stil/spacing | T1 |
| 2 | Stack | ✅ **implementat** — VStack / HStack cu gap | T1 |
| 3 | Flex | ✅ **implementat** — wrapper flexbox | T1 |
| 4 | Grid | ✅ **implementat** — grid cu span-uri responsive | T1 |
| 5 | SimpleGrid | ✅ **implementat** — coloane automate | T2 |
| 6 | Container | ✅ **implementat** — lățime maximă + gutters | T1 |
| 7 | Center | ✅ **implementat** — centrare pe ambele axe | T2 |
| 8 | Spacer | ✅ **implementat** — spațiu flexibil | T2 |
| 9 | Divider | ✅ **implementat** — separator orizontal/vertical | T1 |
| 10 | AspectRatio | ✅ **implementat** — raport fix | T2 |
| 11 | ScrollArea | ✅ **implementat** — scroll cu bară stilizată | T2 |
| 12 | SplitPane ⚡ | ✅ **implementat** — componenta cu panouri + mâner + persistență, peste comportamentul `resizable` (#189) | T1 |
| 13 | AppShell | ✅ **implementat** — header + sidebar + content | T2 |
| 14 | Sidebar | ✅ **implementat** — panou lateral colapsabil | T2 |
| 15 | Masonry | ✅ **implementat** — layout în coloane inegale | T3 |
| 16 | Group | ✅ **implementat** — grupare orizontală cu spacing | T2 |
| 17 | Affix / Sticky | ✅ **implementat** — element lipit la scroll | T3 |
| 18 | SafeArea | ✅ **implementat** — padding pentru notch mobil | T3 |

## B. Tipografie (10)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 19 | Text | ✅ **implementat** — text cu variante semantice | T1 |
| 20 | Heading | ✅ **implementat** — h1–h6 cu scale | T1 |
| 21 | Link | ✅ **implementat** — ancoră cu stări | T1 |
| 22 | Code | ✅ **implementat** — cod inline | T2 |
| 23 | CodeBlock | ✅ **implementat** — bloc cu highlight + copy | T2 |
| 24 | Kbd | ✅ **implementat** — tastă afișată | T3 |
| 25 | Blockquote | ✅ **implementat** — citat | T3 |
| 26 | TextList | ✅ **implementat** — listă ordonată/neordonată, pur tipografică | T2 |
| 27 | Truncate / LineClamp | ✅ **implementat** — tăiere la N rânduri | T2 |
| 28 | Mark / Highlight | ✅ **implementat** — evidențiere căutare | T3 |

## C. Butoane și acțiuni (10)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 29 | Button | ✅ **implementat** — variante, dimensiuni, stare loading | T1 |
| 30 | IconButton | ✅ **implementat** — buton doar-icon cu aria-label | T1 |
| 31 | ButtonGroup | ✅ **implementat** — butoane lipite | T2 |
| 32 | ToggleButton | ✅ **implementat** — buton cu stare on/off | T2 |
| 33 | SplitButton | ✅ **implementat** — acțiune + dropdown | T3 |
| 34 | FloatingActionButton | ✅ **implementat** — FAB | T3 |
| 35 | CopyButton | ✅ **implementat** — copiere în clipboard + feedback | T2 |
| 36 | CloseButton | ✅ **implementat** — ✕ standardizat | T2 |
| 37 | LoadingButton | ✅ **implementat** — nu componenta separata: `Button({ loading })`, plus `loading` automat pentru `onClick` async | T2 |
| 38 | ToggleGroup | ✅ **implementat** — grup exclusiv sau multiplu | T2 |

## D. Input text (16)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 39 | Input | ✅ **implementat** — text cu stări și addons | T1 |
| 40 | Textarea | ✅ **implementat** — multi-linie | T1 |
| 41 | AutosizeTextarea | ✅ **implementat** — nu componenta separata: `Textarea({ autosize })` | T2 |
| 42 | NumberInput | ✅ **implementat** — steppere, min/max, precizie | T1 |
| 43 | PasswordInput | ✅ **implementat** — toggle vizibilitate + indicator | T2 |
| 44 | SearchInput | ✅ **implementat** — cu clear și debounce | T2 |
| 45 | PinInput / OTP | ✅ **implementat** — casete separate, paste inteligent | T2 |
| 46 | MaskedInput | ✅ **implementat** — mască de format | T3 |
| 47 | CurrencyInput | ✅ **implementat** — formatare monetară live | T3 |
| 48 | PhoneInput | ✅ **implementat** — prefix țară + validare | T3 |
| 49 | TagsInput | ✅ **implementat** — tag-uri din text | T2 |
| 50 | Mentions | ✅ **implementat** — autocomplete pe @ | T3 |
| 51 | InputGroup | ✅ **implementat** — prefix/sufix, butoane atașate | T2 |
| 52 | Editable | ✅ **implementat** — editare pe loc (click-to-edit) | T2 |
| 53 | RichTextEditor | ✅ **implementat** — WYSIWYG | T3 |
| 54 | CodeEditor | ✅ **implementat** — editor cu highlight și numerotare | T3 |

## E. Input de selecție (19)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 55 | Select | ✅ **implementat** — dropdown single | T1 |
| 56 | NativeSelect | ✅ **implementat** — `select` stilizat | T2 |
| 57 | MultiSelect | ✅ **implementat** — selecție multiplă cu chip-uri | T1 |
| 58 | Combobox ⚡ | ✅ **implementat** — input + listă filtrată | T1 |
| 59 | Autocomplete ⚡ | ✅ **implementat** — sugestii async, debounce | T2 |
| 60 | Checkbox | ✅ **implementat** — inclusiv stare indeterminate | T1 |
| 61 | CheckboxGroup | ✅ **implementat** — grup cu select-all | T2 |
| 62 | Radio | ✅ **implementat** — buton radio | T1 |
| 63 | RadioGroup | ✅ **implementat** — grup cu navigare la săgeți | T1 |
| 64 | Switch | ✅ **implementat** — comutator | T1 |
| 65 | Slider ⚡ | ✅ **implementat** — drag → o singură scriere de stil pe frame | T1 |
| 66 | RangeSlider ⚡ | ✅ **implementat** — două capete | T2 |
| 67 | SegmentedControl | ✅ **implementat** — taburi-buton | T2 |
| 68 | Rating | ✅ **implementat** — stele, jumătăți | T3 |
| 69 | ColorPicker | ✅ **implementat** — roată + hex/rgb | T3 |
| 70 | ColorSwatchPicker | ✅ **implementat** — paletă predefinită | T3 |
| 71 | TransferList | ✅ **implementat** — mutare între două liste | T3 |
| 72 | TreeSelect | ✅ **implementat** — selecție din arbore | T3 |
| 73 | Cascader | ✅ **implementat** — selecție în cascadă | T3 |

## F. Dată și oră (8)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 74 | Calendar | ✅ **implementat** — grilă lunară navigabilă | T2 |
| 75 | DatePicker | ✅ **implementat** — input + calendar | T1 |
| 76 | DateRangePicker | ✅ **implementat** — interval, două luni | T2 |
| 77 | TimePicker | ✅ **implementat** — oră/minut/secundă | T2 |
| 78 | DateTimePicker | ✅ **implementat** — combinat | T3 |
| 79 | MonthPicker | ✅ **implementat** — selecție lună | T3 |
| 80 | YearPicker | ✅ **implementat** — selecție an | T3 |
| 81 | DateInput | ✅ **implementat** — tastare directă cu parsare | T3 |

## G. Fișiere și upload (6)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 82 | FileInput | ✅ **implementat** — selector de fișier | T2 |
| 83 | Dropzone | ✅ **implementat** — drag & drop cu validare | T2 |
| 84 | FileList | ✅ **implementat** — listă cu ștergere | T2 |
| 85 | ImageUpload | ✅ **implementat** — crop + preview | T3 |
| 86 | UploadProgress | ✅ **implementat** — progres per fișier | T3 |
| 87 | FilePreview | ✅ **implementat** — preview după tip | T3 |

## H. Formulare (8)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 88 | Form ⚡ | ✅ **implementat** — validare pe `derived`, fără re-render | T1 |
| 89 | FormField | ✅ **implementat** — wrapper label + control + eroare | T1 |
| 90 | Label | ✅ **implementat** — etichetă legată corect | T1 |
| 91 | HelperText | ✅ **implementat** — text ajutător | T2 |
| 92 | ErrorMessage | ✅ **implementat** — eroare cu `aria-live` | T1 |
| 93 | Fieldset | ✅ **implementat** — grup cu legend | T2 |
| 94 | FormSection | ✅ **implementat** — secțiune cu titlu | T3 |
| 95 | ValidationSummary | ✅ **implementat** — sumar de erori cu focus | T3 |

## I. Navigare (14)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 96 | Navbar | ✅ **implementat** — bară principală responsive | T2 |
| 97 | NavigationMenu | ✅ **implementat** — meniu cu submeniuri | T2 |
| 98 | Menubar | ✅ **implementat** — bară stil desktop | T3 |
| 99 | SidebarNav | ✅ **implementat** — navigare laterală cu grupuri | T2 |
| 100 | Tabs | ✅ **implementat** — taburi cu tastatură | T1 |
| 101 | Breadcrumbs | ✅ **implementat** — firimituri cu colaps | T2 |
| 102 | Pagination | ✅ **implementat** — paginare cu ellipsis | T1 |
| 103 | Stepper | ✅ **implementat** — pași cu stare | T2 |
| 104 | Wizard | ✅ **implementat** — flux multi-pas cu validare | T3 |
| 105 | Anchor / TOC | ✅ **implementat** — cuprins cu scroll-spy | T2 |
| 106 | CommandPalette ⚡ | ✅ **implementat** — Ctrl+K, filtrare live | T2 |
| 107 | BottomNavigation | ✅ **implementat** — navigare mobilă | T3 |
| 108 | Dock | ✅ **implementat** — bară de acțiuni | T3 |
| 109 | SkipNav | ✅ **implementat** — link de accesibilitate | T3 |

## J. Overlay-uri (16)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 110 | Dialog / Modal | ✅ **implementat** — focus trap, scroll lock pe body, `aria-modal` | T1 |
| 111 | ConfirmDialog | ✅ **implementat** — confirmare pentru acțiuni distructive | T1 |
| 112 | Drawer / Sheet | ✅ **implementat** — panou lateral sau de jos | T1 |
| 113 | Popover | ✅ **implementat** — poziționat, cu click-outside | T1 |
| 114 | Tooltip | ✅ **implementat** — delay, poziționare | T1 |
| 115 | HoverCard | ✅ **implementat** — card la hover | T3 |
| 116 | ContextMenu | ✅ **implementat** — click dreapta | T2 |
| 117 | DropdownMenu | ✅ **implementat** | T1 |
| 118 | Toast | ✅ **implementat** — notificare temporară | T1 |
| 119 | Toaster | ✅ **implementat** — coadă, stivuire, pauză la hover | T1 |
| 120 | Notification | ✅ **implementat** — notificare persistentă | T2 |
| 121 | Lightbox | ✅ **implementat** — imagine pe ecran complet | T3 |
| 122 | Backdrop | ✅ **implementat** — fundal cu blur | T2 |
| 123 | Positioner | ✅ **implementat** — motor de poziționare pentru overlay-uri: flip, shift, detecție de coliziuni cu marginea ecranului | T1 |
| 124 | Tour / Spotlight | ✅ **implementat** — onboarding pas cu pas | T3 |
| 125 | Banner | ✅ **implementat** — bandă de anunț | T2 |

> **Notă:** `Positioner` (#123) e gata și folosit de `Combobox`, `Select`,
> `Popover`, `Tooltip` și `DropdownMenu` — niciun overlay nu se mai taie la
> marginea ecranului.

## K. Afișare de date (22)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 126 | Table | ✅ **implementat** | T1 |
| 127 | DataGrid ⚡ | ✅ **implementat** — virtualizat, coloane fixate/redimensionabile, editare | T2 |
| 128 | TreeView ⚡ | ✅ **implementat** — arbore expandabil, lazy | T2 |
| 129 | ListView | ✅ **implementat** — listă interactivă: selecție, acțiuni per rând, grupuri | T2 |
| 130 | DescriptionList | ✅ **implementat** — perechi cheie–valoare | T2 |
| 131 | Card | ✅ **implementat** — container cu header/footer | T1 |
| 132 | Stat / KPI | ✅ **implementat** — valoare + deltă + trend | T2 |
| 133 | Badge | ✅ **implementat** — contor sau punct | T1 |
| 134 | Tag / Chip | ✅ **implementat** — etichetă, opțional ștergibilă | T1 |
| 135 | Avatar | ✅ **implementat** — imagine, inițiale, fallback | T1 |
| 136 | AvatarGroup | ✅ **implementat** — stivuire cu +N | T2 |
| 137 | Timeline | ✅ **implementat** — evenimente cronologice | T2 |
| 138 | Accordion | ✅ **implementat** — secțiuni expandabile | T1 |
| 139 | Collapsible | ✅ **implementat** — o singură zonă pliabilă | T1 |
| 140 | Carousel | ✅ **implementat** — slide-uri cu swipe | T3 |
| 141 | Kanban ⚡ | ✅ **implementat** — coloane cu drag & drop | T3 |
| 142 | JsonViewer ⚡ | ✅ **implementat** — arbore JSON expandabil | T3 |
| 143 | DiffViewer | ✅ **implementat** — diff pe linii/cuvinte | T3 |
| 144 | Image | ✅ **implementat** — lazy, skeleton, fallback | T2 |
| 145 | Gallery | ✅ **implementat** — grilă cu lightbox | T3 |
| 146 | EmptyState | ✅ **implementat** — stare goală cu acțiune | T2 |
| 147 | ComparisonTable | ✅ **implementat** — tabel de comparație | T3 |

## L. Feedback și stare (10)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 148 | Spinner | ✅ **implementat** — indicator de încărcare | T1 |
| 149 | Progress ⚡ | ✅ **implementat** — bară determinată — o scriere de atribut | T1 |
| 150 | CircularProgress | ✅ **implementat** — progres circular | T2 |
| 151 | Skeleton | ✅ **implementat** — placeholder de încărcare | T1 |
| 152 | LoadingOverlay | ✅ **implementat** — overlay peste o zonă | T2 |
| 153 | Alert | ✅ **implementat** — mesaj cu severitate | T1 |
| 154 | Callout | ✅ **implementat** — notă evidențiată | T2 |
| 155 | Result | ✅ **implementat** — pagină de succes / eroare / 404 | T2 |
| 156 | Meter | ✅ **implementat** — valoare într-un interval | T3 |
| 157 | ErrorBoundary | ✅ **implementat** — prinde erori de randare | T2 |

## M. Grafice (16)

> **Graficele singure sunt o bibliotecă separată.** 16 tipuri înseamnă scale, axe,
> legende, tooltip-uri, responsive și accesibilitate. Recomandarea mea: fă
> `ChartPrimitives` + 4 tipuri de bază, apoi oprește-te până cere cineva mai mult.

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 158 | ChartPrimitives | ✅ **implementat** — axe, grilă, legendă, tooltip, scale | T2 |
| 159 | LineChart ⚡ | ✅ **implementat** — date live → o rescriere de `path` | T2 |
| 160 | AreaChart | ✅ **implementat** — linie cu umplere | T2 |
| 161 | BarChart | ✅ **implementat** — bare grupate/stivuite | T2 |
| 162 | Sparkline ⚡ | ✅ **implementat** — mini-grafic inline | T2 |
| 163 | PieChart | ✅ **implementat** — plăcintă | T3 |
| 164 | DonutChart | ✅ **implementat** — inel cu total în centru | T3 |
| 165 | ScatterChart | ✅ **implementat** — nor de puncte | T3 |
| 166 | BubbleChart | ✅ **implementat** — scatter cu dimensiune | T3 |
| 167 | Heatmap | ✅ **implementat** — matrice colorată | T3 |
| 168 | Gauge | ✅ **implementat** — vitezometru | T3 |
| 169 | RadarChart | ✅ **implementat** — radar | T3 |
| 170 | FunnelChart | ✅ **implementat** — pâlnie de conversie | T3 |
| 171 | CandlestickChart | ✅ **implementat** — lumânări financiare | T3 |
| 172 | Treemap | ✅ **implementat** — dreptunghiuri ierarhice | T3 |
| 173 | SankeyDiagram | ✅ **implementat** — fluxuri | T3 |

## N. Media (7)

| # | Componentă | Ce e | Tier |
|---|---|---|---|
| 174 | VideoPlayer | ✅ **implementat** — controale proprii, subtitrări | T3 |
| 175 | AudioPlayer | ✅ **implementat** — player cu progres | T3 |
| 176 | ImageZoom | ✅ **implementat** — lupă la hover | T3 |
| 177 | PdfViewer | ⛔ **nu se face** — cere un parser PDF complet (pdf.js are ~1MB). Nu poate fi facut zero-dependency fara sa minti despre ce livrezi. Foloseste `<iframe>` catre vizualizatorul browserului, sau integreaza pdf.js direct. | T3 |
| 178 | Map | ⛔ **nu se face** — cere tile server, proiectie si date geografice. O harta fara tile-uri nu e o harta. Integreaza Leaflet sau MapLibre. | T3 |
| 179 | QRCode | ✅ **implementat** — generare QR | T3 |
| 180 | Waveform | ✅ **implementat** — formă de undă audio | T3 |

## O. Comportamente headless și utilitare (20)

> Astea nu randează nimic — se atașează prin `ref` sau întorc semnale. Sunt cele
> mai ieftine de construit și cele mai reutilizate; majoritatea componentelor de
> mai sus le consumă. Merită făcute **primele**.

| # | Primitivă | Ce e | Tier |
|---|---|---|---|
| 181 | Portal | ✅ **implementat** — montare în alt nod | T1 |
| 182 | FocusTrap | ✅ **implementat** — captură de focus | T1 |
| 183 | ClickOutside | ✅ **implementat** — detectare click în afară | T1 |
| 184 | VisuallyHidden | ✅ **implementat** — text doar pentru screen reader | T1 |
| 185 | Transition | ✅ **implementat** — enter/exit cu cleanup | T1 |
| 186 | Draggable ⚡ | ✅ **implementat** — drag cu pointer events | T1 |
| 187 | Droppable | ✅ **implementat** — zonă de drop | T2 |
| 188 | Sortable ⚡ | ✅ **implementat** — reordonare — `For` keyed mută, nu recreează | T1 |
| 189 | Resizable ⚡ | ✅ **implementat** — redimensionare prin drag | T1 |
| 190 | Virtualizer ⚡ | ✅ **implementat** — fereastră peste N mii de rânduri | T1 |
| 191 | InfiniteScroll | ✅ **implementat** — încărcare la capăt | T2 |
| 192 | IntersectionObserver | ✅ **implementat** — vizibilitate ca semnal | T2 |
| 193 | Clipboard | ✅ **implementat** — copiere + stare copied | T2 |
| 194 | Hotkeys | ✅ **implementat** — scurtături cu scope | T1 |
| 195 | MediaQuery | ✅ **implementat** — breakpoint ca semnal | T1 |
| 196 | Idle | ✅ **implementat** — inactivitate utilizator | T3 |
| 197 | NetworkStatus | ✅ **implementat** — online / offline | T3 |
| 198 | PersistedState | ✅ **implementat** — semnal sincronizat cu localStorage | T2 |
| 199 | UndoRedo | ✅ **implementat** — istoric cu undo/redo | T2 |
| 200 | SelectionState | ✅ **implementat** — multi-select cu shift/ctrl | T2 |

---

## Ordinea recomandată

**Val 1 — primitivele headless (181–195).** ✅ **Gata.** Nu randează nimic, se fac
repede și aproape tot ce urmează le consumă. `Portal`, `FocusTrap` și
`ClickOutside` sunt precondiții pentru orice overlay.

**Val 2 — componentele-teză ⚡.** ✅ **Gata.** `Progress`, `CircularProgress`,
`Slider`, `RangeSlider`, `SplitPane`, `Sparkline`, `Combobox`, `DataGrid`, plus
`Positioner`. Fiecare cu test care numără mutațiile DOM. **Astea sunt materialul
de marketing al framework-ului** — un `Button` frumos nu demonstrează nimic, un
`DataGrid` care ține 50.000 de rânduri cu 14 noduri în DOM, da.

Rămân ⚡ nefăcute, pentru mai târziu: `Autocomplete` (#59), `Form` (#88),
`CommandPalette` (#106), `TreeView` (#128), `Kanban` (#141), `JsonViewer` (#142),
`LineChart` (#159).

**Val 3 — nucleul de formular și overlay.** ✅ **Gata.** Button, IconButton,
ButtonGroup, Input, Textarea, Checkbox, Switch, RadioGroup, Select, Form,
FormField, Label, ErrorMessage, Dialog, ConfirmDialog, Popover, Tooltip, Toast,
Toaster, Tabs. Aici biblioteca devine utilizabilă în producție.

**Val 4 — layout, tipografie, afișare, controale, primitive de stare.**
✅ **Gata.** ~60 de componente: toată paleta de layout și tipografie, cardurile /
insignele / avatarurile / stările goale, disclosure (Collapsible, Accordion),
controalele de formular runda a doua (NumberInput, PinInput, TagsInput,
SearchInput, PasswordInput, CheckboxGroup, SegmentedControl...) și primitivele
de stare (persistedState, undoRedo, selectionState).

**Val 5 — date, navigare, fișiere, arbori, grafice.** ✅ **Gata.** Calendar /
DatePicker / DateRangePicker / TimePicker, Breadcrumbs / Pagination / Stepper /
Anchor / Navbar / NavigationMenu / SidebarNav / Sidebar / AppShell, TreeView /
ListView / MultiSelect / Autocomplete / CommandPalette, FileInput / Dropzone /
FileList, Drawer / ContextMenu / Notification / Backdrop / ErrorBoundary, și
ChartPrimitives / LineChart / AreaChart / BarChart.

**Val 6 — T3.** ✅ **Gata, 59 din 61.** Layout specializat, inputuri cu mască,
11 tipuri noi de grafic, editoare (RichText, Code, JSON, Diff), media (Carousel,
Lightbox, playere, Waveform, QRCode) și restul (Kanban, Wizard, Menubar,
HoverCard, Tour).

**Cele două care NU se fac:** `PdfViewer` (#177) și `Map` (#178). Amândouă cer
dependințe mari și reale — un parser PDF, respectiv un tile server cu date
geografice. Un „PdfViewer" fără parser și o „hartă" fără tile-uri ar fi doar
nume pe componente goale.
