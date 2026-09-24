import test from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { containsPath, normalizePath, relativeToRoot, resolvePath } from "../src/index.ts";

test("forma canonica foloseste '/' si nu pastreaza slash-ul final", () => {
  const root = normalizePath("/proiect/");
  assert.equal(root, normalizePath("/proiect"));
  assert.ok(!root.endsWith("/"), "un director obisnuit nu tine slash final");
  assert.ok(!root.includes("\\"), "separatorii sunt intotdeauna '/'");
});

test("urcarea spre radacina se opreste: parintele radacinii este radacina", () => {
  // Fara aceasta proprietate, cautarea manifestului in sus (`loadProject`) ar
  // cicla la nesfarsit in loc sa raporteze ca nu exista niciun proiect.
  let current = normalizePath(process.cwd());
  for (let step = 0; step < 64; step += 1) {
    const parent = normalizePath(dirname(current));
    if (parent === current) {
      assert.ok(true);
      return;
    }
    current = parent;
  }
  assert.fail(`urcarea nu a atins un punct fix in 64 de pasi (a ajuns la ${current})`);
});

test("resolvePath leaga relativele de baza si lasa absolutele neatinse", () => {
  const root = normalizePath("/proiect");
  assert.equal(resolvePath(root, "./src/a.ts"), `${root}/src/a.ts`);
  assert.equal(resolvePath(root, ""), root);
  assert.equal(resolvePath(root, normalizePath("/alt/loc")), normalizePath("/alt/loc"));
});

test("containsPath accepta domeniul insusi si descendentii, dar nu vecinii", () => {
  const scope = normalizePath("/proiect/src");
  assert.equal(containsPath(scope, scope), true);
  assert.equal(containsPath(scope, `${scope}/adanc/a.ts`), true);
  assert.equal(containsPath(scope, normalizePath("/proiect/src-secret/a.ts")), false);
  assert.equal(containsPath(scope, normalizePath("/proiect")), false, "parintele nu este continut in copil");
});

test("traversarea este rezolvata inainte de comparatie, nu cautata ca text", () => {
  const scope = normalizePath("/proiect/src");
  assert.equal(containsPath(scope, resolvePath(scope, "../../etc/passwd")), false);
  assert.equal(containsPath(scope, resolvePath(scope, "./a/../b.ts")), true);
});

test("relativeToRoot produce cai lizibile, si lasa intacte caile din afara", () => {
  const root = normalizePath("/proiect");
  assert.equal(relativeToRoot(root, `${root}/src/a.ts`), "./src/a.ts");
  assert.equal(relativeToRoot(root, root), ".");
  assert.equal(relativeToRoot(root, normalizePath("/afara/a.ts")), normalizePath("/afara/a.ts"));
});
