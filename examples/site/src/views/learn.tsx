/** Learn: sidebar + prose + on-this-page TOC + prev/next. Nested-route reactive. */
import { sub, navigate } from "../lib/route.ts";
import { renderBlocks, headings } from "../lib/ui.tsx";
import { LESSONS, LEARN_GROUPS, type Lesson } from "../content/learn.ts";
import { DEMOS } from "../demos/index.tsx";

const current = (): Lesson => LESSONS.find((l) => l.slug === sub()) ?? LESSONS[0]!;

function Sidebar() {
  return (
    <aside class="sidebar">
      {LEARN_GROUPS.map((g) => (
        <div class="side-group">
          <div class="side-title">{g}</div>
          {LESSONS.filter((l) => l.group === g).map((l) => (
            <span
              class={() => "side-item" + (current().slug === l.slug ? " active" : "")}
              on:click={() => navigate("learn/" + l.slug)}
            >
              {l.title}
            </span>
          ))}
        </div>
      ))}
    </aside>
  );
}

function PrevNext() {
  const i = LESSONS.findIndex((l) => l.slug === current().slug);
  const prev = LESSONS[i - 1];
  const next = LESSONS[i + 1];
  return (
    <div class="prevnext">
      {prev ? (
        <div class="pn" on:click={() => navigate("learn/" + prev.slug)}>
          <div class="d">← Previous</div>
          <div class="t">{prev.title}</div>
        </div>
      ) : (
        <div></div>
      )}
      {next ? (
        <div class="pn next" on:click={() => navigate("learn/" + next.slug)}>
          <div class="d">Next →</div>
          <div class="t">{next.title}</div>
        </div>
      ) : (
        <div></div>
      )}
    </div>
  );
}

function Prose() {
  const l = current();
  return (
    <article class="prose">
      <div class="crumbs">
        <b>Learn</b> / {l.group}
      </div>
      <h1>{l.title}</h1>
      <p class="intro">{l.intro}</p>
      {renderBlocks(l.blocks, DEMOS)}
      <PrevNext />
    </article>
  );
}

function Toc() {
  const hs = headings(current().blocks);
  return (
    <aside class="toc">
      <div class="tt">On this page</div>
      {hs.map((hh) => (
        <a on:click={() => document.getElementById(hh.id)?.scrollIntoView({ behavior: "smooth" })}>{hh.text}</a>
      ))}
    </aside>
  );
}

export function LearnView() {
  return (
    <div class="view wrap doc-shell with-toc">
      <Sidebar />
      {() => Prose()}
      {() => Toc()}
    </div>
  );
}
