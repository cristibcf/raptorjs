/**
 * Stiluri optionale pentru @raptor/ui.
 *
 * Nu se injecteaza singure: componentele pun doar clase, iar tu decizi daca
 * folosesti CSS-ul asta, il suprascrii sau il ignori complet. Culorile si
 * spatierile sunt custom properties, deci temarea nu cere fork.
 */
export const RUI_CSS = `
.rui-table {
  --rui-border: #d7dae0;
  --rui-bg: transparent;
  --rui-bg-alt: rgba(0,0,0,0.02);
  --rui-fg-muted: #5b6270;
  --rui-accent: #17457a;
  --rui-radius: 8px;
  width: 100%;
  border-collapse: collapse;
  background: var(--rui-bg);
}
.rui-th, .rui-td { padding: 8px 10px; border-bottom: 1px solid var(--rui-border); text-align: left; }
.rui-th { font-weight: 600; color: var(--rui-fg-muted); user-select: none; white-space: nowrap; }
.rui-sortable { cursor: pointer; }
.rui-sortable:hover, .rui-sortable:focus-visible { color: var(--rui-accent); }
.rui-sort-arrow { display: inline-block; width: 1em; margin-left: 4px; }
.rui-tr:hover > .rui-td { background: var(--rui-bg-alt); }
.rui-selected > .rui-td { background: color-mix(in srgb, var(--rui-accent) 12%, transparent); }
.rui-empty > td { padding: 18px 10px; color: var(--rui-fg-muted); text-align: center; }

/* Layout T3 */
.rui-masonry-col > * { break-inside: avoid; }
.rui-affix.rui-affixed { box-shadow: 0 2px 8px rgba(0,0,0,0.10); z-index: 30; }
.rui-skipnav {
  position: absolute; left: -9999px; top: 0; z-index: 200;
  padding: 10px 16px; background: var(--rui-accent, #17457a); color: #ffffff;
  border-radius: 0 0 8px 0; text-decoration: none;
}
.rui-skipnav:focus { left: 0; }
.rui-bottomnav {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
  display: flex; background: var(--rui-menu-bg, #ffffff);
  border-top: 1px solid var(--rui-border, #d7dae0);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.rui-bottomnav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border: 0; background: none; font: inherit; font-size: 11px; cursor: pointer; color: var(--rui-fg-muted, #5b6270); }
.rui-bottomnav-item.rui-active { color: var(--rui-accent, #17457a); }
.rui-bottomnav-icon { font-size: 18px; }
.rui-dock { position: fixed; z-index: 60; display: flex; gap: 4px; padding: 6px; border-radius: 12px; background: var(--rui-menu-bg, #ffffff); box-shadow: 0 8px 28px rgba(0,0,0,0.18); }
.rui-dock-bottom { bottom: 20px; left: 50%; transform: translateX(-50%); }
.rui-dock-left { left: 20px; top: 50%; transform: translateY(-50%); flex-direction: column; }
.rui-dock-right { right: 20px; top: 50%; transform: translateY(-50%); flex-direction: column; }
.rui-dock-item { width: 40px; height: 40px; border: 0; border-radius: 9px; background: none; font-size: 17px; cursor: pointer; }
.rui-dock-item:hover, .rui-dock-item.rui-active { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-splitbutton { display: inline-flex; }
.rui-splitbutton .rui-split-main { border-radius: 8px 0 0 8px; }
.rui-splitbutton .rui-menu-trigger { border: 1px solid var(--rui-border, #d7dae0); border-left: 0; border-radius: 0 8px 8px 0; padding: 0 8px; background: var(--rui-menu-bg, #ffffff); cursor: pointer; height: 100%; }
.rui-fab { position: fixed; z-index: 55; display: inline-flex; align-items: center; gap: 8px; height: 52px; padding: 0 18px; border: 0; border-radius: 26px; background: var(--rui-accent, #17457a); color: #ffffff; font: inherit; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,0.22); }
.rui-fab:not(.rui-fab-extended) { width: 52px; padding: 0; justify-content: center; }
.rui-fab-bottom-right { right: 22px; bottom: 22px; }
.rui-fab-bottom-left { left: 22px; bottom: 22px; }
.rui-fab-bottom-center { left: 50%; bottom: 22px; transform: translateX(-50%); }
.rui-fab-icon { font-size: 20px; }

/* Inputuri T3 */
.rui-phone { display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; background: #ffffff; }
.rui-phone-prefix { color: var(--rui-fg-muted, #5b6270); }
.rui-phone-input { border: 0; padding: 8px 0; font: inherit; outline: none; background: none; }
.rui-mentions { position: relative; display: block; }
.rui-mentions-list { margin: 0; padding: 4px; list-style: none; max-height: 220px; overflow: auto; background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 50; min-width: 200px; }
.rui-mentions-option { display: flex; justify-content: space-between; gap: 12px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.rui-mentions-option.rui-active { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-mentions-detail { color: var(--rui-fg-muted, #8a909c); font-size: 12px; }
.rui-rating { display: inline-flex; gap: 2px; cursor: pointer; }
.rui-rating.rui-readonly { cursor: default; }
.rui-rating:focus-visible { outline: 2px solid var(--rui-accent, #17457a); outline-offset: 3px; border-radius: 4px; }
.rui-rating-star { position: relative; display: inline-block; font-size: 20px; line-height: 1; color: rgba(0,0,0,0.18); }
.rui-rating-fg { position: absolute; left: 0; top: 0; overflow: hidden; color: #f0a020; white-space: nowrap; }
.rui-swatches { display: inline-grid; gap: 5px; }
.rui-swatch { width: 26px; height: 26px; border: 1px solid rgba(0,0,0,0.15); border-radius: 6px; cursor: pointer; font-size: 13px; padding: 0; }
.rui-swatch.rui-selected { outline: 2px solid var(--rui-accent, #17457a); outline-offset: 2px; }
.rui-colorpicker { position: relative; display: inline-block; }
.rui-color-trigger { width: 34px; height: 34px; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; cursor: pointer; }
.rui-color-pop { z-index: 60; display: flex; flex-direction: column; gap: 8px; padding: 12px; background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.14); }
.rui-color-native { width: 100%; height: 38px; border: 0; background: none; padding: 0; cursor: pointer; }
.rui-color-hex { padding: 6px 8px; border: 1px solid var(--rui-border, #d7dae0); border-radius: 6px; font: inherit; font-family: ui-monospace, monospace; }
.rui-color-contrast { font-size: 12px; }
.rui-color-contrast.rui-ok { color: #0f6e4f; }
.rui-color-contrast.rui-low { color: #b42318; }
.rui-transfer { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; }
.rui-transfer-panel { border: 1px solid var(--rui-border, #d7dae0); border-radius: 9px; overflow: hidden; }
.rui-transfer-title { padding: 8px 10px; font-weight: 600; font-size: 13px; background: rgba(0,0,0,0.03); border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-transfer-list { list-style: none; margin: 0; padding: 4px; max-height: 220px; overflow: auto; }
.rui-transfer-item { padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.rui-transfer-item.rui-marked { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-transfer-item.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-transfer-actions { display: flex; flex-direction: column; gap: 6px; }
.rui-cascader, .rui-treeselect { position: relative; display: inline-block; }
.rui-cascader-trigger, .rui-treeselect-trigger { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 180px; height: 36px; padding: 0 10px; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; background: #ffffff; font: inherit; cursor: pointer; }
.rui-cascader-placeholder { color: var(--rui-fg-muted, #8a909c); }
.rui-cascader-pop { z-index: 60; display: flex; background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0); border-radius: 9px; box-shadow: 0 8px 24px rgba(0,0,0,0.14); overflow: hidden; }
.rui-cascader-col { list-style: none; margin: 0; padding: 4px; min-width: 150px; max-height: 240px; overflow: auto; border-right: 1px solid var(--rui-border, #d7dae0); }
.rui-cascader-col:last-child { border-right: 0; }
.rui-cascader-item { display: flex; justify-content: space-between; gap: 10px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.rui-cascader-item.rui-active { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-cascader-item.rui-selected { font-weight: 600; }
.rui-cascader-item.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-treeselect-pop { list-style: none; margin: 0; padding: 4px; min-width: 220px; max-height: 280px; overflow: auto; z-index: 60; background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0); border-radius: 9px; box-shadow: 0 8px 24px rgba(0,0,0,0.14); }
.rui-treeselect-group { list-style: none; margin: 0; padding: 0; }
.rui-treeselect-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 6px; cursor: pointer; }
.rui-treeselect-row:hover { background: rgba(0,0,0,0.05); }
.rui-treeselect-row.rui-selected { background: var(--rui-menu-active, rgba(23,69,122,0.10)); font-weight: 600; }
.rui-treeselect-toggle { width: 14px; font-size: 10px; opacity: 0.6; }

/* Grafice T3 */
.rui-slice { stroke: var(--rui-menu-bg, #ffffff); stroke-width: 1; }
.rui-pie-center { font-size: 18px; font-weight: 700; fill: currentColor; }
.rui-gauge-track { stroke: rgba(0,0,0,0.10); }
.rui-gauge-value { font-size: 22px; font-weight: 700; fill: currentColor; }
.rui-gauge-label { font-size: 11px; fill: var(--rui-fg-muted, #5b6270); }
.rui-heat-cell { transition: fill-opacity 140ms ease; }
.rui-treemap-label { font-size: 11px; fill: #ffffff; font-weight: 600; }
.rui-funnel-rate { fill: var(--rui-fg-muted, #5b6270); }
.rui-meter { display: flex; align-items: center; gap: 8px; }
.rui-meter-track { flex: 1; height: 8px; border-radius: 999px; background: rgba(0,0,0,0.08); overflow: hidden; }
.rui-meter-fill { height: 100%; background: #0f6e4f; transition: width 140ms ease; }
.rui-meter-fill.rui-level-low { background: #b45309; }
.rui-meter-fill.rui-level-high { background: #b42318; }
.rui-meter-value { font-size: 13px; color: var(--rui-fg-muted, #5b6270); }

/* Editoare */
.rui-rte { border: 1px solid var(--rui-border, #d7dae0); border-radius: 9px; overflow: hidden; }
.rui-rte-toolbar { display: flex; gap: 2px; padding: 5px; border-bottom: 1px solid var(--rui-border, #d7dae0); background: rgba(0,0,0,0.02); }
.rui-rte-button { min-width: 30px; height: 30px; border: 0; border-radius: 6px; background: none; font: inherit; font-weight: 700; cursor: pointer; }
.rui-rte-button:hover { background: rgba(0,0,0,0.06); }
.rui-rte-body { padding: 12px; outline: none; }
.rui-rte-body.rui-empty::before { content: attr(data-placeholder); color: var(--rui-fg-muted, #8a909c); pointer-events: none; }
.rui-codeeditor { display: flex; border: 1px solid var(--rui-border, #d7dae0); border-radius: 9px; overflow: hidden; font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.55; }
.rui-code-gutter { padding: 12px 8px; text-align: right; color: var(--rui-fg-muted, #8a909c); background: rgba(0,0,0,0.03); user-select: none; }
.rui-code-stack { position: relative; flex: 1; }
.rui-code-highlight, .rui-code-input {
  margin: 0; padding: 12px; border: 0; font: inherit; line-height: inherit;
  white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word;
}
.rui-code-highlight { pointer-events: none; }
.rui-code-input {
  position: absolute; inset: 0; width: 100%; height: 100%; resize: none;
  background: transparent; color: transparent; caret-color: currentColor; outline: none;
}
.rui-json { font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.6; }
.rui-json-toggle { border: 0; background: none; font: inherit; cursor: pointer; padding: 0; color: inherit; }
.rui-json-caret { display: inline-block; width: 12px; opacity: 0.6; }
.rui-json-children { list-style: none; margin: 0; padding-left: 16px; border-left: 1px solid var(--rui-border, #d7dae0); }
.rui-json-key { color: #8250a8; }
.rui-json-string { color: #0f6e4f; }
.rui-json-number { color: #b45309; }
.rui-json-boolean, .rui-json-null { color: #17457a; }
.rui-json-cycle { color: #b42318; font-style: italic; }
.rui-diff { border: 1px solid var(--rui-border, #d7dae0); border-radius: 9px; overflow: hidden; font-family: ui-monospace, monospace; font-size: 12.5px; }
.rui-diff-head { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: rgba(0,0,0,0.03); border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-diff-stats { margin-left: auto; }
.rui-diff-table { width: 100%; border-collapse: collapse; }
.rui-diff-lineno { width: 1%; padding: 0 8px; text-align: right; color: var(--rui-fg-muted, #8a909c); user-select: none; }
.rui-diff-line { padding: 0 8px; white-space: pre-wrap; }
.rui-diff-sign { display: inline-block; width: 1ch; }
.rui-diff-insert { background: rgba(15,110,79,0.12); }
.rui-diff-delete { background: rgba(180,35,24,0.12); }
.rui-diff-skip { background: rgba(0,0,0,0.03); color: var(--rui-fg-muted, #8a909c); text-align: center; }
.rui-compare { width: 100%; border-collapse: collapse; }
.rui-compare th, .rui-compare td { padding: 10px 12px; border-bottom: 1px solid var(--rui-border, #d7dae0); text-align: left; }
.rui-compare-plan { text-align: center; }
.rui-compare .rui-featured { background: var(--rui-menu-active, rgba(23,69,122,0.06)); }
.rui-compare-cell { text-align: center; }
.rui-compare-yes { color: #0f6e4f; font-weight: 700; }
.rui-compare-no { color: var(--rui-fg-muted, #8a909c); }
.rui-compare-group th { background: rgba(0,0,0,0.03); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.rui-compare-hint { display: block; font-size: 12px; color: var(--rui-fg-muted, #5b6270); font-weight: 400; }

/* Media */
.rui-carousel { position: relative; }
.rui-carousel-viewport { overflow: hidden; }
.rui-carousel-track { display: flex; transition: transform 320ms ease; }
.rui-carousel-slide { flex: 0 0 100%; min-width: 0; }
.rui-carousel-arrows { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; pointer-events: none; padding: 0 6px; }
.rui-carousel-arrow { pointer-events: auto; width: 34px; height: 34px; border: 0; border-radius: 50%; background: rgba(255,255,255,0.85); font-size: 17px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.18); }
.rui-carousel-arrow:disabled { opacity: 0.35; cursor: not-allowed; }
.rui-carousel-dots { display: flex; justify-content: center; gap: 6px; margin-top: 8px; }
.rui-carousel-dot { width: 8px; height: 8px; padding: 0; border: 0; border-radius: 50%; background: rgba(0,0,0,0.20); cursor: pointer; }
.rui-carousel-dot.rui-active { background: var(--rui-accent, #17457a); width: 20px; border-radius: 4px; }
.rui-gallery { display: grid; gap: 8px; list-style: none; margin: 0; padding: 0; }
.rui-gallery-button { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: pointer; border-radius: 8px; overflow: hidden; }
.rui-gallery-img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
.rui-lightbox { position: fixed; inset: 0; z-index: 150; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.88); }
.rui-lightbox-img { max-width: 92vw; max-height: 82vh; display: block; }
.rui-lightbox-figure { margin: 0; text-align: center; }
.rui-lightbox-caption { color: #ffffff; margin-top: 10px; font-size: 14px; }
.rui-lightbox-close, .rui-lightbox-prev, .rui-lightbox-next { position: absolute; border: 0; background: rgba(255,255,255,0.12); color: #ffffff; cursor: pointer; border-radius: 50%; width: 42px; height: 42px; font-size: 20px; }
.rui-lightbox-close { top: 16px; right: 16px; }
.rui-lightbox-prev { left: 16px; }
.rui-lightbox-next { right: 16px; }
.rui-lightbox-counter { position: absolute; bottom: 16px; color: rgba(255,255,255,0.75); font-size: 13px; }
.rui-zoom { display: inline-block; overflow: hidden; }
.rui-zoom-img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 120ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .rui-zoom-img, .rui-carousel-track { transition: none; }
  .rui-zoom-img { transform: none !important; }
}
.rui-player { display: flex; flex-direction: column; gap: 8px; }
.rui-player-media { width: 100%; display: block; border-radius: 9px; background: #000000; }
.rui-audio .rui-player-media { display: none; }
.rui-player-controls { display: flex; align-items: center; gap: 8px; }
.rui-player-play, .rui-player-mute { width: 34px; height: 34px; border: 0; border-radius: 8px; background: rgba(0,0,0,0.06); cursor: pointer; }
.rui-player-seek { flex: 1; }
.rui-player-volume { width: 70px; }
.rui-player-time { font-size: 12px; color: var(--rui-fg-muted, #5b6270); }
.rui-waveform { display: inline-block; cursor: pointer; }
.rui-waveform-bar { fill: rgba(0,0,0,0.22); }
.rui-waveform-bar.rui-played { fill: var(--rui-accent, #17457a); }
.rui-imageupload { position: relative; display: inline-block; }
.rui-imageupload.rui-circle .rui-imageupload-drop, .rui-imageupload.rui-circle .rui-imageupload-img { border-radius: 50%; }
.rui-imageupload-drop { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; border: 2px dashed var(--rui-border, #d7dae0); border-radius: 10px; cursor: pointer; overflow: hidden; }
.rui-imageupload-img { width: 100%; height: 100%; object-fit: cover; }
.rui-imageupload-hint { font-size: 11px; color: var(--rui-fg-muted, #8a909c); text-align: center; padding: 6px; }
.rui-imageupload-clear { position: absolute; top: -4px; right: -4px; width: 22px; height: 22px; border: 0; border-radius: 50%; background: #b42318; color: #ffffff; font-size: 11px; cursor: pointer; }
.rui-uploads-total { height: 4px; border-radius: 999px; background: rgba(0,0,0,0.08); overflow: hidden; margin-bottom: 8px; }
.rui-uploads-total-bar { height: 100%; background: var(--rui-accent, #17457a); transition: width 160ms ease; }
.rui-uploads-list { list-style: none; margin: 0; padding: 0; }
.rui-upload { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
.rui-upload-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rui-upload-bar-track { display: block; width: 80px; height: 4px; border-radius: 999px; background: rgba(0,0,0,0.10); overflow: hidden; }
.rui-upload-bar { display: block; height: 100%; background: var(--rui-accent, #17457a); }
.rui-upload-error { color: #b42318; font-size: 12px; }
.rui-upload.rui-done .rui-upload-bar { background: #0f6e4f; }
.rui-upload-retry, .rui-upload-cancel { border: 0; background: none; cursor: pointer; opacity: 0.6; }
.rui-filepreview { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; }
.rui-filepreview-img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; }
.rui-filepreview-icon { font-size: 30px; }
.rui-filepreview-name { font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rui-filepreview-size { font-size: 10px; color: var(--rui-fg-muted, #8a909c); }
.rui-qrcode-svg { display: block; }
.rui-qrcode-error { color: #b42318; font-size: 13px; }

/* Diverse T3 */
.rui-kanban { display: flex; gap: 12px; align-items: flex-start; overflow-x: auto; }
.rui-kanban-col { flex: 0 0 260px; border: 1px solid var(--rui-border, #d7dae0); border-radius: 10px; background: rgba(0,0,0,0.02); }
.rui-kanban-col.rui-over { border-color: var(--rui-accent, #17457a); }
.rui-kanban-col.rui-over-limit { border-color: #b45309; }
.rui-kanban-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-kanban-title { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
.rui-kanban-count { font-size: 12px; color: var(--rui-fg-muted, #5b6270); font-variant-numeric: tabular-nums; }
.rui-kanban-list { list-style: none; margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 8px; min-height: 40px; }
.rui-kanban-card { padding: 10px; border-radius: 8px; background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0); cursor: grab; }
.rui-kanban-card.rui-dragging { opacity: 0.5; cursor: grabbing; }
.rui-kanban-card-title { font-weight: 600; font-size: 14px; }
.rui-kanban-card-desc { font-size: 12.5px; color: var(--rui-fg-muted, #5b6270); margin-top: 3px; }
.rui-kanban-card-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.rui-wizard-steps { display: flex; gap: 6px; list-style: none; margin: 0 0 16px; padding: 0; }
.rui-wizard-step { flex: 1; }
.rui-wizard-steplabel { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; font: inherit; text-align: left; padding: 6px; border-radius: 8px; cursor: pointer; }
.rui-wizard-marker { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.10); font-size: 12px; font-weight: 600; flex: none; }
.rui-wizard-step.rui-done .rui-wizard-marker { background: #0f6e4f; color: #ffffff; }
.rui-wizard-step.rui-current .rui-wizard-marker { background: var(--rui-accent, #17457a); color: #ffffff; }
.rui-wizard-optional { font-size: 11px; color: var(--rui-fg-muted, #8a909c); }
.rui-wizard-actions { display: flex; justify-content: space-between; gap: 8px; margin-top: 16px; }
.rui-menubar { display: flex; gap: 2px; }
.rui-menubar-item .rui-menu-trigger { border: 0; background: none; padding: 6px 10px; border-radius: 6px; font: inherit; cursor: pointer; }
.rui-menubar-item .rui-menu-trigger:hover { background: rgba(0,0,0,0.06); }
.rui-hovercard-host { display: inline-block; }
.rui-hovercard { z-index: 80; min-width: 240px; max-width: 320px; padding: 14px; background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,0.16); }
.rui-tour { position: fixed; inset: 0; z-index: 140; }
.rui-tour-dim { position: absolute; inset: 0; background: rgba(0,0,0,0.55); }
.rui-tour-spot { position: fixed; border-radius: 8px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.55); pointer-events: none; }
.rui-tour-pop { position: fixed; width: 300px; padding: 14px; background: var(--rui-menu-bg, #ffffff); border-radius: 10px; box-shadow: 0 10px 34px rgba(0,0,0,0.30); }
.rui-tour-title { margin: 0 0 6px; font-size: 15px; }
.rui-tour-body { font-size: 13.5px; color: var(--rui-fg-muted, #5b6270); }
.rui-tour-foot { display: flex; align-items: center; gap: 6px; margin-top: 14px; }
.rui-tour-counter { margin-right: auto; font-size: 12px; color: var(--rui-fg-muted, #8a909c); font-variant-numeric: tabular-nums; }
.rui-formsection { margin-bottom: 20px; }
.rui-formsection-title { margin: 0 0 2px; font-size: 15px; }
.rui-formsection-toggle { display: flex; align-items: center; gap: 6px; border: 0; background: none; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; padding: 0; }
.rui-formsection-desc { margin: 0 0 10px; font-size: 13px; color: var(--rui-fg-muted, #5b6270); }
.rui-formsection-body[hidden] { display: none; }
.rui-validation { padding: 12px 14px; border-radius: 9px; border-left: 3px solid #b42318; background: rgba(180,35,24,0.06); margin-bottom: 16px; }
.rui-validation-title { font-weight: 600; margin-bottom: 6px; }
.rui-validation-list { margin: 0; padding-left: 1.2em; }
.rui-validation-link { color: #b42318; }
.rui-monthpicker, .rui-yearpicker { display: inline-block; padding: 10px; }
.rui-monthpicker-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.rui-monthpicker-year { font-weight: 600; font-variant-numeric: tabular-nums; }
.rui-monthpicker-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.rui-monthpicker-month { padding: 8px 6px; border: 0; border-radius: 7px; background: none; font: inherit; cursor: pointer; }
.rui-monthpicker-month:hover:not(:disabled) { background: rgba(0,0,0,0.06); }
.rui-monthpicker-month.rui-selected { background: var(--rui-accent, #17457a); color: #ffffff; }
.rui-monthpicker-month:disabled { opacity: 0.3; cursor: not-allowed; }
.rui-datetime { display: inline-flex; flex-direction: column; gap: 10px; }
.rui-datetime-summary { font-size: 13px; color: var(--rui-fg-muted, #5b6270); font-variant-numeric: tabular-nums; }

/* Calendar / DatePicker / TimePicker */
.rui-calendar { display: inline-block; padding: 10px; }
.rui-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.rui-cal-nav { border: 0; background: none; font-size: 18px; cursor: pointer; padding: 2px 8px; border-radius: 6px; }
.rui-cal-nav:hover { background: rgba(0,0,0,0.06); }
.rui-cal-months { display: flex; gap: 20px; }
.rui-cal-title { text-align: center; font-weight: 600; margin-bottom: 6px; }
.rui-cal-grid { border-collapse: collapse; }
.rui-cal-weekday { padding: 4px; font-size: 11px; font-weight: 600; color: var(--rui-fg-muted, #5b6270); }
.rui-cal-cell { padding: 1px; }
.rui-cal-day { width: 32px; height: 32px; border: 0; border-radius: 7px; background: none; font: inherit; cursor: pointer; }
.rui-cal-day:hover:not(:disabled) { background: rgba(0,0,0,0.06); }
.rui-cal-day.rui-outside { opacity: 0.35; }
.rui-cal-day.rui-today { font-weight: 700; box-shadow: inset 0 0 0 1px var(--rui-accent, #17457a); }
.rui-cal-day.rui-in-range { background: var(--rui-menu-active, rgba(23,69,122,0.10)); border-radius: 0; }
.rui-cal-day.rui-selected { background: var(--rui-accent, #17457a); color: #ffffff; }
.rui-cal-day:disabled { opacity: 0.25; cursor: not-allowed; }
.rui-datepicker, .rui-daterange { position: relative; display: inline-block; }
.rui-datepicker-row { display: flex; align-items: stretch; gap: 4px; }
.rui-datepicker-toggle, .rui-daterange-trigger {
  border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px;
  background: #ffffff; font: inherit; padding: 0 10px; cursor: pointer;
}
.rui-datepicker-pop, .rui-daterange-pop {
  z-index: 60; background: var(--rui-menu-bg, #ffffff);
  border: 1px solid var(--rui-border, #d7dae0); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.14);
}
.rui-time { display: inline-flex; align-items: center; gap: 2px; padding: 4px 8px; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; background: #ffffff; }
.rui-time-seg { width: 26px; border: 0; padding: 2px; text-align: center; font: inherit; background: none; }
.rui-time-seg:focus { outline: 2px solid var(--rui-accent, #17457a); border-radius: 4px; }
.rui-time-sep { opacity: 0.5; }
.rui-time-ampm { margin-left: 6px; border: 0; background: rgba(0,0,0,0.06); border-radius: 5px; padding: 2px 6px; font: inherit; font-size: 12px; cursor: pointer; }

/* Navigare */
.rui-breadcrumbs-list, .rui-pagination-list { display: flex; align-items: center; gap: 4px; list-style: none; margin: 0; padding: 0; flex-wrap: wrap; }
.rui-breadcrumb { display: flex; align-items: center; gap: 4px; font-size: 14px; }
.rui-breadcrumb-sep, .rui-breadcrumb-ellipsis { color: var(--rui-fg-muted, #5b6270); }
.rui-breadcrumb-current { font-weight: 600; }
.rui-pagination { display: flex; align-items: center; gap: 4px; }
.rui-page, .rui-page-nav { min-width: 32px; height: 32px; border: 1px solid transparent; border-radius: 7px; background: none; font: inherit; cursor: pointer; }
.rui-page:hover, .rui-page-nav:hover:not(:disabled) { background: rgba(0,0,0,0.06); }
.rui-page.rui-active { background: var(--rui-accent, #17457a); color: #ffffff; font-weight: 600; }
.rui-page-nav:disabled { opacity: 0.35; cursor: not-allowed; }
.rui-page-ellipsis { display: inline-block; min-width: 24px; text-align: center; color: var(--rui-fg-muted, #5b6270); }
.rui-stepper-list { display: flex; gap: 8px; list-style: none; margin: 0; padding: 0; }
.rui-stepper.rui-vertical .rui-stepper-list { flex-direction: column; }
.rui-step { flex: 1; }
.rui-step-button { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; font: inherit; text-align: left; padding: 6px; border-radius: 8px; cursor: pointer; }
.rui-step-button:disabled { cursor: default; }
.rui-step-marker { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; background: rgba(0,0,0,0.10); font-size: 13px; font-weight: 600; flex: none; }
.rui-step.rui-done .rui-step-marker { background: #0f6e4f; color: #ffffff; }
.rui-step.rui-current .rui-step-marker { background: var(--rui-accent, #17457a); color: #ffffff; }
.rui-step.rui-error .rui-step-marker { background: #b42318; color: #ffffff; }
.rui-step-body { display: flex; flex-direction: column; }
.rui-step-desc { font-size: 12px; color: var(--rui-fg-muted, #5b6270); }
.rui-anchor-list { list-style: none; margin: 0; padding: 0; }
.rui-anchor-link { display: block; padding: 3px 10px; border-left: 2px solid transparent; color: var(--rui-fg-muted, #5b6270); text-decoration: none; font-size: 13px; }
.rui-anchor-link.rui-active { border-left-color: var(--rui-accent, #17457a); color: var(--rui-accent, #17457a); font-weight: 600; }
.rui-nav-list, .rui-nav-sublist { list-style: none; margin: 0; padding: 0; }
.rui-nav-group-title { padding: 10px 12px 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--rui-fg-muted, #5b6270); }
.rui-nav-link { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 7px; color: inherit; text-decoration: none; cursor: pointer; }
.rui-nav-link:hover { background: rgba(0,0,0,0.05); }
.rui-nav-link.rui-active { background: var(--rui-menu-active, rgba(23,69,122,0.10)); color: var(--rui-accent, #17457a); font-weight: 600; }
.rui-nav-link.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-nav-label { flex: 1; }
.rui-nav-badge { font-size: 11px; }
.rui-navbar { border-bottom: 1px solid var(--rui-border, #d7dae0); background: var(--rui-menu-bg, #ffffff); }
.rui-navbar.rui-sticky { position: sticky; top: 0; z-index: 40; }
.rui-navbar-inner { display: flex; align-items: center; gap: 16px; padding: 10px 16px; }
.rui-navbar-brand { font-weight: 700; }
.rui-navbar-links { display: flex; gap: 14px; flex: 1; }
.rui-navbar-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.rui-navbar-burger { border: 0; background: none; font-size: 18px; cursor: pointer; }
.rui-navbar-mobile { padding: 8px 16px 14px; border-top: 1px solid var(--rui-border, #d7dae0); }
.rui-navmenu-list { display: flex; gap: 4px; list-style: none; margin: 0; padding: 0; }
.rui-navmenu-item { position: relative; }
.rui-navmenu-trigger, .rui-navmenu-link { padding: 7px 10px; border: 0; background: none; font: inherit; border-radius: 7px; cursor: pointer; color: inherit; text-decoration: none; display: inline-block; }
.rui-navmenu-trigger:hover, .rui-navmenu-link:hover, .rui-navmenu-trigger.rui-open { background: rgba(0,0,0,0.05); }
.rui-navmenu-sub { position: absolute; top: 100%; left: 0; min-width: 190px; margin: 4px 0 0; padding: 4px; list-style: none; background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 50; }
.rui-navmenu-sublink { display: block; padding: 7px 10px; border-radius: 6px; color: inherit; text-decoration: none; }
.rui-navmenu-sublink:hover { background: rgba(0,0,0,0.05); }
.rui-shell { display: flex; flex-direction: column; min-height: 100vh; }
.rui-shell-body { display: flex; flex: 1; min-height: 0; }
.rui-shell-side { flex: 0 0 auto; border-right: 1px solid var(--rui-border, #d7dae0); }
.rui-shell-main { flex: 1; min-width: 0; overflow: auto; }
.rui-sidebar { transition: width 160ms ease; overflow: hidden; }
.rui-sidebar.rui-overlay { position: fixed; top: 0; bottom: 0; z-index: 70; background: var(--rui-menu-bg, #ffffff); box-shadow: 0 0 24px rgba(0,0,0,0.18); }
.rui-sidebar.rui-side-left.rui-overlay { left: 0; }
.rui-sidebar.rui-side-right.rui-overlay { right: 0; }
.rui-sidebar.rui-overlay.rui-closed { transform: translateX(-100%); }
.rui-sidebar.rui-side-right.rui-overlay.rui-closed { transform: translateX(100%); }

/* TreeView / ListView */
.rui-tree, .rui-tree-group { list-style: none; margin: 0; padding: 0; }
.rui-tree-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
.rui-tree-row:hover { background: rgba(0,0,0,0.05); }
.rui-tree-row.rui-selected { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-tree-row.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-tree-toggle { width: 14px; font-size: 10px; opacity: 0.6; }
.rui-tree-label { flex: 1; }
.rui-listview { border: 1px solid var(--rui-border, #d7dae0); border-radius: 9px; overflow: hidden; }
.rui-listview-group-title { padding: 6px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--rui-fg-muted, #5b6270); background: rgba(0,0,0,0.03); }
.rui-listview-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--rui-border, #d7dae0); cursor: pointer; }
.rui-listview-row:hover { background: rgba(0,0,0,0.03); }
.rui-listview-row.rui-selected { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-listview-row.rui-focused { outline: 2px solid var(--rui-accent, #17457a); outline-offset: -2px; }
.rui-listview-content { flex: 1; min-width: 0; }
.rui-listview-empty { padding: 22px; text-align: center; color: var(--rui-fg-muted, #5b6270); }

/* MultiSelect / Autocomplete / CommandPalette */
.rui-multiselect { position: relative; display: block; }
.rui-multiselect-control { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; padding: 5px 8px; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; background: #ffffff; cursor: text; }
.rui-multiselect-input { flex: 1; min-width: 80px; border: 0; padding: 3px 0; font: inherit; outline: none; background: none; }
.rui-multiselect-list, .rui-autocomplete-list {
  margin: 0; padding: 4px; list-style: none; max-height: 260px; overflow: auto;
  background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 50; min-width: 180px;
}
.rui-multiselect-option, .rui-autocomplete-option { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.rui-multiselect-option.rui-active, .rui-autocomplete-option.rui-active { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-multiselect-option.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-multiselect-check { width: 12px; color: var(--rui-accent, #17457a); }
.rui-multiselect-empty, .rui-cmd-empty { padding: 12px; color: var(--rui-fg-muted, #8a909c); }
.rui-autocomplete { position: relative; display: block; }
.rui-cmd-backdrop { position: fixed; inset: 0; z-index: 110; display: flex; align-items: flex-start; justify-content: center; padding: 14vh 16px 16px; background: rgba(0,0,0,0.40); }
.rui-cmd { width: 100%; max-width: 560px; background: var(--rui-menu-bg, #ffffff); border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.32); overflow: hidden; }
.rui-cmd-input { width: 100%; padding: 14px 16px; border: 0; border-bottom: 1px solid var(--rui-border, #d7dae0); font: inherit; font-size: 16px; outline: none; }
.rui-cmd-list { max-height: 50vh; overflow: auto; padding: 6px; }
.rui-cmd-group-title { padding: 6px 10px 2px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--rui-fg-muted, #5b6270); }
.rui-cmd-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 7px; cursor: pointer; }
.rui-cmd-item.rui-active { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-cmd-label { flex: 1; }
.rui-cmd-hint { font-size: 12px; color: var(--rui-fg-muted, #8a909c); }

/* Fișiere */
.rui-dropzone { padding: 26px; border: 2px dashed var(--rui-border, #d7dae0); border-radius: 10px; text-align: center; cursor: pointer; }
.rui-dropzone.rui-over { border-color: var(--rui-accent, #17457a); background: var(--rui-menu-active, rgba(23,69,122,0.06)); }
.rui-dropzone.rui-disabled { opacity: 0.5; cursor: not-allowed; }
.rui-dropzone-hint { margin-top: 6px; font-size: 12px; color: var(--rui-fg-muted, #5b6270); }
.rui-dropzone-errors { margin: 10px 0 0; padding-left: 1.2em; text-align: left; color: #b42318; font-size: 13px; }
.rui-filelist { list-style: none; margin: 0; padding: 0; }
.rui-filelist-item { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-filelist-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rui-filelist-size { font-size: 12px; color: var(--rui-fg-muted, #5b6270); font-variant-numeric: tabular-nums; }
.rui-filelist-progress { display: block; width: 70px; height: 4px; border-radius: 999px; background: rgba(0,0,0,0.10); overflow: hidden; }
.rui-filelist-bar { display: block; height: 100%; background: var(--rui-accent, #17457a); }
.rui-filelist-remove { border: 0; background: none; cursor: pointer; opacity: 0.55; }
.rui-filelist-empty { padding: 16px; text-align: center; color: var(--rui-fg-muted, #5b6270); }

/* Drawer / ContextMenu / Notification / Backdrop */
.rui-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.45); }
.rui-backdrop.rui-blur { backdrop-filter: blur(3px); }
.rui-drawer-backdrop { position: fixed; inset: 0; z-index: 100; display: flex; background: rgba(0,0,0,0.45); }
.rui-drawer { display: flex; flex-direction: column; background: var(--rui-menu-bg, #ffffff); box-shadow: 0 0 40px rgba(0,0,0,0.28); max-height: 100%; }
.rui-drawer-right { margin-left: auto; height: 100%; }
.rui-drawer-left { margin-right: auto; height: 100%; }
.rui-drawer-top { width: 100%; margin-bottom: auto; }
.rui-drawer-bottom { width: 100%; margin-top: auto; }
.rui-drawer-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-drawer-title { margin: 0; font-size: 16px; flex: 1; }
.rui-drawer-close { border: 0; background: none; cursor: pointer; font-size: 15px; }
.rui-drawer-body { flex: 1; overflow: auto; padding: 14px 16px; }
.rui-drawer-foot { padding: 12px 16px; border-top: 1px solid var(--rui-border, #d7dae0); }
.rui-ctx-host { display: contents; }
.rui-ctx-menu { margin: 0; padding: 4px; list-style: none; min-width: 180px; z-index: 120; background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.16); }
.rui-ctx-item { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.rui-ctx-item.rui-active { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-ctx-item.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-ctx-hint { font-size: 12px; color: var(--rui-fg-muted, #8a909c); }
.rui-ctx-sep { height: 1px; margin: 4px 6px; background: var(--rui-border, #d7dae0); }
.rui-notification { display: flex; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-notification.rui-unread { background: var(--rui-menu-active, rgba(23,69,122,0.06)); }
.rui-notification-dot { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--rui-accent, #17457a); flex: none; }
.rui-notification-body { flex: 1; }
.rui-notification-title { margin: 0 0 2px; font-size: 14px; }
.rui-notification-time { margin-top: 4px; font-size: 12px; color: var(--rui-fg-muted, #5b6270); }
.rui-notification-actions { margin-top: 8px; display: flex; gap: 8px; }
.rui-notification-close { border: 0; background: none; cursor: pointer; opacity: 0.5; align-self: flex-start; }

/* Grafice */
.rui-chart { margin: 0; }
.rui-chart-svg { display: block; max-width: 100%; }
.rui-grid-line { stroke: var(--rui-border, #d7dae0); stroke-width: 1; }
.rui-tick-label { font-size: 11px; fill: var(--rui-fg-muted, #5b6270); }
.rui-legend { display: flex; flex-wrap: wrap; gap: 12px; list-style: none; margin: 6px 0 0; padding: 0; font-size: 12px; }
.rui-legend-item { display: flex; align-items: center; gap: 5px; }
.rui-legend-swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.rui-bar { transition: y 120ms ease, height 120ms ease; }
@media (prefers-reduced-motion: reduce) {
  .rui-bar, .rui-sidebar, .rui-switch-thumb { transition: none; }
}

/* Typography */
.rui-text, .rui-heading { margin: 0; }
.rui-t-xs { font-size: 12px; } .rui-t-sm { font-size: 13px; } .rui-t-md { font-size: 15px; }
.rui-t-lg { font-size: 18px; } .rui-t-xl { font-size: 22px; }
.rui-t-2xl { font-size: 28px; } .rui-t-3xl { font-size: 36px; }
.rui-w-normal { font-weight: 400; } .rui-w-medium { font-weight: 500; }
.rui-w-semibold { font-weight: 600; } .rui-w-bold { font-weight: 700; }
.rui-align-left { text-align: left; } .rui-align-center { text-align: center; } .rui-align-right { text-align: right; }
.rui-tabular { font-variant-numeric: tabular-nums; }
.rui-tone-muted { color: var(--rui-fg-muted, #5b6270); }
.rui-tone-accent { color: var(--rui-accent, #17457a); }
.rui-tone-success { color: #0f6e4f; }
.rui-tone-warning { color: #b45309; }
.rui-tone-danger { color: #b42318; }
.rui-truncate { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.rui-clamp { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
.rui-link { color: var(--rui-accent, #17457a); text-decoration: none; cursor: pointer; }
.rui-link:hover { text-decoration: underline; }
.rui-link-external { font-size: 0.85em; opacity: 0.7; }
.rui-code { padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.06); font-family: ui-monospace, monospace; font-size: 0.9em; }
.rui-kbd { padding: 1px 6px; border-radius: 4px; border: 1px solid var(--rui-border, #d7dae0); border-bottom-width: 2px; background: #ffffff; font-family: ui-monospace, monospace; font-size: 0.85em; }
.rui-codeblock { border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; overflow: hidden; }
.rui-codeblock-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--rui-border, #d7dae0); font-size: 12px; }
.rui-codeblock-file { color: var(--rui-fg-muted, #5b6270); font-family: ui-monospace, monospace; }
.rui-codeblock-copy { border: 0; background: none; font: inherit; font-size: 12px; cursor: pointer; color: var(--rui-accent, #17457a); }
.rui-codeblock-pre { margin: 0; padding: 12px; overflow: auto; font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.55; }
.rui-list { margin: 0; padding-left: 1.3em; line-height: 1.7; }
.rui-list-unstyled { list-style: none; padding-left: 0; }
.rui-quote { margin: 0; padding-left: 14px; border-left: 3px solid var(--rui-border, #d7dae0); }
.rui-quote-body { margin: 0; }
.rui-quote-cite { margin-top: 4px; font-size: 13px; color: var(--rui-fg-muted, #5b6270); }
.rui-mark { background: #fde68a; color: inherit; border-radius: 2px; }

/* Layout */
.rui-divider { border: 0; border-top: 1px solid var(--rui-border, #d7dae0); }
.rui-divider.rui-vertical { border-top: 0; border-left: 1px solid var(--rui-border, #d7dae0); align-self: stretch; }
.rui-divider-label { display: flex; align-items: center; gap: 10px; border: 0; }
.rui-divider-line { flex: 1; height: 1px; background: var(--rui-border, #d7dae0); }
.rui-divider-text { font-size: 13px; color: var(--rui-fg-muted, #5b6270); }
.rui-aspect { display: block; overflow: hidden; }
.rui-aspect > * { width: 100%; height: 100%; object-fit: cover; }
.rui-scroll { scrollbar-width: thin; }

/* Card */
.rui-card { border: 1px solid var(--rui-border, #d7dae0); border-radius: 10px; background: var(--rui-menu-bg, #ffffff); }
.rui-card-interactive { cursor: pointer; }
.rui-card-interactive:hover { border-color: var(--rui-accent, #17457a); }
.rui-card-interactive:focus-visible { outline: 2px solid var(--rui-accent, #17457a); outline-offset: 2px; }
.rui-card-padded > .rui-card-head { padding: 14px 16px 0; }
.rui-card-padded > .rui-card-body { padding: 14px 16px; }
.rui-card-padded > .rui-card-foot { padding: 0 16px 14px; }
.rui-card-title { margin: 0; font-size: 16px; }

/* Badge, Tag */
.rui-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; font-size: 12px; font-weight: 600; background: rgba(0,0,0,0.08); }
.rui-badge.rui-tone-accent { background: var(--rui-accent, #17457a); color: #ffffff; }
.rui-badge.rui-tone-success { background: #0f6e4f; color: #ffffff; }
.rui-badge.rui-tone-warning { background: #b45309; color: #ffffff; }
.rui-badge.rui-tone-danger { background: #b42318; color: #ffffff; }
.rui-badge-dot { min-width: 8px; width: 8px; height: 8px; padding: 0; }
.rui-hidden { display: none; }
.rui-tag { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 6px; background: rgba(0,0,0,0.06); font-size: 13px; }
.rui-tag-sm { padding: 1px 6px; font-size: 12px; }
.rui-tag-remove { border: 0; background: none; padding: 0; cursor: pointer; opacity: 0.6; font-size: 11px; }
.rui-tag-remove:hover { opacity: 1; }

/* Avatar */
.rui-avatar { display: inline-flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 50%; background: rgba(0,0,0,0.10); font-weight: 600; flex: none; }
.rui-avatar-square { border-radius: 8px; }
.rui-avatar-xs { width: 22px; height: 22px; font-size: 10px; }
.rui-avatar-sm { width: 28px; height: 28px; font-size: 11px; }
.rui-avatar-md { width: 36px; height: 36px; font-size: 13px; }
.rui-avatar-lg { width: 48px; height: 48px; font-size: 16px; }
.rui-avatar-xl { width: 64px; height: 64px; font-size: 20px; }
.rui-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.rui-avatar-group { display: inline-flex; }
.rui-avatar-group > .rui-avatar { margin-left: -8px; border: 2px solid var(--rui-menu-bg, #ffffff); }
.rui-avatar-group > .rui-avatar:first-child { margin-left: 0; }

/* Stat */
.rui-stat-label { font-size: 13px; color: var(--rui-fg-muted, #5b6270); }
.rui-stat-value { font-size: 28px; font-weight: 700; line-height: 1.2; }
.rui-stat-delta { font-size: 13px; font-weight: 600; }
.rui-stat-hint { font-size: 12px; color: var(--rui-fg-muted, #5b6270); }

/* DescriptionList */
.rui-dl { margin: 0; }
.rui-dt { font-size: 13px; color: var(--rui-fg-muted, #5b6270); }
.rui-dd { margin: 0 0 10px; }
.rui-dl-inline { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; }
.rui-dl-inline .rui-dd { margin: 0; }

/* Alert, Callout, Banner */
.rui-alert, .rui-callout { display: flex; gap: 10px; padding: 10px 12px; border-radius: 9px; border-left: 3px solid currentColor; background: rgba(0,0,0,0.03); }
.rui-alert-body, .rui-callout-body { flex: 1; }
.rui-alert-title, .rui-callout-title { font-weight: 600; margin-bottom: 2px; }
.rui-alert-close { border: 0; background: none; cursor: pointer; opacity: 0.5; }
.rui-banner { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--rui-accent, #17457a); color: #ffffff; }
.rui-banner-body { flex: 1; }
.rui-banner-close { border: 0; background: none; color: inherit; cursor: pointer; }

/* Empty, Result */
.rui-empty-state, .rui-result { padding: 32px 20px; text-align: center; }
.rui-empty-icon, .rui-result-icon { font-size: 32px; opacity: 0.4; margin-bottom: 8px; }
.rui-empty-title, .rui-result-title { font-size: 17px; font-weight: 600; margin: 0 0 4px; }
.rui-empty-desc, .rui-result-desc { color: var(--rui-fg-muted, #5b6270); margin: 0 0 14px; }

/* Spinner, Skeleton, LoadingOverlay */
.rui-spinner { display: inline-flex; }
.rui-spinner-circle { display: block; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: rui-spin 700ms linear infinite; }
.rui-spinner-sm .rui-spinner-circle { width: 12px; height: 12px; }
.rui-spinner-md .rui-spinner-circle { width: 18px; height: 18px; }
.rui-spinner-lg .rui-spinner-circle { width: 28px; height: 28px; }
.rui-skeleton { display: block; border-radius: 6px; background: linear-gradient(90deg, rgba(0,0,0,0.07), rgba(0,0,0,0.12), rgba(0,0,0,0.07)); background-size: 200% 100%; animation: rui-shimmer 1.3s ease-in-out infinite; }
.rui-skeleton-text { height: 0.85em; margin: 0.25em 0; }
.rui-skeleton-circle { border-radius: 50%; }
.rui-skeleton-lines { display: block; }
@keyframes rui-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) {
  .rui-skeleton, .rui-spinner-circle, .rui-progress-fill.rui-indeterminate { animation: none; }
}
.rui-loading-host { position: relative; }
.rui-loading-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.65); }

/* Timeline */
.rui-timeline { list-style: none; margin: 0; padding: 0; }
.rui-timeline-item { display: flex; gap: 12px; padding-bottom: 16px; position: relative; }
.rui-timeline-item:not(:last-child)::before { content: ""; position: absolute; left: 5px; top: 16px; bottom: 0; width: 2px; background: var(--rui-border, #d7dae0); }
.rui-timeline-marker { width: 12px; height: 12px; margin-top: 4px; border-radius: 50%; background: currentColor; flex: none; z-index: 1; }
.rui-timeline-title { font-weight: 600; }
.rui-timeline-time { font-size: 12px; color: var(--rui-fg-muted, #5b6270); }

/* Image */
.rui-image { display: inline-block; position: relative; overflow: hidden; }
.rui-image-img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* Collapsible, Accordion */
.rui-collapsible-trigger, .rui-accordion-trigger { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 0; border: 0; background: none; font: inherit; text-align: left; cursor: pointer; }
.rui-collapsible-icon, .rui-accordion-icon { font-size: 11px; opacity: 0.6; }
.rui-collapsible-panel[hidden], .rui-accordion-panel[hidden] { display: none; }
.rui-accordion-item { border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-accordion-heading { margin: 0; font-size: inherit; font-weight: inherit; }
.rui-accordion-title { font-weight: 600; }
.rui-accordion-panel { padding-bottom: 12px; }

/* NumberInput */
.rui-number { display: inline-flex; align-items: stretch; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; overflow: hidden; background: #ffffff; }
.rui-number-input { width: 70px; padding: 6px 8px; border: 0; font: inherit; text-align: center; }
.rui-number-input:focus { outline: 2px solid var(--rui-accent, #17457a); outline-offset: -2px; }
.rui-number-step { width: 30px; border: 0; background: rgba(0,0,0,0.04); font: inherit; cursor: pointer; }
.rui-number-step:disabled { opacity: 0.35; cursor: not-allowed; }
.rui-number-suffix { display: flex; align-items: center; padding-right: 8px; font-size: 13px; color: var(--rui-fg-muted, #5b6270); }

/* PasswordInput */
.rui-password-row { display: flex; align-items: center; gap: 6px; }
.rui-password-toggle { border: 0; background: none; cursor: pointer; font-size: 15px; }
.rui-password-strength { height: 4px; margin-top: 5px; border-radius: 999px; background: rgba(0,0,0,0.08); overflow: hidden; }
.rui-password-bar { height: 100%; transition: width 160ms ease; }
.rui-password-bar.rui-level-1 { background: #b42318; }
.rui-password-bar.rui-level-2 { background: #b45309; }
.rui-password-bar.rui-level-3 { background: #0f6e4f; }
.rui-password-bar.rui-level-4 { background: #0f6e4f; }

/* SearchInput */
.rui-search { display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; background: #ffffff; }
.rui-search-icon { opacity: 0.5; }
.rui-search-input { flex: 1; padding: 8px 0; border: 0; font: inherit; background: none; outline: none; }
.rui-search-clear { border: 0; background: none; cursor: pointer; opacity: 0.5; }

/* PinInput */
.rui-pin { display: inline-flex; gap: 8px; }
.rui-pin-box { width: 40px; height: 46px; text-align: center; font-size: 18px; font-family: ui-monospace, monospace; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; }
.rui-pin-box:focus { outline: 2px solid var(--rui-accent, #17457a); outline-offset: -1px; }

/* TagsInput */
.rui-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; background: #ffffff; }
.rui-tags-input { flex: 1; min-width: 100px; border: 0; padding: 3px 0; font: inherit; outline: none; background: none; }

/* Editable */
.rui-editable-preview { border: 0; background: none; font: inherit; padding: 2px 4px; border-radius: 4px; cursor: text; text-align: left; }
.rui-editable-preview:hover { background: rgba(0,0,0,0.05); }
.rui-editable-input { font: inherit; padding: 2px 4px; border: 1px solid var(--rui-accent, #17457a); border-radius: 4px; }

/* CheckboxGroup, SegmentedControl, Toggle */
.rui-checkbox-group { display: flex; gap: 8px; }
.rui-checkbox-group.rui-vertical { flex-direction: column; }
.rui-checkbox-all { font-weight: 600; }
.rui-segmented { display: inline-flex; padding: 2px; border-radius: 8px; background: rgba(0,0,0,0.06); }
.rui-segment { padding: 5px 12px; border: 0; border-radius: 6px; background: none; font: inherit; cursor: pointer; color: var(--rui-fg-muted, #5b6270); }
.rui-segment.rui-active { background: var(--rui-menu-bg, #ffffff); color: inherit; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
.rui-segmented-sm .rui-segment { padding: 3px 9px; font-size: 13px; }
.rui-segment:disabled { opacity: 0.45; cursor: not-allowed; }
.rui-toggle.rui-pressed, .rui-toggle-group .rui-pressed { background: var(--rui-menu-active, rgba(23,69,122,0.10)); border-color: var(--rui-accent, #17457a); }

/* Diverse */
.rui-close { border: 0; background: none; cursor: pointer; opacity: 0.55; line-height: 1; }
.rui-close:hover { opacity: 1; }
.rui-close-sm { font-size: 11px; }
.rui-input-group { display: flex; align-items: stretch; }
.rui-input-group > .rui-input-control { border-radius: 0; }
.rui-input-group > :first-child { border-top-left-radius: 8px; border-bottom-left-radius: 8px; }
.rui-input-group > :last-child { border-top-right-radius: 8px; border-bottom-right-radius: 8px; }
.rui-input-addon { display: flex; align-items: center; padding: 0 10px; border: 1px solid var(--rui-border, #d7dae0); background: rgba(0,0,0,0.04); font-size: 13px; color: var(--rui-fg-muted, #5b6270); }
.rui-fieldset { border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; padding: 12px 14px; margin: 0; }
.rui-legend { padding: 0 6px; font-size: 13px; font-weight: 600; }
.rui-native-select { padding: 8px 10px; font: inherit; border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; background: #ffffff; }

/* Button */
.rui-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid transparent; border-radius: 8px; font: inherit; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.rui-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rui-btn-sm { height: 30px; padding: 0 10px; font-size: 13px; }
.rui-btn-md { height: 36px; padding: 0 14px; }
.rui-btn-lg { height: 44px; padding: 0 20px; font-size: 16px; }
.rui-btn-block { width: 100%; }
.rui-btn-primary { background: var(--rui-accent, #17457a); color: #ffffff; }
.rui-btn-secondary { background: transparent; border-color: var(--rui-border, #d7dae0); }
.rui-btn-ghost { background: transparent; }
.rui-btn-ghost:hover, .rui-btn-secondary:hover { background: rgba(0,0,0,0.04); }
.rui-btn-danger { background: #b42318; color: #ffffff; }
.rui-btn-icon { padding: 0; width: 36px; }
.rui-btn-spinner {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid currentColor; border-top-color: transparent;
  animation: rui-spin 700ms linear infinite;
}
.rui-btn-group { display: inline-flex; }
.rui-btn-group > .rui-btn { border-radius: 0; margin-left: -1px; }
.rui-btn-group > .rui-btn:first-child { border-radius: 8px 0 0 8px; margin-left: 0; }
.rui-btn-group > .rui-btn:last-child { border-radius: 0 8px 8px 0; }

/* Controale de formular */
.rui-input { display: flex; align-items: center; gap: 6px; }
.rui-input-control, .rui-textarea {
  width: 100%; padding: 8px 10px; font: inherit;
  border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; background: #ffffff;
}
.rui-input-control[aria-invalid="true"], .rui-textarea[aria-invalid="true"] { border-color: #b42318; }
.rui-textarea { resize: vertical; }
.rui-checkbox, .rui-radio { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.rui-radio.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-radio-group { display: flex; gap: 10px; }
.rui-radio-group.rui-vertical { flex-direction: column; }
.rui-switch { display: inline-flex; align-items: center; gap: 8px; }
.rui-switch-control {
  position: relative; width: 38px; height: 22px; padding: 0; flex: none;
  border: 1px solid var(--rui-border, #d7dae0); border-radius: 999px;
  background: rgba(0,0,0,0.10); cursor: pointer;
}
.rui-switch-control.rui-on { background: var(--rui-accent, #17457a); border-color: transparent; }
.rui-switch-thumb {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #ffffff; transition: left 120ms ease;
}
.rui-switch-control.rui-on .rui-switch-thumb { left: 18px; }
.rui-switch-label { cursor: pointer; }

/* Form */
.rui-field { margin-bottom: 14px; }
.rui-label { display: block; margin-bottom: 4px; font-size: 13px; font-weight: 600; }
.rui-required { color: #b42318; }
.rui-hint { margin-top: 3px; font-size: 12px; color: var(--rui-fg-muted, #5b6270); }
.rui-error { min-height: 16px; margin-top: 3px; font-size: 12px; color: #b42318; }

/* Select */
.rui-select { position: relative; display: inline-block; }
.rui-select-trigger {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-width: 160px; height: 36px; padding: 0 10px; font: inherit;
  border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; background: #ffffff; cursor: pointer;
}
.rui-select-placeholder { color: var(--rui-fg-muted, #8a909c); }
.rui-select-arrow { font-size: 11px; opacity: 0.6; }
.rui-select-list {
  margin: 0; padding: 4px; list-style: none; max-height: 260px; overflow: auto;
  background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 50; min-width: 160px;
}
.rui-select-option { padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.rui-select-option.rui-active { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-select-option.rui-selected { font-weight: 600; }
.rui-select-option.rui-disabled { opacity: 0.45; cursor: not-allowed; }

/* Dialog */
.rui-dialog-backdrop {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(0,0,0,0.45);
}
.rui-dialog {
  display: flex; flex-direction: column; max-height: 90vh; width: 100%;
  background: var(--rui-menu-bg, #ffffff); border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.30);
}
.rui-dialog-sm { max-width: 380px; }
.rui-dialog-md { max-width: 560px; }
.rui-dialog-lg { max-width: 820px; }
.rui-dialog-full { max-width: none; height: 100%; }
.rui-dialog-head { display: flex; align-items: center; gap: 12px; padding: 16px 18px 0; }
.rui-dialog-title { margin: 0; font-size: 18px; flex: 1; }
.rui-dialog-close { margin-left: auto; border: 0; background: none; font-size: 16px; cursor: pointer; }
.rui-dialog-body { padding: 14px 18px; overflow: auto; }
.rui-dialog-foot { padding: 0 18px 16px; }
.rui-confirm-message { margin: 0; }
.rui-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* Popover + Tooltip */
.rui-popover-root, .rui-tooltip-root { display: inline-block; }
.rui-popover {
  z-index: 60; padding: 12px; min-width: 200px;
  background: var(--rui-menu-bg, #ffffff); border: 1px solid var(--rui-border, #d7dae0);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.rui-tooltip {
  z-index: 70; padding: 5px 8px; max-width: 260px; font-size: 12px;
  background: #15181d; color: #ffffff; border-radius: 6px; pointer-events: none;
}

/* Toast */
.rui-toaster { position: fixed; z-index: 90; display: flex; flex-direction: column; gap: 8px; padding: 16px; }
.rui-toaster-top-right { top: 0; right: 0; }
.rui-toaster-top-left { top: 0; left: 0; }
.rui-toaster-bottom-right { bottom: 0; right: 0; }
.rui-toaster-bottom-left { bottom: 0; left: 0; }
.rui-toaster-top-center { top: 0; left: 50%; transform: translateX(-50%); }
.rui-toaster-bottom-center { bottom: 0; left: 50%; transform: translateX(-50%); }
.rui-toast {
  display: flex; align-items: flex-start; gap: 10px; min-width: 260px; max-width: 380px;
  padding: 10px 12px; border-radius: 9px; border-left: 3px solid var(--rui-accent, #17457a);
  background: var(--rui-menu-bg, #ffffff); box-shadow: 0 8px 24px rgba(0,0,0,0.16);
}
.rui-toast-success { border-left-color: #0f6e4f; }
.rui-toast-warning { border-left-color: #b45309; }
.rui-toast-error { border-left-color: #b42318; }
.rui-toast-body { flex: 1; }
.rui-toast-title { font-weight: 600; margin-bottom: 2px; }
.rui-toast-message { font-size: 14px; }
.rui-toast-action { border: 0; background: none; font: inherit; font-weight: 600; color: var(--rui-accent, #17457a); cursor: pointer; }
.rui-toast-close { border: 0; background: none; cursor: pointer; opacity: 0.5; }
.rui-toast-close:hover { opacity: 1; }

/* Tabs */
.rui-tabs.rui-vertical { display: flex; gap: 16px; }
.rui-tablist { display: flex; gap: 2px; border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-tabs.rui-vertical .rui-tablist { flex-direction: column; border-bottom: 0; border-right: 1px solid var(--rui-border, #d7dae0); }
.rui-tab {
  padding: 8px 14px; border: 0; background: none; font: inherit; cursor: pointer;
  color: var(--rui-fg-muted, #5b6270); border-bottom: 2px solid transparent;
}
.rui-tab.rui-active { color: var(--rui-accent, #17457a); border-bottom-color: var(--rui-accent, #17457a); font-weight: 600; }
.rui-tab.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-tabpanel { padding: 14px 0; }
.rui-tabpanel[hidden] { display: none; }

/* Progress */
.rui-progress { display: flex; align-items: center; gap: 8px; }
.rui-progress-track { flex: 1; height: 6px; border-radius: 999px; background: rgba(0,0,0,0.08); overflow: hidden; }
.rui-progress-fill { height: 100%; background: var(--rui-accent, #17457a); transition: width 80ms linear; }
.rui-progress-fill.rui-indeterminate { width: 35%; animation: rui-indet 1.1s ease-in-out infinite; }
.rui-progress-caption { font-size: 12px; color: var(--rui-fg-muted, #5b6270); font-variant-numeric: tabular-nums; }
@keyframes rui-indet { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
.rui-circular-track { stroke: rgba(0,0,0,0.10); }
.rui-circular-fill { stroke: var(--rui-accent, #17457a); transition: stroke-dashoffset 80ms linear; }
.rui-circular.rui-indeterminate { animation: rui-spin 900ms linear infinite; }
@keyframes rui-spin { to { transform: rotate(360deg); } }

/* Slider */
.rui-slider { position: relative; height: 20px; display: flex; align-items: center; touch-action: none; }
.rui-slider.rui-vertical { height: 160px; width: 20px; }
.rui-slider-track { position: relative; flex: 1; height: 4px; border-radius: 999px; background: rgba(0,0,0,0.12); }
.rui-slider.rui-vertical .rui-slider-track { width: 4px; height: 100%; flex: none; }
.rui-slider-range { position: absolute; left: 0; top: 0; height: 100%; border-radius: 999px; background: var(--rui-accent, #17457a); }
.rui-slider.rui-vertical .rui-slider-range { width: 100%; bottom: 0; top: auto; }
.rui-slider-thumb {
  position: absolute; width: 14px; height: 14px; margin-left: -7px;
  border-radius: 50%; background: #fff; border: 2px solid var(--rui-accent, #17457a);
  cursor: grab; touch-action: none;
}
.rui-slider-thumb:focus-visible { outline: 2px solid var(--rui-accent, #17457a); outline-offset: 2px; }
.rui-slider-thumb.rui-dragging { cursor: grabbing; transform: scale(1.15); }
.rui-slider.rui-disabled { opacity: 0.45; pointer-events: none; }

/* Sparkline */
.rui-sparkline { display: inline-block; line-height: 0; }
.rui-sparkline-line { stroke: var(--rui-accent, #17457a); }
.rui-sparkline-area { fill: color-mix(in srgb, var(--rui-accent, #17457a) 15%, transparent); }
.rui-sparkline-point { fill: var(--rui-accent, #17457a); }

/* SplitPane */
.rui-split { display: flex; width: 100%; height: 100%; }
.rui-split-v { flex-direction: column; }
.rui-split-first { flex: 0 0 auto; overflow: auto; min-width: 0; min-height: 0; }
.rui-split-second { flex: 1 1 auto; overflow: auto; min-width: 0; min-height: 0; }
.rui-split.rui-resizing { user-select: none; cursor: col-resize; }
.rui-split.rui-collapsed > .rui-split-first { overflow: hidden; }

/* Combobox */
.rui-combobox { position: relative; display: inline-block; }
.rui-combobox-input { width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--rui-border, #d7dae0); }
.rui-combobox-list {
  margin: 0; padding: 4px; list-style: none; max-height: 260px; overflow: auto;
  background: var(--rui-menu-bg, #fff); border: 1px solid var(--rui-border, #d7dae0);
  border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 50; min-width: 180px;
}
.rui-combobox-option { padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.rui-combobox-option.rui-active { background: var(--rui-menu-active, rgba(23,69,122,0.10)); }
.rui-combobox-option.rui-selected { font-weight: 600; }
.rui-combobox-option.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-combobox-empty { padding: 10px; color: var(--rui-fg-muted, #8a909c); }

/* DataGrid */
.rui-grid { border: 1px solid var(--rui-border, #d7dae0); border-radius: 8px; overflow: hidden; }
.rui-grid-head { position: sticky; top: 0; z-index: 2; background: var(--rui-menu-bg, #fff); border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-grid-th { position: relative; padding: 8px 10px; font-weight: 600; color: var(--rui-fg-muted, #5b6270); user-select: none; white-space: nowrap; overflow: hidden; }
.rui-grid-th.rui-sortable { cursor: pointer; }
.rui-grid-col-resize { position: absolute; top: 0; right: 0; width: 6px; height: 100%; cursor: col-resize; touch-action: none; }
.rui-grid-col-resize:hover { background: rgba(23,69,122,0.25); }
.rui-grid-row { align-items: center; border-bottom: 1px solid var(--rui-border, #d7dae0); }
.rui-grid-row:hover { background: var(--rui-bg-alt, rgba(0,0,0,0.02)); }
.rui-grid-row.rui-selected { background: color-mix(in srgb, var(--rui-accent, #17457a) 12%, transparent); }
.rui-grid-td { padding: 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rui-grid-empty { padding: 24px; text-align: center; color: var(--rui-fg-muted, #5b6270); }

/* VisuallyHidden: ascuns vizual, dar PREZENT in arborele de accesibilitate.
   "display:none" l-ar scoate si de acolo, deci nu se foloseste. */
.rui-sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.rui-sr-focusable:focus-within {
  position: static;
  width: auto; height: auto;
  margin: 0; overflow: visible;
  clip: auto; clip-path: none;
  white-space: normal;
}

/* Tranzitii: clasele puse de transitionClass().  */
.rui-enter { opacity: 1; }
.rui-exit { opacity: 0; }

/* Maner de resize. */
.rui-resize-handle {
  flex: 0 0 auto;
  background: transparent;
  touch-action: none;
  user-select: none;
}
.rui-resize-handle[aria-orientation="vertical"] { cursor: col-resize; width: 6px; }
.rui-resize-handle[aria-orientation="horizontal"] { cursor: row-resize; height: 6px; }
.rui-resize-handle:hover, .rui-resize-handle:focus-visible { background: rgba(23,69,122,0.25); }

/* Element tras / tinta de drop. */
.rui-dragging { opacity: 0.55; }
.rui-drop-over { outline: 2px dashed currentColor; outline-offset: 2px; }

.rui-menu-root {
  --rui-menu-bg: #ffffff;
  --rui-menu-border: #d7dae0;
  --rui-menu-active: rgba(23,69,122,0.10);
  --rui-menu-fg-muted: #8a909c;
  position: relative;
  display: inline-block;
}
.rui-menu {
  position: absolute;
  top: calc(100% + 4px);
  min-width: 180px;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--rui-menu-bg);
  border: 1px solid var(--rui-menu-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  z-index: 50;
}
.rui-menu-start { left: 0; }
.rui-menu-end { right: 0; }
.rui-menu-item {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.rui-menu-item.rui-active { background: var(--rui-menu-active); }
.rui-menu-item.rui-disabled { opacity: 0.45; cursor: not-allowed; }
.rui-menu-hint { color: var(--rui-menu-fg-muted); font-size: 12px; }
.rui-menu-sep { height: 1px; margin: 4px 6px; background: var(--rui-menu-border); }

@media (prefers-color-scheme: dark) {
  .rui-table { --rui-border: #2a2f3a; --rui-bg-alt: rgba(255,255,255,0.04); --rui-fg-muted: #9aa2b1; --rui-accent: #6ea8ff; }
  .rui-menu-root { --rui-menu-bg: #161a21; --rui-menu-border: #2a2f3a; --rui-menu-active: rgba(110,168,255,0.16); }
}
`;

/** Injecteaza CSS-ul o singura data (no-op pe server / in teste). */
export function installStyles(): void {
  const doc: any = (globalThis as any).document;
  if (!doc || typeof doc.createElement !== "function" || !doc.head) return;
  if (doc.getElementById?.("rui-styles")) return;
  const el = doc.createElement("style");
  el.id = "rui-styles";
  el.textContent = RUI_CSS;
  doc.head.appendChild(el);
}
