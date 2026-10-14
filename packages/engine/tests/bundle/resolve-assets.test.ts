/**
 * Resolution + asset tests:
 *  - extensionless relative imports (`./util` -> `./util.ts`) resolve, instead of
 *    being left external and vanishing silently;
 *  - a relative import that points at nothing is a hard error, not a half-bundle;
 *  - `import "./x.css"` is collected into the bundle's stylesheet and dropped from
 *    the JS;
 *  - the CLI writes `bundle.css`, links it from index.html, and copies `public/`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleApp, classifySpecifier, runBundleCli } from "../../src/bundle/index.ts";

/** Creates a throwaway project dir, runs `fn`, then cleans it up. */
function inProject(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "raptor-assets-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("classifySpecifier: extensionless relative resolves to the .ts file", () => {
  inProject((dir) => {
    const main = join(dir, "main.ts");
    writeFileSync(main, `export {};`);
    writeFileSync(join(dir, "util.ts"), `export const x = 1;`);
    const r = classifySpecifier("./util", main);
    assert.equal(r.kind, "module");
    assert.ok(r.kind === "module" && r.path.endsWith("util.ts"));
  });
});

test("classifySpecifier: a relative import of a .css file is classified as css", () => {
  inProject((dir) => {
    const main = join(dir, "main.ts");
    writeFileSync(main, `export {};`);
    writeFileSync(join(dir, "style.css"), `body{}`);
    const r = classifySpecifier("./style.css", main);
    assert.equal(r.kind, "css");
  });
});

test("classifySpecifier: a relative import that resolves to nothing is unresolved", () => {
  inProject((dir) => {
    const main = join(dir, "main.ts");
    writeFileSync(main, `export {};`);
    assert.equal(classifySpecifier("./missing", main).kind, "unresolved");
  });
});

test("bundleApp: extensionless imports are included, CSS is collected and dropped", () => {
  inProject((dir) => {
    const main = join(dir, "main.ts");
    writeFileSync(main, `import { msg } from "./util";\nimport "./style.css";\nconsole.log(msg);`);
    writeFileSync(join(dir, "util.ts"), `export const msg = "hi";`);
    writeFileSync(join(dir, "style.css"), `body { color: red; }`);

    const { code, files, css, cssFiles } = bundleApp(main);

    // The extensionless `./util` was followed into the graph.
    assert.ok(files.some((f) => f.endsWith("util.ts")), "util.ts should be bundled");
    // The CSS was collected...
    assert.match(css, /color: red/);
    assert.equal(cssFiles.length, 1);
    // ...and the stylesheet require was dropped (not left dangling in the JS).
    assert.doesNotMatch(code, /require\(\s*["']\.\/style\.css["']\s*\)/);
  });
});

test("bundleApp: an unresolved relative import throws a clear error", () => {
  inProject((dir) => {
    const main = join(dir, "main.ts");
    writeFileSync(main, `import "./nope";`);
    assert.throws(() => bundleApp(main), /cannot resolve import/);
  });
});

test("CLI build: writes bundle.css, links it, and copies public/", () => {
  inProject((dir) => {
    writeFileSync(join(dir, "main.ts"), `import "./style.css";\nexport {};`);
    writeFileSync(join(dir, "style.css"), `.app{color:blue}`);
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><head></head><body><div id="app"></div><script type="module" src="/main.ts"></script></body>`,
    );
    mkdirSync(join(dir, "public"));
    writeFileSync(join(dir, "public", "logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg"/>`);

    const outDir = join(dir, "dist");
    const result = runBundleCli([
      "build",
      join(dir, "main.ts"),
      "--out",
      join(outDir, "bundle.js"),
      "--html",
      join(dir, "index.html"),
    ]);
    assert.ok(result.ok, result.message);

    // Stylesheet written next to the bundle.
    const cssPath = join(outDir, "bundle.css");
    assert.ok(existsSync(cssPath), "bundle.css should be written");
    assert.match(readFileSync(cssPath, "utf8"), /color:blue/);

    // index.html links the stylesheet and the bundle.
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    assert.match(html, /<link rel="stylesheet" href="\.\/bundle\.css">/);
    assert.match(html, /<script type="module" src="\.\/bundle\.js">/);

    // public/ copied verbatim into the output.
    assert.ok(existsSync(join(outDir, "logo.svg")), "public asset should be copied");
  });
});
