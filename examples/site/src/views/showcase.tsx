/**
 * Showcase: the real examples from the monorepo, grouped into cards, each with its
 * run command (with copy). Built with RaptorJS.
 */
import { state } from "raptorjs";
import { SectionHead } from "../lib/ui.tsx";
import { SHOWCASE } from "../content/showcase.ts";

function RunCmd(props: { cmd: string }) {
  const copied = state(false);
  const copy = () => {
    try {
      navigator.clipboard?.writeText(props.cmd);
      copied.set(true);
      setTimeout(() => copied.set(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div class="run-cmd" on:click={copy} title="Copy">
      <span class="d">$</span>
      <span class="run-text">{props.cmd}</span>
      <span class="run-copy">{() => (copied() ? "copied ✓" : "copy")}</span>
    </div>
  );
}

export function ShowcaseView() {
  return (
    <div class="view wrap block" style="padding-top:44px">
      <SectionHead
        eyebrow="Showcase"
        title="Built with Raptor"
        sub="Everything here lives in the monorepo and runs from the repo root. The stack proves itself on its own examples first."
      />
      {SHOWCASE.map((g) => (
        <div class="show-group">
          <h2 class="show-gtitle">{g.title}</h2>
          <p class="sub" style="margin-top:2px">{g.blurb}</p>
          <div class="showcase-grid">
            {g.items.map((it) => (
              <div class="show-card">
                <h3>{it.title}</h3>
                <p>{it.blurb}</p>
                <div class="show-tags">
                  {it.tags.map((t) => <span class="tag2">{t}</span>)}
                </div>
                <RunCmd cmd={it.run} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
