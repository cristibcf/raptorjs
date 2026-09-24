/**
 * Ajutoare pentru index.html: rescrie scriptul de modul (care in sursa arata spre
 * entry-ul .tsx, ca la Vite) ca sa incarce bundle-ul, si optional injecteaza
 * snippet-ul de live-reload folosit de dev server.
 */

const MODULE_SCRIPT_RE = /<script\b[^>]*\btype=["']module["'][^>]*>\s*<\/script>/i;

const RELOAD_SNIPPET =
  '<script>try{var es=new EventSource("/__raptor_reload");' +
  'es.onmessage=function(){location.reload()};}catch(e){}</script>';

/** Inlocuieste `src`-ul scriptului de modul cu `bundleSrc`; adauga unul daca lipseste. */
export function rewriteHtml(html: string, bundleSrc: string, injectReload: boolean): string {
  const tag = `<script type="module" src="${bundleSrc}"></script>`;
  let out = MODULE_SCRIPT_RE.test(html) ? html.replace(MODULE_SCRIPT_RE, tag) : html;
  if (!MODULE_SCRIPT_RE.test(html)) {
    // Nu exista script de modul: il inseram inainte de </body> (sau la final).
    out = html.includes("</body>") ? html.replace("</body>", `${tag}</body>`) : html + tag;
  }
  if (injectReload) {
    out = out.includes("</body>") ? out.replace("</body>", `${RELOAD_SNIPPET}</body>`) : out + RELOAD_SNIPPET;
  }
  return out;
}
