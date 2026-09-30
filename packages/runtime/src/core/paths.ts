/**
 * Path normalization and containment, used by the capability broker.
 *
 * Contains security-sensitive logic: containment must reject traversal
 * (`../`), must not confuse `/project-secret` with `/project`, must not be
 * fooled by a symlink, and must handle Windows correctly (mixed separators,
 * drive letter, case-insensitive).
 *
 * **Two levels, used in different places:**
 *
 *  - `containsPath` is purely **lexical** and does not touch the disk. We use it
 *    where the answer must not depend on what exists on disk: diagnostics,
 *    tests, and the first stage of the real check.
 *  - `realPath` / `containsPathReal` **follow symlinks**. These are what the
 *    capability broker uses, because otherwise a symlink placed inside the
 *    granted scope would carry access outside it: `./data/link` would pass the
 *    check and read whatever the link points to (S6 in `SECURITY-AUDIT.md`).
 *
 * The same split, with the same names, in
 * `crates/raptor-runtime-core/src/paths.rs`.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

const WINDOWS = sep === "\\";

/** `C:/` on Windows, `/` otherwise: the point where walking up the tree stops. */
function isFilesystemRoot(path: string): boolean {
  return path === "/" || /^[A-Za-z]:\/$/.test(path);
}

/**
 * Canonical form: `/` separators, no trailing slash, uppercase drive on Windows.
 *
 * Roots keep their trailing slash. Without it, `C:/` would become `C:`, which on
 * Windows means "the current directory of drive C" - and an upward search
 * (`loadProject`) would jump back into the current directory and loop forever
 * instead of stopping at the root.
 */
export function normalizePath(input: string): string {
  const absolute = resolve(input).split("\\").join("/");
  const trimmed = absolute.length > 1 && absolute.endsWith("/") && !isFilesystemRoot(absolute) ? absolute.slice(0, -1) : absolute;
  if (WINDOWS && /^[a-z]:/.test(trimmed)) return trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return trimmed;
}

/** Resolves `target` relative to `base` (absolute paths stay unchanged). */
export function resolvePath(base: string, target: string): string {
  if (!target) return normalizePath(base);
  return isAbsolute(target) ? normalizePath(target) : normalizePath(resolve(base, target));
}

function comparable(path: string): string {
  return WINDOWS ? path.toLowerCase() : path;
}

/**
 * `true` if `target` is `scope` or lies strictly beneath it, **lexically**.
 *
 * Does not touch the disk, so it does not see symlinks. For a security decision
 * use `containsPathReal`.
 */
export function containsPath(scope: string, target: string): boolean {
  const a = comparable(normalizePath(scope));
  const b = comparable(normalizePath(target));
  if (a === b) return true;
  const prefix = a.endsWith("/") ? a : a + "/";
  return b.startsWith(prefix);
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  if (index < 0) return path;
  if (index === 0) return "/";
  // `C:/x` -> `C:/`, not `C:`, which on Windows means something else.
  return path[index - 1] === ":" ? path.slice(0, index + 1) : path.slice(0, index);
}

/**
 * The canonical form of a path **after** resolving symlinks.
 *
 * `realpathSync` requires the file to exist, and the broker must also be able to
 * decide about a file that is about to be created (`files.write`). So we walk up
 * to the deepest parent that DOES exist, resolve that one, and glue the
 * remaining segments back on. A write to `./data/link/new.txt` thus lands where
 * `open` lands too: through the link, not around it.
 *
 * When nothing along the path exists - or when the system refuses to tell us -
 * we fall back to the lexical form. This does not weaken the check: a path that
 * does not exist cannot be a symlink to somewhere else, and if it appears in the
 * meantime, `realPath` catches it on the next access.
 */
export function realPath(input: string): string {
  const normalized = normalizePath(input);
  const suffix: string[] = [];
  let current = normalized;

  for (;;) {
    try {
      const resolved = normalizePath(realpathSync(current));
      return suffix.length === 0 ? resolved : normalizePath(resolve(resolved, ...suffix.reverse()));
    } catch {
      const parent = parentOf(current);
      // We reached the root without finding anything that exists: the lexical
      // answer is all we have, and it is correct as such.
      if (parent === current) return normalized;
      suffix.push(current.slice(parent.endsWith("/") ? parent.length : parent.length + 1));
      current = parent;
    }
  }
}

/**
 * `true` if `target` is `scope` or lies strictly beneath it, **with symlinks
 * resolved on both sides**.
 *
 * The scope is resolved too, not just the target: on macOS `/tmp` is a link to
 * `/private/tmp`, so a comparison between an unresolved scope and a resolved
 * target would deny access inside one's own directory.
 *
 * **The TOCTOU race remains, and it must be stated:** between the check here and
 * the actual `open`, someone who can write in the scope can replace a directory
 * with a link. Closing this completely requires `openat2(RESOLVE_BENEATH)` on
 * Linux or its equivalent, which Node does not expose. What is closed here is
 * the real case: a link **already present** in the scope no longer carries
 * access outside.
 */
export function containsPathReal(scope: string, target: string): boolean {
  return containsPath(realPath(scope), realPath(target));
}

/** Path relative to the project root, for readable diagnostics. */
export function relativeToRoot(root: string, target: string): string {
  const a = normalizePath(root);
  const b = normalizePath(target);
  if (!containsPath(a, b)) return b;
  if (a === b) return ".";
  // A root already ends with `/`; any other scope needs the separator.
  return "./" + b.slice(a.endsWith("/") ? a.length : a.length + 1);
}
