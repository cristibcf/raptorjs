/**
 * Helpers for index.html: rewrite the module script (which in the source points to
 * the .tsx entry, Vite-style) so it loads the bundle, and optionally inject the
 * live-reload snippet used by the dev server.
 */

const MODULE_SCRIPT_RE = /<script\b[^>]*\btype=["']module["'][^>]*>\s*<\/script>/i;

const RELOAD_SNIPPET =
  '<script>try{var es=new EventSource("/__raptor_reload");' +
  'es.onmessage=function(){location.reload()};}catch(e){}</script>';

/** Replaces the module script's `src` with `bundleSrc`; adds one if it is missing. */
export function rewriteHtml(html: string, bundleSrc: string, injectReload: boolean): string {
  const tag = `<script type="module" src="${bundleSrc}"></script>`;
  let out = MODULE_SCRIPT_RE.test(html) ? html.replace(MODULE_SCRIPT_RE, tag) : html;
  if (!MODULE_SCRIPT_RE.test(html)) {
    // No module script exists: insert one before </body> (or at the end).
    out = html.includes("</body>") ? html.replace("</body>", `${tag}</body>`) : html + tag;
  }
  if (injectReload) {
    out = out.includes("</body>") ? out.replace("</body>", `${RELOAD_SNIPPET}</body>`) : out + RELOAD_SNIPPET;
  }
  return out;
}
