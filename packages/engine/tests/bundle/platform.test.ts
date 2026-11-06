/**
 * Export conditions, and why a browser bundle may not be resolved like Node
 * (v0.2.1).
 *
 * Until now bare specifiers went through `createRequire().resolve()`, which is
 * Node's CJS resolver: it applies the `node` and `require` conditions and there
 * is no API to tell it otherwise. So any dependency publishing a `node` branch
 * had its NODE build packed into the browser bundle. The case that surfaced it
 * was `@firebase/firestore`, whose node branch pulls in `@grpc/grpc-js` and
 * `protobufjs`; their `require("net")` / `require("http2")` / `require("tls")`
 * reached the browser as `modules["net"]`, which is `undefined`, and the page
 * died inside the loader with "Cannot read properties of undefined (reading
 * 'call')". The build reported success and 271 modules.
 *
 * The fixture below is that exports map, reduced to its shape. The last test is
 * the one that mattered most in practice: the failure has to name the importer,
 * because tracing module ids through a 13 MB bundle is what it cost to find.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bundleApp, classifySpecifier, resolveSpecifier } from "../../src/bundle/index.ts";
import { maskCommentsAndStrings } from "../../src/bundle/esm-graph.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const counterEntry = join(repoRoot, "examples", "counter", "src", "main.tsx");

/** A throwaway project with a dependency, written to disk. */
function fixture(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "raptor-platform-"));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The shape `@firebase/firestore` publishes, reduced to what matters. */
const DUAL_PACKAGE: Record<string, string> = {
  "node_modules/dual/package.json": JSON.stringify({
    name: "dual",
    version: "1.0.0",
    exports: {
      ".": {
        node: { require: "./dist/index.node.cjs.js", import: "./dist/index.node.mjs" },
        browser: { require: "./dist/index.cjs.js", import: "./dist/index.esm2017.js" },
        default: "./dist/index.esm2017.js",
      },
      "./sub/*": { browser: "./dist/browser/*.js", node: "./dist/node/*.js" },
    },
    browser: "./dist/index.esm2017.js",
  }),
  "node_modules/dual/dist/index.node.mjs": `import net from "net";\nexport const flavour = "node";\nexport const sock = net;\n`,
  "node_modules/dual/dist/index.node.cjs.js": `const net = require("net");\nexports.flavour = "node-cjs";\n`,
  "node_modules/dual/dist/index.esm2017.js": `export const flavour = "browser";\n`,
  "node_modules/dual/dist/browser/thing.js": `export const where = "browser";\n`,
  "node_modules/dual/dist/node/thing.js": `export const where = "node";\n`,
  "src/main.ts": `import { flavour } from "dual";\nglobalThis.__flavour = flavour;\n`,
};

/* --------------------------------------------------------------- the pick -- */

test("conditions: a browser bundle gets the browser branch, not the node one", () => {
  const { dir, cleanup } = fixture(DUAL_PACKAGE);
  try {
    const entry = join(dir, "src", "main.ts");
    const browser = resolveSpecifier("dual", entry);
    assert.ok(browser?.endsWith("index.esm2017.js"), `browser default picked ${browser}`);

    // And asking for Node still gives the Node build, for a bundle that is one.
    const node = resolveSpecifier("dual", entry, { conditions: ["node", "import", "require", "default"] });
    assert.ok(node?.endsWith("index.node.mjs"), `node conditions picked ${node}`);
  } finally {
    cleanup();
  }
});

test("conditions: our priority order wins over the order the map lists", () => {
  // `node` is listed FIRST in the fixture, as Firebase lists it. A resolver
  // that walked the map in its own order would pick it.
  const { dir, cleanup } = fixture(DUAL_PACKAGE);
  try {
    const picked = resolveSpecifier("dual", join(dir, "src", "main.ts"));
    assert.doesNotMatch(String(picked), /\.node\./);
  } finally {
    cleanup();
  }
});

test("conditions: a subpath pattern resolves per condition", () => {
  const { dir, cleanup } = fixture(DUAL_PACKAGE);
  try {
    const entry = join(dir, "src", "main.ts");
    assert.ok(resolveSpecifier("dual/sub/thing", entry)?.endsWith(join("browser", "thing.js")));
    assert.ok(
      resolveSpecifier("dual/sub/thing", entry, { conditions: ["node", "default"] })?.endsWith(
        join("node", "thing.js"),
      ),
    );
  } finally {
    cleanup();
  }
});

test("conditions: the legacy top-level browser field is honoured", () => {
  // Many older packages have only this. `@firebase/firestore` sets it too.
  const { dir, cleanup } = fixture({
    "node_modules/legacy/package.json": JSON.stringify({
      name: "legacy",
      version: "1.0.0",
      main: "./lib/node.js",
      browser: "./lib/browser.js",
    }),
    "node_modules/legacy/lib/node.js": `module.exports = { where: "node" };\n`,
    "node_modules/legacy/lib/browser.js": `module.exports = { where: "browser" };\n`,
    "src/main.ts": `import x from "legacy";\nconsole.log(x);\n`,
  });
  try {
    const entry = join(dir, "src", "main.ts");
    assert.ok(resolveSpecifier("legacy", entry)?.endsWith("browser.js"));
    assert.ok(resolveSpecifier("legacy", entry, { conditions: ["node", "default"] })?.endsWith("node.js"));
  } finally {
    cleanup();
  }
});

/* ----------------------------------------------------------- the builtins -- */

test("conditions: a Node builtin in a browser graph is a build error naming the importer", () => {
  const { dir, cleanup } = fixture({
    "node_modules/needs-net/package.json": JSON.stringify({
      name: "needs-net",
      version: "1.0.0",
      exports: { ".": "./index.js" },
    }),
    // What a bundled gRPC module looks like from the loader's point of view.
    "node_modules/needs-net/index.js": `const net = require("net");\nexports.net = net;\n`,
    "src/main.ts": `import { net } from "needs-net";\nconsole.log(net);\n`,
  });
  try {
    const entry = join(dir, "src", "main.ts");
    assert.throws(
      () => bundleApp(entry),
      (err: Error) => {
        // The three things the runtime TypeError did not tell anyone.
        assert.match(err.message, /"net"/, "the specifier");
        assert.match(err.message, /needs-net/, "the importer's path");
        assert.match(err.message, /--platform node/, "and the way out");
        return true;
      },
    );

    // The same graph bundles for Node, where a builtin is a real external.
    const forNode = bundleApp(entry, { platform: "node" });
    assert.match(forNode.code, /require\("net"\)/, "left untouched for Node");
  } finally {
    cleanup();
  }
});

test("conditions: both spellings of a builtin are caught", () => {
  const entry = counterEntry;
  for (const spec of ["net", "node:net", "http2", "tls", "zlib", "os", "fs"]) {
    assert.deepEqual(classifySpecifier(spec, entry), { kind: "node-builtin", spec }, spec);
    assert.deepEqual(
      classifySpecifier(spec, entry, { conditions: ["node", "default"] }),
      { kind: "external" },
      spec + " (node)",
    );
  }
});

/* ------------------------------------------- the fallback, and the chain -- */

/**
 * The umbrella `firebase` package: the shape that produced the second report.
 * Note `require` is listed before `import` inside each condition - the package
 * author's preference, which is for Node.
 */
const UMBRELLA: Record<string, string> = {
  "node_modules/firebase/package.json": JSON.stringify({
    name: "firebase",
    version: "1.0.0",
    exports: {
      "./firestore": {
        node: { require: "./firestore/dist/index.cjs.js", import: "./firestore/dist/index.mjs" },
        browser: { require: "./firestore/dist/index.cjs.js", import: "./firestore/dist/esm/index.esm.js" },
        default: "./firestore/dist/esm/index.esm.js",
      },
    },
    main: "./firestore/dist/index.cjs.js",
  }),
  // The CJS build is the one that reaches gRPC and therefore `tls`.
  "node_modules/firebase/firestore/dist/index.cjs.js": `const g = require("grpc-ish");\nexports.db = g;\n`,
  "node_modules/firebase/firestore/dist/index.mjs": `export const db = 1;\n`,
  "node_modules/firebase/firestore/dist/esm/index.esm.js": `export const db = 1;\n`,
  "node_modules/grpc-ish/package.json": JSON.stringify({ name: "grpc-ish", version: "1.0.0", main: "index.js" }),
  "node_modules/grpc-ish/index.js": `const tls = require("tls");\nexports.tls = tls;\n`,
  "src/data.ts": `import { db } from "firebase/firestore";\nexport const d = db;\n`,
};

test("conditions: inside a matched condition, import wins over require", () => {
  // `require` is not in BROWSER_CONDITIONS at all, so the nested object can
  // only ever yield `import` - which is what keeps the CJS build, and the gRPC
  // branch behind it, out of the graph entirely.
  const { dir, cleanup } = fixture(UMBRELLA);
  try {
    const entry = join(dir, "src", "data.ts");
    assert.ok(resolveSpecifier("firebase/firestore", entry)?.endsWith(join("esm", "index.esm.js")));
    const { code } = bundleApp(entry);
    assert.doesNotMatch(code, /require\("tls"\)/, "the CJS chain never entered the graph");
  } finally {
    cleanup();
  }
});

test("conditions: a named target that is missing is reported, not retried through Node", () => {
  // The real failure behind the second report. Our walk picks
  // `browser.import`, that file is not installed, and the fallback to Node's
  // resolver used to pick `main` - the CJS build - silently undoing the whole
  // browser-conditions fix. A named target that is absent is now an error.
  const incomplete = { ...UMBRELLA };
  delete incomplete["node_modules/firebase/firestore/dist/esm/index.esm.js"];
  const { dir, cleanup } = fixture(incomplete);
  try {
    const entry = join(dir, "src", "data.ts");
    const r = classifySpecifier("firebase/firestore", entry);
    assert.equal(r.kind, "bad-target", `got ${r.kind}`);
    assert.throws(
      () => bundleApp(entry),
      (err: Error) => {
        assert.match(err.message, /index\.esm\.js/, "the target it expected");
        assert.match(err.message, /does not exist/);
        return true;
      },
    );
    // And it must NOT have quietly become the CJS build.
    assert.equal(resolveSpecifier("firebase/firestore", entry), null);
  } finally {
    cleanup();
  }
});

test("conditions: the fallback still covers a layout the walk does not model", () => {
  // Only reached when no package was found at all. `@raptorstack/raptorjs` from
  // inside the raptorjs package itself is a self-reference, which our
  // node_modules walk does not resolve but Node does.
  const selfRef = join(repoRoot, "packages", "raptorjs", "src", "ui", "form.ts");
  assert.ok(resolveSpecifier("@raptorstack/raptorjs", selfRef)?.endsWith("index.ts"));
});

test("conditions: the builtin error prints the whole import chain", () => {
  // `platform: "node"` would allow `tls`, so the CJS path is forced with an
  // explicit condition list that still excludes `node` but puts `require`
  // ahead of `import` - which is also the clearest demonstration that the
  // ORDER of this list, not the order of the package's map, is what decides.
  const { dir, cleanup } = fixture(UMBRELLA);
  try {
    const entry = join(dir, "src", "data.ts");
    assert.throws(
      () => bundleApp(entry, { conditions: ["browser", "require", "default"] }),
      (err: Error) => {
        assert.match(err.message, /"tls" is a Node builtin/);
        assert.match(err.message, /chain: /, "the chain is printed");
        // Every hop, in order: the file someone wrote, through the CJS build,
        // down to the module that actually requires the builtin.
        assert.match(err.message, /data\.ts.*->.*index\.cjs\.js.*->.*grpc-ish.*->.*tls/s);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

/* ----------------------------------- comment/string false-positive (0.2.1) -- */

test("mask: a require() inside a comment or a string is not a dependency", () => {
  // Line comment, block comment, and a string body: in each, `require("tls")`
  // is prose or data, not a call. Masking blanks the interior so the dependency
  // scan cannot see it (the length is preserved, so positions stay valid).
  const line = maskCommentsAndStrings(`// require("tls")\nexport const x = 1;`);
  assert.equal(line.length, `// require("tls")\nexport const x = 1;`.length);
  assert.doesNotMatch(line, /require\(\s*["']/);
  assert.match(line, /export const x = 1;/, "real code is untouched");

  const block = maskCommentsAndStrings(`/* require("net") */ const y = 2;`);
  assert.doesNotMatch(block, /require\(\s*["']/);
  assert.match(block, /const y = 2;/);

  const str = maskCommentsAndStrings(`const s = "require(\\"fs\\")"; const z = 3;`);
  assert.doesNotMatch(str, /require\(\s*["']/);
  assert.match(str, /const z = 3;/);
});

test("mask: a real require, and one inside a template interpolation, survive", () => {
  // The delimiters of a genuine call stay, so the scan still finds it (only the
  // specifier's own interior is blanked, which is why the scan reads the spec
  // back from the original text).
  assert.match(maskCommentsAndStrings(`const r = require("x");`), /require\(\s*["'] *["']\)/);
  // Code inside `${ ... }` is live, not a string body: a require there is seen.
  assert.match(maskCommentsAndStrings('const t = `a${require("y")}b`;'), /require\(\s*["']/);
});

test("conditions: a builtin named only in a comment does not fail the build", () => {
  // The exact second-order report: two source files mentioned `require("tls")`
  // in comments that described the OLD bug. The new loud builtin check read the
  // comment as a dependency and failed a build that was completely correct.
  const { dir, cleanup } = fixture({
    "src/app.ts":
      `// historical note: this used to emit require("tls") into the browser build\n` +
      `/* and require("net"), require("http2") too - all gone now */\n` +
      `export const msg = 'see require("fs") in the docs';\n` +
      `export const x = 1;\n`,
  });
  try {
    const entry = join(dir, "src", "app.ts");
    assert.doesNotThrow(() => bundleApp(entry), "comment/string mentions are not dependencies");
    const { code } = bundleApp(entry);
    assert.match(code, /see require\("fs"\) in the docs/, "the string literal is preserved verbatim");
  } finally {
    cleanup();
  }
});

/* ------------------------------------------------------------- regression -- */

test("conditions: the @raptorstack packages still resolve to their .ts sources", () => {
  // The whole repo depends on this: the packages expose `.ts` directly through
  // their exports maps, with no `node`/`browser` split, and the new resolver
  // must keep finding them.
  assert.ok(resolveSpecifier("@raptorstack/raptorjs", counterEntry)?.endsWith("index.ts"));
  assert.ok(resolveSpecifier("@raptorstack/raptorjs/dom", counterEntry)?.endsWith(join("dom", "index.ts")));
  assert.ok(
    resolveSpecifier("@raptorstack/raptorjs/dom/jsx-runtime", counterEntry)?.endsWith("jsx-runtime.ts"),
  );
  assert.ok(resolveSpecifier("@raptorstack/raptorjs/i18n", counterEntry)?.endsWith(join("i18n", "index.ts")));
  // From an example that actually depends on wire - resolution walks up from
  // the IMPORTER, so the counter, which has no wire dependency, correctly finds
  // nothing.
  const todoEntry = join(repoRoot, "examples", "todo-realtime", "src", "app.ts");
  assert.ok(resolveSpecifier("@raptorstack/wire/server", todoEntry)?.endsWith(join("server", "index.ts")));
  assert.ok(resolveSpecifier("@raptorstack/wire/sse", todoEntry)?.endsWith(join("sse", "index.ts")));
  assert.equal(resolveSpecifier("@raptorstack/wire/sse", counterEntry), null, "not a dependency of the counter");
});

test("conditions: a real example still bundles, with no builtin in the output", () => {
  // Not executed here: the counter's entry touches `document` at module scope,
  // which is the browser's job. `bundle.test.ts` covers evaluation with a
  // fixture built for it; what this guards is that switching to browser
  // conditions did not change which files the graph picks up.
  const { code, files } = bundleApp(counterEntry);
  assert.ok(files.length > 3, `bundled ${files.length} modules`);
  assert.doesNotMatch(code, /require\("(net|tls|http2|zlib|fs|os)"\)/, "no Node builtin reached the bundle");
  assert.ok(
    files.some((f) => f.endsWith(".ts") || f.endsWith(".tsx")),
    "still resolving the @raptorstack packages to their TypeScript sources",
  );
});
