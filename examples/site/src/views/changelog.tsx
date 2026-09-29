/**
 * Changelog: o listă de release-uri pe o linie de timp, fiecare cu blocuri de
 * conținut randate de `renderBlocks`. Construit cu RaptorJS ca tot restul.
 */
import { SectionHead, renderBlocks } from "../lib/ui.tsx";
import { RELEASES } from "../content/changelog.ts";

export function ChangelogView() {
  return (
    <div class="view wrap block" style="padding-top:44px">
      <SectionHead
        eyebrow="Changelog"
        title="What changed, and when"
        sub="Honest notes per release. Unreleased first, following the Keep a Changelog convention."
      />
      <div class="changelog">
        {RELEASES.map((r) => (
          <div class="rel">
            <div class="rel-meta">
              <span class={"rel-ver" + (r.version === "Unreleased" ? " unreleased" : "")}>{r.version}</span>
              <span class="rel-date">{r.date}</span>
            </div>
            <div class="rel-body">
              <h2 class="rel-title">{r.title}</h2>
              {renderBlocks(r.blocks)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
