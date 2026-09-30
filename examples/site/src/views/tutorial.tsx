/**
 * Interactive tutorial: a list of steps + explanation + editor + a running
 * preview, like the Playground but guided. The current step comes from the route
 * (`sub()`), so each step has its own URL. The code is evaluated with the `R` primitives.
 */
import { R, state, derived, effect, batch, onCleanup, For, Show, render } from "raptorjs/dom";
import { sub, navigate } from "../lib/route.ts";
import { inline } from "../lib/ui.tsx";
import { TUTORIAL } from "../content/tutorial.ts";

export function TutorialView() {
  const idx = derived(() => {
    const i = TUTORIAL.findIndex((s) => s.slug === sub());
    return i < 0 ? 0 : i;
  });

  const error = state("");
  let previewEl: any = null;
  let ta: any = null;
  let disposeFn: (() => void) | null = null;

  function run(code: string) {
    if (!previewEl) return;
    if (disposeFn) {
      try {
        disposeFn();
      } catch {
        /* ignore */
      }
      disposeFn = null;
    }
    previewEl.textContent = "";
    try {
      const factory = new Function(
        "R", "state", "derived", "effect", "batch", "onCleanup", "For", "Show", "render",
        code + "\nreturn App;",
      );
      const App = factory(R, state, derived, effect, batch, onCleanup, For, Show, render);
      if (typeof App !== "function") throw new Error("Define a function named `App` that returns UI.");
      disposeFn = render(App, previewEl);
      error.set("");
    } catch (err: any) {
      error.set(String(err && err.message ? err.message : err));
    }
  }

  // Reload the editor + preview when the step in the route changes.
  effect(() => {
    const step = TUTORIAL[idx()]!;
    if (ta) ta.value = step.code;
    run(step.code);
  });
  onCleanup(() => {
    if (disposeFn) try { disposeFn(); } catch { /* ignore */ }
  });

  const go = (i: number) => {
    const s = TUTORIAL[i];
    if (s) navigate("tutorial/" + s.slug);
  };

  return (
    <div class="view wrap block" style="padding-top:44px">
      <div class="eyebrow">Tutorial</div>
      <h2 class="h2">Learn Raptor by editing it</h2>
      <p class="sub">Five short steps, each running live. Change the code and watch the preview react — no build, no reload.</p>

      <div class="tut">
        <aside class="tut-steps">
          {TUTORIAL.map((s, i) => (
            <span
              class={() => "tut-step" + (idx() === i ? " active" : "") + (idx() > i ? " done" : "")}
              on:click={() => go(i)}
            >
              <span class="tut-n">{String(i + 1)}</span>
              {s.title}
            </span>
          ))}
        </aside>

        <div class="tut-main">
          <div class="tut-lead">
            <p>{() => inline(TUTORIAL[idx()]!.intro)}</p>
            {() => {
              const pts = TUTORIAL[idx()]!.points;
              return pts ? <ul class="tut-points">{pts.map((p) => <li>{inline(p)}</li>)}</ul> : null;
            }}
          </div>

          <div class="pg">
            <div class="pg-editor">
              <textarea
                class="pg-code"
                spellcheck="false"
                ref={(el: any) => {
                  ta = el;
                  el.value = TUTORIAL[idx()]!.code;
                }}
                on:input={(e: any) => run(e.target.value)}
              ></textarea>
              <div class="pg-err">{() => error()}</div>
            </div>
            <div class="pg-preview">
              <div class="phead">
                <span>Preview</span>
                <span class="badge-live">live</span>
              </div>
              <div
                ref={(el: any) => {
                  previewEl = el;
                  run(TUTORIAL[idx()]!.code);
                }}
              ></div>
            </div>
          </div>

          <div class="tut-nav">
            <span class="btn btn-ghost" style={() => (idx() === 0 ? "visibility:hidden" : "")} on:click={() => go(idx() - 1)}>
              ← Previous
            </span>
            <Show
              when={() => idx() < TUTORIAL.length - 1}
              children={<span class="btn btn-primary" on:click={() => go(idx() + 1)}>Next step →</span>}
              fallback={<span class="btn btn-primary" on:click={() => navigate("playground")}>Open the Playground →</span>}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
