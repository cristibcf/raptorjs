//! Normalizare si continere de cai.
//!
//! Aici traieste logica sensibila la securitate a capability broker-ului. Trei
//! proprietati trebuie sa fie adevarate, altfel modelul de capabilitati cade:
//!
//! 1. rezolvarea este **lexicala**, facuta inainte de orice comparatie, deci
//!    `./src/../secret` nu poate fi confundat cu ceva din `./src`;
//! 2. `contains` compara pe segmente, deci `/proiect` nu contine `/proiect-privat`;
//! 3. radacina sistemului de fisiere este punct fix, deci o cautare care urca in
//!    arbore se opreste in loc sa cicleze.
//!
//! Nu atingem sistemul de fisiere: normalizarea nu urmeaza legaturi simbolice si
//! nu are nevoie ca fisierul sa existe.

/// Pe Windows comparatia de cai ignora registrul literelor si accepta `\`.
pub const CASE_INSENSITIVE: bool = cfg!(windows);

fn is_separator(character: char) -> bool {
    character == '/' || character == '\\'
}

/// Prefixul de radacina al unei cai absolute: `"C:"` pe Windows, `""` cu `/` pe
/// POSIX. `None` pentru caile relative.
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

/// Rezolva lexical `path` fata de `base` si intoarce forma canonica:
/// separatori `/`, fara `.`/`..`, fara slash final (cu exceptia radacinii),
/// litera de disc majuscula pe Windows.
pub fn resolve(base: &str, path: &str) -> String {
    let combined = if path.is_empty() {
        base.to_string()
    } else if is_absolute(path) || base.is_empty() {
        // O cale absoluta se foloseste ca atare; una relativa fara baza nu are
        // de ce sa fie prefixata cu un separator inutil.
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
                // La radacina, `..` nu are unde sa urce: il ignoram, ca o cale
                // absoluta sa nu poata "iesi" din sistemul de fisiere.
                segments.pop();
            }
            other => segments.push(other),
        }
    }

    if segments.is_empty() {
        // Radacina isi pastreaza slash-ul: `C:/` sau `/`. Fara el, `C:` ar
        // insemna "directorul curent al discului C" si urcarea in arbore ar
        // sari inapoi in alta parte in loc sa se opreasca.
        return format!("{root}/");
    }
    format!("{root}/{}", segments.join("/"))
}

/// Forma canonica a unei cai deja absolute.
pub fn normalize(path: &str) -> String {
    resolve("", path)
}

/// Parintele unei cai canonice. Radacina este punct fix: `parent(root) == root`.
pub fn parent(path: &str) -> String {
    let normalized = normalize(path);
    match normalized.rfind('/') {
        // Slash-ul de radacina: deja la capat de drum.
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

/// `true` daca `target` este `scope` sau se afla strict sub el.
pub fn contains(scope: &str, target: &str) -> bool {
    let scope = comparable(&normalize(scope));
    let target = comparable(&normalize(target));
    if scope == target {
        return true;
    }
    // Radacina se termina deja cu `/`; orice alt domeniu are nevoie de separator,
    // altfel `/proiect` ar parea sa contina `/proiect-privat`.
    let prefix = if scope.ends_with('/') { scope } else { format!("{scope}/") };
    target.starts_with(&prefix)
}

/// Cale relativa la radacina proiectului, pentru diagnostice stabile intre
/// platforme. Caile din afara radacinii raman absolute.
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
            assert_eq!(parent(&normalized), normalized, "{normalized} nu este punct fix");
            assert!(normalized.ends_with('/'), "{normalized} si-a pierdut slash-ul de radacina");
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
        panic!("urcarea nu s-a oprit; ultimul director: {current}");
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
        assert!(!contains(&format!("{base}/src"), &base), "parintele nu este continut in copil");
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
}
