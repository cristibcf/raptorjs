import test from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { containsPath, normalizePath, relativeToRoot, resolvePath } from "../../src/core/index.ts";

test("the canonical form uses '/' and does not keep the trailing slash", () => {
  const root = normalizePath("/project/");
  assert.equal(root, normalizePath("/project"));
  assert.ok(!root.endsWith("/"), "an ordinary directory does not keep a trailing slash");
  assert.ok(!root.includes("\\"), "separators are always '/'");
});

test("walking up to the root stops: the root's parent is the root", () => {
  // Without this property, the upward manifest search (`loadProject`) would loop
  // forever instead of reporting that there is no project.
  let current = normalizePath(process.cwd());
  for (let step = 0; step < 64; step += 1) {
    const parent = normalizePath(dirname(current));
    if (parent === current) {
      assert.ok(true);
      return;
    }
    current = parent;
  }
  assert.fail(`walking up did not reach a fixed point in 64 steps (reached ${current})`);
});

test("resolvePath binds relatives to the base and leaves absolutes untouched", () => {
  const root = normalizePath("/project");
  assert.equal(resolvePath(root, "./src/a.ts"), `${root}/src/a.ts`);
  assert.equal(resolvePath(root, ""), root);
  assert.equal(resolvePath(root, normalizePath("/other/place")), normalizePath("/other/place"));
});

test("containsPath accepts the scope itself and descendants, but not neighbors", () => {
  const scope = normalizePath("/project/src");
  assert.equal(containsPath(scope, scope), true);
  assert.equal(containsPath(scope, `${scope}/deep/a.ts`), true);
  assert.equal(containsPath(scope, normalizePath("/project/src-secret/a.ts")), false);
  assert.equal(containsPath(scope, normalizePath("/project")), false, "the parent is not contained in the child");
});

test("traversal is resolved before the comparison, not searched as text", () => {
  const scope = normalizePath("/project/src");
  assert.equal(containsPath(scope, resolvePath(scope, "../../etc/passwd")), false);
  assert.equal(containsPath(scope, resolvePath(scope, "./a/../b.ts")), true);
});

test("relativeToRoot produces readable paths, and leaves outside paths intact", () => {
  const root = normalizePath("/project");
  assert.equal(relativeToRoot(root, `${root}/src/a.ts`), "./src/a.ts");
  assert.equal(relativeToRoot(root, root), ".");
  assert.equal(relativeToRoot(root, normalizePath("/outside/a.ts")), normalizePath("/outside/a.ts"));
});
