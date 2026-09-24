//! Graful de module static (spec sectiunea 5, componenta "Module graph").
//!
//! `pack` trebuie sa stie ce fisiere intra in unitatea livrabila fara sa execute
//! aplicatia - altfel ambalarea ar depinde de efectele secundare ale codului.
//!
//! Fata de varianta TypeScript, scanerul de aici nu este o expresie regulata, ci
//! un mic lexer. Diferenta conteaza: un `export const mesaj = "./pare-un-modul"`
//! nu mai poate fi confundat cu un import, iar cuvintele cheie din comentarii si
//! din siruri sunt ignorate corect.
//!
//! Ce nu poate fi rezolvat cu certitudine nu este ghicit: un `import(expresie)`
//! este raportat explicit ca nerezolvabil static.

use crate::digest;
use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;
use crate::paths;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Module {
    /// Cale relativa la radacina proiectului, cu `/` - stabila intre platforme.
    pub path: String,
    pub absolute_path: String,
    pub integrity: String,
    pub byte_length: usize,
    pub imports: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unresolved {
    pub from: String,
    pub specifier: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Graph {
    pub entry: String,
    pub modules: Vec<Module>,
    /// Module `raptor:` si `node:` cerute de aplicatie.
    pub host_imports: Vec<String>,
    pub external_imports: Vec<String>,
    pub unresolved: Vec<Unresolved>,
}

impl Graph {
    pub fn to_json(&self) -> Json {
        Json::from_pairs([
            ("entry", Json::string(self.entry.clone())),
            ("count", Json::from(self.modules.len())),
            ("hostImports", Json::array(self.host_imports.iter().map(|item| Json::string(item.clone())))),
            (
                "externalImports",
                Json::array(self.external_imports.iter().map(|item| Json::string(item.clone()))),
            ),
            (
                "unresolved",
                Json::array(self.unresolved.iter().map(|item| {
                    Json::from_pairs([
                        ("from", Json::string(item.from.clone())),
                        ("specifier", Json::string(item.specifier.clone())),
                        ("reason", Json::string(item.reason.clone())),
                    ])
                })),
            ),
        ])
    }
}

// --- scanare ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Token {
    Ident(String),
    Str(String),
    Punct(char),
}

/// Lexer minimal: suficient ca sa recunoastem declaratiile de import/export.
/// Ignora comentariile si nu confunda cuvintele cheie din siruri cu cod.
fn tokenize(source: &str) -> Vec<Token> {
    let chars: Vec<char> = source.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0usize;

    while index < chars.len() {
        let current = chars[index];

        if current.is_whitespace() {
            index += 1;
            continue;
        }

        // Comentarii
        if current == '/' && chars.get(index + 1) == Some(&'/') {
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            continue;
        }
        if current == '/' && chars.get(index + 1) == Some(&'*') {
            index += 2;
            while index < chars.len() && !(chars[index] == '*' && chars.get(index + 1) == Some(&'/')) {
                index += 1;
            }
            index = (index + 2).min(chars.len());
            continue;
        }

        // Siruri. Template literal-urile sunt consumate, dar nu produc un
        // specificator: un import nu poate avea specificator template.
        if current == '"' || current == '\'' || current == '`' {
            let quote = current;
            index += 1;
            let mut value = String::new();
            while index < chars.len() && chars[index] != quote {
                if chars[index] == '\\' {
                    index += 1;
                    if index < chars.len() {
                        value.push(chars[index]);
                        index += 1;
                    }
                    continue;
                }
                value.push(chars[index]);
                index += 1;
            }
            index += 1;
            if quote == '`' {
                tokens.push(Token::Punct('`'));
            } else {
                tokens.push(Token::Str(value));
            }
            continue;
        }

        if current.is_alphanumeric() || current == '_' || current == '$' {
            let start = index;
            while index < chars.len()
                && (chars[index].is_alphanumeric() || chars[index] == '_' || chars[index] == '$')
            {
                index += 1;
            }
            tokens.push(Token::Ident(chars[start..index].iter().collect()));
            continue;
        }

        tokens.push(Token::Punct(current));
        index += 1;
    }

    tokens
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Scan {
    pub specifiers: Vec<String>,
    /// Importuri dinamice cu specificator calculat - nerezolvabile static.
    pub dynamic_count: usize,
}

/// Cat de departe cautam `from` dupa un `import`/`export`, in tokenuri. O lista
/// de import realista nu depaseste asta; limita opreste cautarea pe un fisier
/// intreg daca declaratia nu este de fapt un import.
const LOOKAHEAD: usize = 512;

pub fn scan_imports(source: &str) -> Scan {
    let tokens = tokenize(source);
    let mut scan = Scan::default();
    let mut index = 0usize;

    while index < tokens.len() {
        let Token::Ident(word) = &tokens[index] else {
            index += 1;
            continue;
        };
        let is_import = word == "import";
        let is_export = word == "export";
        if !is_import && !is_export {
            index += 1;
            continue;
        }

        let mut cursor = index + 1;

        // `import(...)`: dinamic. Rezolvabil doar cu specificator literal.
        if is_import && tokens.get(cursor) == Some(&Token::Punct('(')) {
            match tokens.get(cursor + 1) {
                Some(Token::Str(specifier)) => scan.specifiers.push(specifier.clone()),
                _ => scan.dynamic_count += 1,
            }
            index = cursor + 1;
            continue;
        }

        // `import type` / `export type`: sters la incarcare, deci nu este o
        // dependinta de rulare. `import { type A, b }` ramane import de valoare.
        if matches!(tokens.get(cursor), Some(Token::Ident(word)) if word == "type") {
            index = cursor + 1;
            continue;
        }

        // `import "spec"`: import fara legaturi, doar pentru efect.
        if is_import {
            if let Some(Token::Str(specifier)) = tokens.get(cursor) {
                scan.specifiers.push(specifier.clone());
                index = cursor + 1;
                continue;
            }
        }

        // Restul trebuie sa treaca prin `from "spec"`. Fara `from`, `export`
        // este o declaratie locala, nu un import.
        let limit = (cursor + LOOKAHEAD).min(tokens.len());
        let mut found = false;
        while cursor < limit {
            match &tokens[cursor] {
                Token::Ident(word) if word == "from" => {
                    if let Some(Token::Str(specifier)) = tokens.get(cursor + 1) {
                        scan.specifiers.push(specifier.clone());
                        found = true;
                    }
                    break;
                }
                // `;` inchide declaratia; un alt `import`/`export` incepe alta.
                Token::Punct(';') => break,
                Token::Ident(word) if word == "import" || word == "export" => break,
                _ => cursor += 1,
            }
        }

        index = if found { cursor + 2 } else { index + 1 };
    }

    scan
}

// --- parcurgere ------------------------------------------------------------

/// Extensii incercate cand specificatorul nu are una.
const EXTENSIONS: [&str; 7] = ["", ".ts", ".js", ".mts", ".mjs", "/index.ts", "/index.js"];

fn read_file(path: &str) -> Option<Vec<u8>> {
    std::fs::read(Path::new(path)).ok()
}

/// Parcurge graful pornind de la `entry`. Nu paraseste niciodata radacina
/// proiectului: un import relativ care iese din proiect este raportat, nu
/// inclus tacit.
pub fn build(project_root: &str, entry: &str) -> Result<Graph> {
    let root = paths::normalize(project_root);
    let entry_path = paths::resolve(&root, entry);

    let mut modules: BTreeMap<String, Module> = BTreeMap::new();
    let mut host_imports: BTreeSet<String> = BTreeSet::new();
    let mut external_imports: BTreeSet<String> = BTreeSet::new();
    let mut unresolved: Vec<Unresolved> = Vec::new();
    let mut queue: VecDeque<String> = VecDeque::from([entry_path.clone()]);
    let mut seen: BTreeSet<String> = BTreeSet::new();

    while let Some(current) = queue.pop_front() {
        if !seen.insert(current.clone()) {
            continue;
        }

        let Some(bytes) = read_file(&current) else {
            return Err(RaptorError::new(
                ErrorCode::ModuleNotFound,
                format!("modulul nu exista: {}", paths::relative_to(&root, &current)),
            )
            .with("path", current));
        };

        let source = String::from_utf8_lossy(&bytes);
        let scan = scan_imports(&source);
        let here = paths::relative_to(&root, &current);

        if scan.dynamic_count > 0 {
            unresolved.push(Unresolved {
                from: here.clone(),
                specifier: "import(<expresie>)".to_string(),
                reason: format!(
                    "{} import(uri) dinamice cu specificator calculat; nu pot fi ambalate static",
                    scan.dynamic_count
                ),
            });
        }

        let mut resolved_imports: Vec<String> = Vec::new();
        for specifier in &scan.specifiers {
            if specifier.starts_with("raptor:") || specifier.starts_with("node:") {
                host_imports.insert(specifier.clone());
                resolved_imports.push(specifier.clone());
                continue;
            }
            if !specifier.starts_with('.') && !specifier.starts_with('/') {
                external_imports.insert(specifier.clone());
                resolved_imports.push(specifier.clone());
                continue;
            }

            let base = paths::parent(&current);
            let target = EXTENSIONS.iter().find_map(|extension| {
                let candidate = paths::resolve(&base, &format!("{specifier}{extension}"));
                read_file(&candidate).map(|_| candidate)
            });

            match target {
                None => unresolved.push(Unresolved {
                    from: here.clone(),
                    specifier: specifier.clone(),
                    reason: "fisierul nu a fost gasit".to_string(),
                }),
                Some(target) if !paths::contains(&root, &target) => unresolved.push(Unresolved {
                    from: here.clone(),
                    specifier: specifier.clone(),
                    reason: "iese din radacina proiectului".to_string(),
                }),
                Some(target) => {
                    resolved_imports.push(paths::relative_to(&root, &target));
                    queue.push_back(target);
                }
            }
        }

        resolved_imports.sort();
        resolved_imports.dedup();
        modules.insert(
            here.clone(),
            Module {
                path: here,
                absolute_path: current,
                integrity: digest::integrity(&bytes),
                byte_length: bytes.len(),
                imports: resolved_imports,
            },
        );
    }

    unresolved.sort_by(|a, b| (&a.from, &a.specifier).cmp(&(&b.from, &b.specifier)));

    Ok(Graph {
        entry: paths::relative_to(&root, &entry_path),
        // `BTreeMap`/`BTreeSet` garanteaza ordinea; de asta depinde `pack`.
        modules: modules.into_values().collect(),
        host_imports: host_imports.into_iter().collect(),
        external_imports: external_imports.into_iter().collect(),
        unresolved,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn specifiers(source: &str) -> Vec<String> {
        scan_imports(source).specifiers
    }

    #[test]
    fn importurile_statice_sunt_gasite_in_toate_formele() {
        let source = [
            r#"import a from "./a.ts";"#,
            r#"import { b, c as d } from "./b.ts";"#,
            r#"import * as e from "./c.ts";"#,
            r#"import "./efect.ts";"#,
            r#"export { f } from "./d.ts";"#,
            r#"export * from "./e.ts";"#,
        ]
        .join("\n");
        let mut found = specifiers(&source);
        found.sort();
        assert_eq!(found, ["./a.ts", "./b.ts", "./c.ts", "./d.ts", "./e.ts", "./efect.ts"]);
    }

    #[test]
    fn importurile_de_tip_sunt_ignorate_dar_cele_de_valoare_raman() {
        let source = [
            r#"import type { A } from "./tip.ts";"#,
            r#"export type { B } from "./alt-tip.ts";"#,
            r#"import { type C, d } from "./valoare.ts";"#,
        ]
        .join("\n");
        assert_eq!(specifiers(&source), ["./valoare.ts"]);
    }

    #[test]
    fn o_declaratie_export_fara_from_nu_este_un_import() {
        // Cazul care scapa unei expresii regulate: sirul seamana cu un modul.
        let source = r#"export const mesaj = "./pare-un-modul.ts";"#;
        assert!(specifiers(source).is_empty(), "sirul nu este un specificator");
    }

    #[test]
    fn cuvintele_cheie_din_siruri_si_comentarii_sunt_ignorate() {
        let source = [
            r#"// import fals from "./comentariu.ts""#,
            r#"/* import alt from "./bloc.ts" */"#,
            r#"const text = "import x from './sir.ts'";"#,
            r#"import real from "./real.ts";"#,
        ]
        .join("\n");
        assert_eq!(specifiers(&source), ["./real.ts"]);
    }

    #[test]
    fn importul_dinamic_literal_este_rezolvat_cel_calculat_este_raportat() {
        let scan = scan_imports(
            [r#"const a = await import("./literal.ts");"#, "const b = await import(numeCalculat);"]
                .join("\n")
                .as_str(),
        );
        assert_eq!(scan.specifiers, ["./literal.ts"]);
        assert_eq!(scan.dynamic_count, 1);
    }

    #[test]
    fn scanerul_nu_se_blocheaza_pe_intrari_neobisnuite() {
        for source in ["import", "import {", r#"import { a } from"#, "export", "`import x from \"./t.ts\"`"] {
            let _ = scan_imports(source);
        }
    }

    // --- parcurgerea pe disc ---

    struct Fixture {
        root: String,
    }

    impl Fixture {
        fn new(files: &[(&str, &str)]) -> Self {
            let unique = format!(
                "raptor-graph-{}-{:?}",
                std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
            );
            let root = paths::normalize(std::env::temp_dir().join(unique).to_str().expect("cale valida"));
            for (path, contents) in files {
                let full = paths::resolve(&root, path);
                std::fs::create_dir_all(Path::new(&paths::parent(&full))).expect("director creat");
                std::fs::write(Path::new(&full), contents).expect("fisier scris");
            }
            Self { root }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(Path::new(&self.root));
        }
    }

    #[test]
    fn graful_parcurge_tranzitiv_si_produce_cai_relative() {
        let fixture = Fixture::new(&[
            ("src/main.ts", "import \"./util.ts\";\nimport \"./adanc/nested.ts\";"),
            ("src/util.ts", "export const x = 1;"),
            ("src/adanc/nested.ts", "import \"../util.ts\";\nexport const y = 2;"),
        ]);
        let graph = build(&fixture.root, "./src/main.ts").expect("graf construit");

        assert_eq!(graph.entry, "./src/main.ts");
        assert_eq!(
            graph.modules.iter().map(|module| module.path.as_str()).collect::<Vec<_>>(),
            ["./src/adanc/nested.ts", "./src/main.ts", "./src/util.ts"]
        );
        assert!(graph.modules.iter().all(|module| module.integrity.starts_with("sha256-")));
        let nested = graph.modules.iter().find(|module| module.path.ends_with("nested.ts")).expect("modul");
        assert_eq!(nested.imports, ["./src/util.ts"]);
    }

    #[test]
    fn acelasi_proiect_produce_acelasi_graf_inclusiv_ordinea() {
        let fixture = Fixture::new(&[
            ("src/main.ts", "import \"./z.ts\";\nimport \"./a.ts\";"),
            ("src/a.ts", "export const a = 1;"),
            ("src/z.ts", "export const z = 1;"),
        ]);
        let first = build(&fixture.root, "./src/main.ts").expect("graf");
        let second = build(&fixture.root, "./src/main.ts").expect("graf");
        assert_eq!(first, second);
    }

    #[test]
    fn modulele_de_host_si_pachetele_externe_sunt_separate() {
        let fixture = Fixture::new(&[(
            "src/main.ts",
            "import \"raptor:files\";\nimport \"node:crypto\";\nimport \"zod\";",
        )]);
        let graph = build(&fixture.root, "./src/main.ts").expect("graf");
        assert_eq!(graph.host_imports, ["node:crypto", "raptor:files"]);
        assert_eq!(graph.external_imports, ["zod"]);
        assert_eq!(graph.modules.len(), 1);
    }

    #[test]
    fn ciclurile_nu_blocheaza_parcurgerea() {
        let fixture = Fixture::new(&[
            ("src/main.ts", "import \"./a.ts\";"),
            ("src/a.ts", "import \"./b.ts\";"),
            ("src/b.ts", "import \"./a.ts\";"),
        ]);
        let graph = build(&fixture.root, "./src/main.ts").expect("graf");
        assert_eq!(graph.modules.len(), 3);
    }

    #[test]
    fn un_import_care_iese_din_proiect_este_raportat_nu_inclus() {
        let fixture = Fixture::new(&[("src/main.ts", "import \"../../afara.ts\";")]);
        let graph = build(&fixture.root, "./src/main.ts").expect("graf");
        assert_eq!(graph.modules.len(), 1);
        assert_eq!(graph.unresolved.len(), 1);
    }

    #[test]
    fn un_punct_de_intrare_inexistent_este_o_eroare_raptor() {
        let fixture = Fixture::new(&[("src/altceva.ts", "export const x = 1;")]);
        let error = build(&fixture.root, "./src/main.ts").expect_err("eroare");
        assert_eq!(error.code, ErrorCode::ModuleNotFound);
    }
}
