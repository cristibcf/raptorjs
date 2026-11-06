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
