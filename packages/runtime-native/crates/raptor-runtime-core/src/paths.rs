//! Path normalization and containment.
//!
//! This is where the capability broker's security-sensitive logic lives. Four
//! properties must hold, otherwise the capability model collapses:
//!
//! 1. lexical resolution happens **before** any comparison, so
//!    `./src/../secret` cannot be confused with something in `./src`;
//! 2. `contains` compares by segments, so `/proiect` does not contain `/proiect-privat`;
//! 3. the filesystem root is a fixed point, so a search that climbs up the
//!    tree stops instead of looping;
//! 4. **symbolic links are followed** before the decision (`contains_real`),
//!    otherwise a link placed in the granted scope would take access outside it.
//!
//! That is why there are two levels:
//!
//! - [`normalize`] / [`contains`] are **lexical** and do not touch the disk. A path
//!   does not need to exist to be compared, so a refusal does not leak
//!   information about which files exist.
//! - [`real_path`] / [`contains_real`] resolve the links. These are what the
//!   broker uses (S6 in `SECURITY-AUDIT.md`).
//!
//! The same split, with the same names, in `packages/runtime/src/paths.ts`.

/// On Windows, path comparison ignores letter case and accepts `\`.
pub const CASE_INSENSITIVE: bool = cfg!(windows);

fn is_separator(character: char) -> bool {
    character == '/' || character == '\\'
}

/// The root prefix of an absolute path: `"C:"` on Windows, `""` with `/` on
/// POSIX. `None` for relative paths.
fn root_prefix(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && (bytes[0] as char).is_ascii_alphabetic() {
        return Some(format!("{}:", (bytes[0] as char).to_ascii_uppercase()));
    }
    if bytes.first().is_some_and(|byte| is_separator(*byte as char)) {
        return Some(String::new());
    }
    None
}

pub fn is_absolute(path: &str) -> bool {
    root_prefix(path).is_some()
}

/// Lexically resolves `path` against `base` and returns the canonical form:
/// `/` separators, no `.`/`..`, no trailing slash (except the root),
/// an uppercase drive letter on Windows.
pub fn resolve(base: &str, path: &str) -> String {
    let combined = if path.is_empty() {
        base.to_string()
    } else if is_absolute(path) || base.is_empty() {
        // An absolute path is used as-is; a relative one with no base has no
        // reason to be prefixed with a useless separator.
        path.to_string()
    } else {
        format!("{base}/{path}")
    };

    let root = root_prefix(&combined).unwrap_or_default();
    let body = if root.is_empty() { combined.as_str() } else { &combined[root.len()..] };

    let mut segments: Vec<&str> = Vec::new();
    for segment in body.split(is_separator) {
        match segment {
            "" | "." => {}
            ".." => {
                // At the root, `..` has nowhere to climb: we ignore it, so an
                // absolute path cannot "escape" the filesystem.
                segments.pop();
            }
            other => segments.push(other),
        }
    }

    if segments.is_empty() {
        // The root keeps its slash: `C:/` or `/`. Without it, `C:` would
        // mean "the current directory of drive C" and climbing the tree would
        // jump back elsewhere instead of stopping.
        return format!("{root}/");
    }
    format!("{root}/{}", segments.join("/"))
}

/// The canonical form of an already-absolute path.
pub fn normalize(path: &str) -> String {
    resolve("", path)
}

/// The parent of a canonical path. The root is a fixed point: `parent(root) == root`.
pub fn parent(path: &str) -> String {
    let normalized = normalize(path);
    match normalized.rfind('/') {
        // The root slash: already at the end of the road.
        Some(0) => "/".to_string(),
        Some(index) if normalized[..index].ends_with(':') => format!("{}/", &normalized[..index]),
        Some(index) => normalized[..index].to_string(),
        None => normalized,
    }
}

fn comparable(path: &str) -> String {
    if CASE_INSENSITIVE {
        path.to_ascii_lowercase()
    } else {
        path.to_string()
    }
}

/// `true` if `target` is `scope` or lies strictly below it.
pub fn contains(scope: &str, target: &str) -> bool {
    let scope = comparable(&normalize(scope));
    let target = comparable(&normalize(target));
    if scope == target {
        return true;
    }
    // The root already ends with `/`; any other scope needs a separator,
    // otherwise `/proiect` would seem to contain `/proiect-privat`.
    let prefix = if scope.ends_with('/') { scope } else { format!("{scope}/") };
    target.starts_with(&prefix)
}

/// A path relative to the project root, for diagnostics stable across
/// platforms. Paths outside the root stay absolute.
pub fn relative_to(root: &str, target: &str) -> String {
    let root = normalize(root);
    let target = normalize(target);
    if !contains(&root, &target) {
        return target;
    }
    if comparable(&root) == comparable(&target) {
        return ".".to_string();
    }
    let skip = if root.ends_with('/') { root.len() } else { root.len() + 1 };
    format!("./{}", &target[skip..])
}

/// The canonical form of a path **after** resolving symbolic links.
///
/// `canonicalize` requires the file to exist, and the broker must be able to
/// decide about a file that is about to be created too (`files.write`). So
/// we climb to the deepest parent that actually exists, resolve that one,
/// and glue the remaining segments back on. A write to `./date/link/nou.txt`
/// thus lands where `open` does: through the link, not beside it.
///
/// When nothing in the path exists - or when the system refuses to tell us -
/// we fall back to the lexical form. This does not weaken the check: a path
/// that does not exist cannot be a link to somewhere else, and if it appears in
/// the meantime the next call catches it.
pub fn real_path(path: &str) -> String {
    let normalized = normalize(path);
    let mut suffix: Vec<String> = Vec::new();
    let mut current = normalized.clone();

    loop {
        if let Ok(resolved) = std::fs::canonicalize(&current) {
            let mut out = normalize(&strip_verbatim(&resolved.to_string_lossy()));
            for segment in suffix.iter().rev() {
                out = resolve(&out, segment);
            }
            return out;
        }
        let parent_path = parent(&current);
        // We reached the root without finding anything that exists: the lexical
        // answer is all we have, and it is correct as such.
        if parent_path == current {
            return normalized;
        }
        let cut = if parent_path.ends_with('/') { parent_path.len() } else { parent_path.len() + 1 };
        suffix.push(current[cut..].to_string());
        current = parent_path;
    }
}

/// `\\?\C:\x` -> `C:\x`. On Windows, `canonicalize` returns the verbatim form,
/// which does not compare against anything the rest of the program sees.
fn strip_verbatim(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

/// `true` if `target` is `scope` or lies strictly below it, **with symbolic
/// links resolved on both sides**.
///
/// The scope is resolved too, not just the target: on macOS `/tmp` is a link to
/// `/private/tmp`, so a comparison between an unresolved scope and a resolved
/// target would deny access within one's own directory.
///
/// **The TOCTOU race remains, and must be stated:** between the check here and
/// the actual `open`, whoever can write in the scope can replace a directory
/// with a link. Closing it completely requires `openat2(RESOLVE_BENEATH)` on Linux
/// or its equivalent. What is closed here is the real case: a link **already
/// present** in the scope no longer takes access outside.
pub fn contains_real(scope: &str, target: &str) -> bool {
    contains(&real_path(scope), &real_path(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> String {
        normalize(if cfg!(windows) { "C:/proiect" } else { "/proiect" })
    }

    #[test]
    fn forma_canonica_foloseste_slash_si_nu_pastreaza_slash_final() {
        let base = root();
        assert_eq!(resolve(&base, "./src/"), format!("{base}/src"));
        assert_eq!(resolve(&base, "src\\adanc"), format!("{base}/src/adanc"));
        assert!(!resolve(&base, "./src/").ends_with('/'));
    }

    #[test]
    fn radacina_este_punct_fix() {
        for candidate in ["/", "C:/", "C:\\"] {
            if !cfg!(windows) && candidate.contains(':') {
                continue;
            }
            let normalized = normalize(candidate);
            assert_eq!(parent(&normalized), normalized, "{normalized} is not a fixed point");
            assert!(normalized.ends_with('/'), "{normalized} lost its root slash");
        }
    }

    #[test]
    fn urcarea_in_arbore_se_opreste_intr_un_numar_finit_de_pasi() {
        let mut current = resolve(&root(), "./src/adanc/mai-adanc");
        for _ in 0..64 {
            let next = parent(&current);
            if next == current {
                return;
            }
            current = next;
        }
        panic!("the climb did not stop; last directory: {current}");
    }

    #[test]
    fn traversarea_este_rezolvata_inainte_de_comparatie() {
        let base = root();
        let scope = format!("{base}/src");
        assert!(!contains(&scope, &resolve(&scope, "../secret.txt")));
        assert!(contains(&scope, &resolve(&scope, "./a/../b.ts")));
    }

    #[test]
    fn traversarea_nu_poate_iesi_din_radacina() {
        let base = normalize(if cfg!(windows) { "C:/" } else { "/" });
        assert_eq!(resolve(&base, "../../../etc/passwd"), format!("{base}etc/passwd"));
    }

    #[test]
    fn continerea_nu_se_lasa_pacalita_de_prefixe_comune() {
        let base = root();
        assert!(contains(&base, &base));
        assert!(contains(&base, &format!("{base}/src/a.ts")));
        assert!(!contains(&base, &format!("{base}-privat/a.ts")));
        assert!(!contains(&format!("{base}/src"), &base), "the parent is not contained in the child");
    }

    #[test]
    fn caile_absolute_raman_neatinse_la_rezolvare() {
        let base = root();
        let other = normalize(if cfg!(windows) { "C:/altundeva/b.ts" } else { "/altundeva/b.ts" });
        assert_eq!(resolve(&base, &other), other);
        assert_eq!(resolve(&base, ""), base);
    }

    #[test]
    fn relative_to_produce_cai_lizibile() {
        let base = root();
        assert_eq!(relative_to(&base, &format!("{base}/src/a.ts")), "./src/a.ts");
        assert_eq!(relative_to(&base, &base), ".");
        let outside = normalize(if cfg!(windows) { "C:/afara/a.ts" } else { "/afara/a.ts" });
        assert_eq!(relative_to(&base, &outside), outside);
    }

    #[cfg(windows)]
    #[test]
    fn pe_windows_registrul_literelor_nu_conteaza() {
        assert!(contains("C:/Proiect", "c:/proiect/src/a.ts"));
        assert_eq!(normalize("c:/proiect"), "C:/proiect");
    }

    /// A setup with a real link on disk, or `None` if the system does not let us
    /// create it (Windows without Developer Mode for symlinks).
    fn teren_cu_legatura() -> Option<(std::path::PathBuf, String, String)> {
        let base = std::env::temp_dir().join(format!("raptor-link-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&base);
        let proiect = base.join("proiect");
        let secrete = base.join("secrete");
        std::fs::create_dir_all(proiect.join("date")).ok()?;
        std::fs::create_dir_all(&secrete).ok()?;
        std::fs::write(secrete.join("parola.txt"), "hunter2\n").ok()?;
        std::fs::write(proiect.join("date").join("cuminte.txt"), "obisnuit\n").ok()?;

        let legatura = proiect.join("date").join("spre-secrete");
        #[cfg(unix)]
        let facut = std::os::unix::fs::symlink(&secrete, &legatura).is_ok();
        #[cfg(windows)]
        let facut = std::os::windows::fs::symlink_dir(&secrete, &legatura).is_ok();

        if !facut {
            let _ = std::fs::remove_dir_all(&base);
            return None;
        }
        Some((
            base,
            normalize(&proiect.to_string_lossy()),
            normalize(&secrete.join("parola.txt").to_string_lossy()),
        ))
    }

    #[test]
    fn o_legatura_nu_extinde_domeniul() {
        let Some((base, root, secret)) = teren_cu_legatura() else {
            eprintln!("skipped: cannot create symbolic links here");
            return;
        };

        let prin_legatura = format!("{root}/date/spre-secrete/parola.txt");
        // Lexically the path really is under the root - that is where the hole came from (S6).
        assert!(contains(&root, &prin_legatura), "lexically it looks inside");
        // In reality, it leads elsewhere.
        assert!(!contains_real(&root, &prin_legatura), "but it ends up outside the scope");
        assert_eq!(real_path(&prin_legatura), secret);

        // An ordinary file in the same directory is not affected.
        assert!(contains_real(&root, &format!("{root}/date/cuminte.txt")));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn o_cale_inexistenta_se_rezolva_prin_parintele_ei() {
        let Some((base, root, _secret)) = teren_cu_legatura() else {
            eprintln!("skipped: cannot create symbolic links here");
            return;
        };

        // The file does not exist; the parent is a link. A write would still reach
        // beyond it, so the check must see this in advance.
        let viitor = format!("{root}/date/spre-secrete/nou.txt");
        assert!(real_path(&viitor).ends_with("/secrete/nou.txt"), "{}", real_path(&viitor));
        assert!(!contains_real(&root, &viitor));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn fara_nimic_pe_disc_ramane_forma_lexicala() {
        let inexistent = normalize(&std::env::temp_dir().join("raptor-nu-exista/a/b.txt").to_string_lossy());
        assert_eq!(real_path(&inexistent), inexistent);
    }
}
