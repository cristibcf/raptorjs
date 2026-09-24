//! Normalizare si continere de cai.
//!
//! Aici traieste logica sensibila la securitate a capability broker-ului. Patru
//! proprietati trebuie sa fie adevarate, altfel modelul de capabilitati cade:
//!
//! 1. rezolvarea lexicala se face **inainte** de orice comparatie, deci
//!    `./src/../secret` nu poate fi confundat cu ceva din `./src`;
//! 2. `contains` compara pe segmente, deci `/proiect` nu contine `/proiect-privat`;
//! 3. radacina sistemului de fisiere este punct fix, deci o cautare care urca in
//!    arbore se opreste in loc sa cicleze;
//! 4. **legaturile simbolice sunt urmarite** inainte de decizie (`contains_real`),
//!    altfel un link pus in domeniul acordat ar scoate accesul in afara lui.
//!
//! De aceea sunt doua niveluri:
//!
//! - [`normalize`] / [`contains`] sunt **lexicale** si nu ating discul. O cale nu
//!   trebuie sa existe ca sa poata fi comparata, deci un refuz nu scurge
//!   informatie despre ce fisiere exista.
//! - [`real_path`] / [`contains_real`] rezolva legaturile. Astea le foloseste
//!   brokerul (S6 din `SECURITY-AUDIT.md`).
//!
//! Aceeasi impartire, cu aceleasi nume, in `packages/runtime/src/paths.ts`.

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

/// Forma canonica a unei cai **dupa** rezolvarea legaturilor simbolice.
///
/// `canonicalize` cere ca fisierul sa existe, iar brokerul trebuie sa poata
/// decide si despre un fisier care urmeaza sa fie creat (`files.write`). Deci
/// urcam pana la cel mai adanc parinte care chiar exista, il rezolvam pe acela,
/// si lipim inapoi segmentele ramase. O scriere in `./date/link/nou.txt` ajunge
/// astfel unde ajunge si `open`: prin link, nu pe langa el.
///
/// Cand nimic din cale nu exista - sau cand sistemul refuza sa ne spuna -
/// ramanem la forma lexicala. Asta nu slabeste verificarea: o cale care nu
/// exista nu poate fi un link catre altundeva, iar daca apare intre timp o
/// prinde urmatorul apel.
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
        // Am ajuns la radacina fara sa gasim nimic existent: raspunsul lexical e
        // tot ce avem, si e corect ca atare.
        if parent_path == current {
            return normalized;
        }
        let cut = if parent_path.ends_with('/') { parent_path.len() } else { parent_path.len() + 1 };
        suffix.push(current[cut..].to_string());
        current = parent_path;
    }
}

/// `\\?\C:\x` -> `C:\x`. Pe Windows, `canonicalize` intoarce forma verbatim,
/// care nu se compara cu nimic din ce vede restul programului.
fn strip_verbatim(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

/// `true` daca `target` este `scope` sau se afla strict sub el, **cu legaturile
/// simbolice rezolvate de ambele parti**.
///
/// Domeniul se rezolva si el, nu doar tinta: pe macOS `/tmp` este un link catre
/// `/private/tmp`, deci o comparatie intre un domeniu nerezolvat si o tinta
/// rezolvata ar refuza accesul in propriul director.
///
/// **Cursa TOCTOU ramane, si trebuie spusa:** intre verificarea de aici si
/// `open`-ul propriu-zis, cine poate scrie in domeniu poate inlocui un director
/// cu o legatura. Inchiderea completa cere `openat2(RESOLVE_BENEATH)` pe Linux
/// sau echivalentul lui. Ce se inchide aici e cazul real: un link **deja
/// prezent** in domeniu nu mai scoate accesul afara.
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

    /// Un teren cu o legatura reala pe disc, sau `None` daca sistemul nu ne lasa
    /// sa o facem (Windows fara Developer Mode pentru symlink-uri).
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
            eprintln!("sarit: nu pot crea legaturi simbolice aici");
            return;
        };

        let prin_legatura = format!("{root}/date/spre-secrete/parola.txt");
        // Lexical calea chiar e sub radacina - de aici venea gaura (S6).
        assert!(contains(&root, &prin_legatura), "lexical pare inauntru");
        // Real, duce in alta parte.
        assert!(!contains_real(&root, &prin_legatura), "dar ajunge in afara domeniului");
        assert_eq!(real_path(&prin_legatura), secret);

        // Un fisier obisnuit din acelasi director nu e afectat.
        assert!(contains_real(&root, &format!("{root}/date/cuminte.txt")));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn o_cale_inexistenta_se_rezolva_prin_parintele_ei() {
        let Some((base, root, _secret)) = teren_cu_legatura() else {
            eprintln!("sarit: nu pot crea legaturi simbolice aici");
            return;
        };

        // Fisierul nu exista; parintele e o legatura. O scriere ar ajunge totusi
        // dincolo de ea, deci verificarea trebuie sa vada asta dinainte.
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
