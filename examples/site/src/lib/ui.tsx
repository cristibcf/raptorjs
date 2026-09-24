/**
 * UI toolkit for the site (RaptorJS, fine-grained). Pure functions returning real
 * DOM nodes, plus a content-block renderer used by the Learn/Reference pages.
 * The Playground builds UI without a JSX compiler via `R` from @raptor/dom.
 */
import { state } from "@raptor/dom";
import { navigate } from "./route.ts";

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Inline markup: `code` spans and [label](path) internal links. */
export function inline(text: string): any[] {
  const out: any[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push(<b>{m[1]}</b>);
    else if (m[2] != null) out.push(<code class="inl">{m[2]}</code>);
    else {
      const target = m[4]!;
      out.push(
        <a class="inl" on:click={() => navigate(target)}>
          {m[3]}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ------------------------------------------------------- syntax highlight ---- */
const KEYWORDS = new Set(
  ("const let var function return import from export default new if else for while do await async " +
    "of in true false null undefined interface type class extends implements void as typeof instanceof " +
    "try catch finally throw switch case break continue this super yield public private readonly static").split(" "),
);

/** Tiny zero-dep tokenizer for TS/JSX snippets → colored spans. */
export function highlight(code: string): any[] {
  const out: any[] = [];
  const re =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\w.]*\b)|(<\/?[A-Za-z][\w.]*|\/>)|([A-Za-z_$][\w$]*)|(\s+|[^\w\s])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1] != null) out.push(<span class="c">{m[1]}</span>);
    else if (m[2] != null) out.push(<span class="s">{m[2]}</span>);
    else if (m[3] != null) out.push(<span class="n">{m[3]}</span>);
    else if (m[4] != null) out.push(<span class="t">{m[4]}</span>);
    else if (m[5] != null) {
      const word = m[5];
      const next = code[re.lastIndex];
      if (KEYWORDS.has(word)) out.push(<span class="k">{word}</span>);
      else if (next === "(") out.push(<span class="f">{word}</span>);
      else if (/^[A-Z]/.test(word)) out.push(<span class="t">{word}</span>);
      else out.push(word);
    } else out.push(m[6]);
  }
  return out;
}

/* ---------------------------------------------------------------- pieces ----- */
export function Code(props: { code: string; file?: string; lang?: string }) {
  const copied = state(false);
  const copy = () => {
    try {
      navigator.clipboard?.writeText(props.code);
      copied.set(true);
      setTimeout(() => copied.set(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div class="codeblock">
      <div class="cb-head">
        <span class="dot" style="background:#ff5f57"></span>
        <span class="dot" style="background:#febc2e"></span>
        <span class="dot" style="background:#28c840"></span>
        <span class="cb-file">{props.file ?? props.lang ?? "tsx"}</span>
        <button class="cb-copy" on:click={copy}>{() => (copied() ? "copied ✓" : "copy")}</button>
      </div>
      <pre class="code">{highlight(props.code)}</pre>
    </div>
  );
}

export function Card(props: { icon?: string; title: string; tag?: string; body: string }) {
  return (
    <div class="card">
      {props.icon ? <div class="ic">{props.icon}</div> : null}
      <h3>{props.title}</h3>
      {props.tag ? <div class="tag">{props.tag}</div> : null}
      <p>{props.body}</p>
    </div>
  );
}

export function SectionHead(props: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div>
      <div class="eyebrow">{props.eyebrow}</div>
      <h2 class="h2">{props.title}</h2>
      {props.sub ? <p class="sub">{props.sub}</p> : null}
    </div>
  );
}

const NOTE_ICON: Record<string, string> = { info: "ℹ", tip: "✓", warn: "⚠" };
export function Callout(props: { kind: "info" | "tip" | "warn"; title?: string; text: string }) {
  return (
    <div class={"callout " + props.kind}>
      <div class="ct">
        <span>{NOTE_ICON[props.kind]}</span>
        {props.title ?? (props.kind === "warn" ? "Watch out" : props.kind === "tip" ? "Tip" : "Note")}
      </div>
      <div>{inline(props.text)}</div>
    </div>
  );
}

/* ------------------------------------------------------------- content blocks - */
export type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "code"; code: string; file?: string }
  | { t: "note"; kind: "info" | "tip" | "warn"; title?: string; text: string }
  | { t: "list"; items: string[] }
  | { t: "demo"; key: string }
  | {
      t: "table";
      head: string[];
      rows: string[][];
      /** Indici de coloana aliniate la dreapta (numere). */
      numeric?: number[];
      /**
       * Per rand, indicele coloanei de evidentiat (cel mai bun rezultat), sau
       * null. Tinut separat de date: un marcaj in text s-ar ciocni cu markup-ul
       * inline — `**bold**` incepe si el cu un asterisc.
       */
      best?: (number | null)[];
      caption?: string;
    };

export interface HeadingRef {
  id: string;
  text: string;
}

export function renderBlock(b: Block, demos?: Record<string, () => any>): any {
  switch (b.t) {
    case "p":
      return <p>{inline(b.text)}</p>;
    case "h": {
      const id = slug(b.text);
      return (
        <h2 id={id}>
          {b.text}
          <a class="anchor" on:click={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })}>
            #
          </a>
        </h2>
      );
    }
    case "code":
      return <Code code={b.code} file={b.file} />;
    case "note":
      return <Callout kind={b.kind} title={b.title} text={b.text} />;
    case "list":
      return <ul>{b.items.map((it) => <li>{inline(it)}</li>)}</ul>;
    case "demo": {
      const make = demos?.[b.key];
      return <div class="live-demo">{make ? make() : <p class="sub">demo: {b.key}</p>}</div>;
    }
    case "table": {
      const num = new Set(b.numeric ?? []);
      const cell = (text: string, col: number, row: number) => (
        <td class={(num.has(col) ? "n" : "") + (b.best?.[row] === col ? " best" : "")}>{inline(text)}</td>
      );
      return (
        <div class="tablewrap">
          <table class="data">
            <thead>
              <tr>{b.head.map((h, i) => <th class={num.has(i) ? "n" : ""}>{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => <tr>{r.map((c, ci) => cell(c, ci, ri))}</tr>)}
            </tbody>
          </table>
          {b.caption ? <p class="tcap">{inline(b.caption)}</p> : null}
        </div>
      );
    }
  }
}

export function renderBlocks(blocks: Block[], demos?: Record<string, () => any>): any[] {
  return blocks.map((b) => renderBlock(b, demos));
}

/** Extract h2 headings for the "On this page" table of contents. */
export function headings(blocks: Block[]): HeadingRef[] {
  return blocks.filter((b): b is { t: "h"; text: string } => b.t === "h").map((b) => ({ id: slug(b.text), text: b.text }));
}
