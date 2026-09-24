/** Text input. */
import { state, derived } from "@raptor/dom";
import { Editable, InputGroup, NumberInput, PasswordInput, PinInput, SearchInput, TagsInput } from "@raptor/ui/controls";
import { CodeEditor, RichTextEditor } from "@raptor/ui/editors";
import { Input, Textarea } from "@raptor/ui/input";
import { CurrencyInput, DateInput, MaskedInput, type MentionOption, Mentions, PhoneInput } from "@raptor/ui/input-extra";
import { highlight } from "../lib/ui.tsx";
import type { CatalogGroup } from "./types.ts";

const PEOPLE: MentionOption[] = [
  { id: "ana", label: "Ana Petrescu", detail: "compiler" },
  { id: "bogdan", label: "Bogdan Ilie", detail: "wire" },
  { id: "carmen", label: "Carmen Dobre", detail: "runtime" },
  { id: "dan", label: "Dan Marin", detail: "docs" },
];

export const INPUTS: CatalogGroup = {
  slug: "inputs",
  title: "Text input",
  blurb: "Every control takes a signal you own. It writes that signal; it never keeps a copy of your state.",
  items: [
    {
      slug: "input",
      name: "Input",
      tier: "T1",
      summary:
        "A text field bound to a signal. Typing writes the signal, and only the bindings that read it update — the field itself is never re-created.",
      code: `const email = state("");
Input({ value: email, type: "email", label: "Email", placeholder: "you@example.com" });`,
      props: [
        { name: "value", type: "State<string>", desc: "The signal you own. Two-way, without a framework-owned copy." },
        { name: "type", type: `"text" | "email" | "password" | "search" | "tel" | "url" | "number"`, desc: "Input type." },
        { name: "before / after", type: "Child", desc: "Adornments inside the field (icon, unit)." },
        { name: "invalid", type: "Accessor<boolean>", desc: "Sets aria-invalid and the error styling." },
        { name: "onInput / onBlur", type: "handlers", desc: "Extra reactions; the signal is already written for you." },
      ],
      demo: () => {
        const email = state("");
        const valid = derived(() => /.+@.+\..+/.test(email()));
        return (
          <div>
            <div class="cmp-row">
              {Input({ value: email, type: "email", label: "Email", placeholder: "you@example.com", invalid: () => email() !== "" && !valid() })}
              {Input({ value: state("read only"), readonly: true, label: "Readonly" })}
              {Input({ value: state(""), disabled: true, label: "Disabled", placeholder: "unavailable" })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                value = <b>{() => email() || "—"}</b>
              </span>
              <span class="chip">
                valid = <b>{() => String(valid())}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "textarea",
      name: "Textarea",
      tier: "T1",
      summary: "Multi-line input. With `autosize` it grows with its content up to `maxRows`, so there is no inner scrollbar to fight.",
      code: `Textarea({ value: notes, rows: 3, autosize: true, maxRows: 8, label: "Notes" });`,
      demo: () => (
        <div class="cmp-row" style="align-items:flex-start">
          {Textarea({ value: state("Fixed height.\nThree rows."), rows: 3, label: "Plain" })}
          {Textarea({
            value: state("Autosize: type more lines and watch the box grow."),
            rows: 2,
            autosize: true,
            maxRows: 8,
            label: "Autosize",
          })}
        </div>
      ),
    },
    {
      slug: "number-input",
      name: "NumberInput",
      tier: "T1",
      summary: "A number with steppers, bounds and a fixed number of decimals. Arrow keys step, and the value never leaves min/max.",
      code: `const qty = state(1);
NumberInput({ value: qty, min: 0, max: 10, step: 1, label: "Quantity" });`,
      props: [
        { name: "value", type: "State<number>", desc: "The signal." },
        { name: "min / max / step", type: "number", desc: "Bounds and the stepper increment." },
        { name: "precision", type: "number", desc: "Decimals shown. Inferred from step when omitted." },
        { name: "suffix", type: "Child", desc: "Unit displayed after the number." },
      ],
      demo: () => {
        const qty = state(2);
        const weight = state(1.5);
        return (
          <div class="cmp-row">
            {NumberInput({ value: qty, min: 0, max: 10, label: "Quantity" })}
            {NumberInput({ value: weight, min: 0, max: 20, step: 0.5, suffix: "kg", label: "Weight" })}
            <span class="chip">
              total <b>{() => (qty() * weight()).toFixed(1)}</b> kg
            </span>
          </div>
        );
      },
    },
    {
      slug: "password-input",
      name: "PasswordInput",
      tier: "T2",
      summary: "A password field with a visibility toggle and an optional strength bar computed from length and character classes.",
      code: `PasswordInput({ value: pass, strength: true, label: "Password" });`,
      demo: () => PasswordInput({ value: state(""), strength: true, label: "Password", placeholder: "Try a few characters" }),
    },
    {
      slug: "search-input",
      name: "SearchInput",
      tier: "T2",
      summary:
        "A search field with a clear button and a debounce: `onSearch` fires after the typing stops, not on every keystroke.",
      code: `SearchInput({
  value: query,
  debounce: 300,
  onSearch: (q) => runSearch(q),
  placeholder: "Search…",
});`,
      demo: () => {
        const query = state("");
        const searches = state(0);
        const last = state("—");
        return (
          <div>
            <div class="cmp-row">
              {SearchInput({
                value: query,
                debounce: 400,
                placeholder: "Type here…",
                label: "Search",
                onSearch: (q: string) => {
                  searches.update((n) => n + 1);
                  last.set(q || "—");
                },
              })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                keystrokes land in the signal instantly: <b>{() => query() || "—"}</b>
              </span>
              <span class="chip">
                onSearch fired <b>{searches}</b>× — last: <b>{last}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "pin-input",
      name: "PinInput",
      tier: "T2",
      summary:
        "One box per digit for confirmation codes. Focus moves on its own, Backspace walks back, and pasting a whole code fills every box.",
      code: `PinInput({ value: code, length: 6, onComplete: (v) => verify(v) });`,
      demo: () => {
        const code = state("");
        const done = state("—");
        return (
          <div>
            <div class="cmp-row">
              {PinInput({ value: code, length: 6, label: "Code", onComplete: (v: string) => done.set(v) })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                value = <b>{() => code() || "—"}</b>
              </span>
              <span class="chip">
                onComplete = <b>{done}</b>
              </span>
            </div>
          </div>
        );
      },
      notes: ["Try pasting `123456` into the first box."],
    },
    {
      slug: "tags-input",
      name: "TagsInput",
      tier: "T2",
      summary: "Turns typed text into tags on Enter or comma, rejects duplicates, and removes the last tag with Backspace.",
      code: `const tags = state<readonly string[]>(["signals"]);
TagsInput({ value: tags, max: 6, label: "Topics" });`,
      demo: () => {
        const tags = state<readonly string[]>(["signals", "wire"]);
        return (
          <div>
            <div class="cmp-row">{TagsInput({ value: tags, max: 6, label: "Topics", placeholder: "Add a topic…" })}</div>
            <div class="cmp-row">
              <span class="chip">
                <b>{() => String(tags().length)}</b> / 6 — {() => tags().join(", ") || "empty"}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "input-group",
      name: "InputGroup",
      tier: "T2",
      summary: "Glues a prefix or suffix onto a field: a currency symbol, a domain, a unit, or a button.",
      code: `InputGroup({ prefix: "https://", suffix: ".dev", children: Input({ value: name }) });`,
      demo: () => (
        <div class="cmp-row">
          {InputGroup({ prefix: "https://", suffix: ".dev", children: Input({ value: state("raptor") }) })}
        </div>
      ),
    },
    {
      slug: "editable",
      name: "Editable",
      tier: "T2",
      summary:
        "Click-to-edit text: it reads as plain text until you click it, then commits on Enter or blur and reverts on Escape.",
      code: `Editable({ value: title, onCommit: (v) => save(v) });`,
      demo: () => {
        const title = state("Click me to rename");
        const commits = state(0);
        return (
          <div class="cmp-row">
            {Editable({ value: title, label: "Title", onCommit: () => commits.update((n) => n + 1) })}
            <span class="chip">
              committed <b>{commits}</b>×
            </span>
          </div>
        );
      },
    },
    {
      slug: "masked-input",
      name: "MaskedInput",
      tier: "T3",
      summary: "Applies a format as you type (`9` is a digit, `A` a letter) and hands you the value without separators.",
      code: `MaskedInput({ value: card, mask: "9999 9999 9999 9999", label: "Card number" });`,
      demo: () => {
        const card = state("");
        const raw = state("");
        return (
          <div>
            <div class="cmp-row">
              {MaskedInput({ value: card, mask: "9999 9999 9999 9999", label: "Card number", onChange: (v: string) => raw.set(v) })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                unmasked = <b>{() => raw() || "—"}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "currency-input",
      name: "CurrencyInput",
      tier: "T3",
      summary:
        "Money kept as an integer number of minor units — cents, bani — and formatted for the locale on the way out. No floating-point money.",
      code: `const price = state(1999); // 19.99
CurrencyInput({ value: price, currency: "EUR", locale: "en-IE", label: "Price" });`,
      demo: () => {
        const price = state(1999);
        return (
          <div>
            <div class="cmp-row">{CurrencyInput({ value: price, currency: "EUR", locale: "en-IE", label: "Price" })}</div>
            <div class="cmp-row">
              <span class="chip">
                stored as <b>{price}</b> cents
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "phone-input",
      name: "PhoneInput",
      tier: "T3",
      summary: "Groups digits as you type and keeps the country prefix outside the value.",
      code: `PhoneInput({ value: phone, prefix: "+40", groups: [3, 3, 3], label: "Phone" });`,
      demo: () => PhoneInput({ value: state(""), prefix: "+40", groups: [3, 3, 3], label: "Phone" }),
    },
    {
      slug: "date-input",
      name: "DateInput",
      tier: "T3",
      summary: "Typing a date directly, with the separators inserted for you. Pair it with DatePicker when you want both ways in.",
      code: `DateInput({ value: iso, mask: "9999-99-99", label: "Date" });`,
      demo: () => DateInput({ value: state(""), label: "Date (YYYY-MM-DD)" }),
    },
    {
      slug: "mentions",
      name: "Mentions",
      tier: "T3",
      summary: "A textarea that opens a list when you type `@`. The list is filtered by whatever follows the trigger.",
      code: `Mentions({
  value: text,
  trigger: "@",
  search: (q) => people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())),
});`,
      demo: () => {
        const text = state("Ping ");
        const picked = state("—");
        return (
          <div>
            <div class="cmp-row">
              {Mentions({
                value: text,
                rows: 3,
                label: "Message",
                placeholder: "Type @ to mention someone",
                search: (q: string) => PEOPLE.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())),
                onMention: (o: MentionOption) => picked.set(o.label),
              })}
            </div>
            <div class="cmp-row">
              <span class="chip">
                last mention: <b>{picked}</b>
              </span>
            </div>
          </div>
        );
      },
    },
    {
      slug: "rich-text-editor",
      name: "RichTextEditor",
      tier: "T3",
      summary: "A small WYSIWYG editor with a toolbar over a contenteditable region, writing HTML into your signal.",
      code: `const html = state("<p>Hello</p>");
RichTextEditor({ value: html, minHeight: "120px", label: "Body" });`,
      demo: () => {
        const html = state("<p>Select this text and press <b>B</b>.</p>");
        return (
          <div>
            {RichTextEditor({ value: html, minHeight: "110px", label: "Body" })}
            <div class="cmp-label" style="margin-top:12px">
              value
            </div>
            <pre class="code" style="padding:10px;border:1px solid var(--border);border-radius:6px;white-space:pre-wrap">
              {html}
            </pre>
          </div>
        );
      },
    },
    {
      slug: "code-editor",
      name: "CodeEditor",
      tier: "T3",
      summary:
        "A textarea with line numbers, Tab indentation and syntax colouring drawn behind the text. The tokenizer is yours — the component does not ship one.",
      code: `CodeEditor({
  value: source,
  lineNumbers: true,
  highlight: (code) => myTokenizer(code),
});`,
      demo: () =>
        CodeEditor({
          value: state(`const count = state(0);
const doubled = derived(() => count() * 2);
count.set(21);`),
          lineNumbers: true,
          minHeight: "120px",
          label: "Editor",
          highlight: (code: string) => highlight(code),
        }),
      notes: ["Again the site's own tokenizer — the same one behind every code block here."],
    },
  ],
};
