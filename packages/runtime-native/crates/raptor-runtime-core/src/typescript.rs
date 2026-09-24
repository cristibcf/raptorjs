//! Eliminarea tipurilor TypeScript, nativ.
//!
//! Ultima piesa dintre binarul nativ si codul real al proiectului: tot ce e
//! scris in depozit este TypeScript, iar un runtime care nu-l poate citi ramane
//! o demonstratie.
//!
//! **De ce oxc si nu un stripper propriu.** Tentatia de a sterge tipurile cu
//! expresii regulate este mare si gresita: `a < b > (c)` este o comparatie,
//! `f<T>(c)` este un apel generic, iar diferenta se vede doar cu un parser
//! adevarat. oxc este deja lantul de unelte folosit de `integrations/rolldown`
//! pe latura JavaScript, deci nu aducem un al doilea parser de TypeScript in
//! proiect.
//!
//! **Ce face si ce nu face.** Transformarea produce JavaScript din TypeScript;
//! nu coboara sintaxa moderna catre browsere vechi (motorul este ES2023) si nu
//! verifica tipurile. Verificarea de tipuri ramane treaba lui `tsc` la
//! dezvoltare - runtime-ul executa, nu judeca.

use crate::error::{ErrorCode, RaptorError, Result};

/// Extensiile pe care le consideram TypeScript.
pub fn needs_stripping(path: &str) -> bool {
    path.ends_with(".ts") || path.ends_with(".tsx") || path.ends_with(".mts") || path.ends_with(".cts")
}

/// Transforma sursa TypeScript in JavaScript executabil.
///
/// Calea conteaza: din ea deduce oxc daca fisierul are JSX (`.tsx`) si daca este
/// modul sau script. Un `.tsx` parsat ca `.ts` ar raporta erori de sintaxa la
/// primul `<`.
#[cfg(feature = "typescript")]
pub fn strip(source: &str, path: &str) -> Result<String> {
    use oxc_allocator::Allocator;
    use oxc_codegen::Codegen;
    use oxc_parser::Parser;
    use oxc_semantic::SemanticBuilder;
    use oxc_span::SourceType;
    use oxc_transformer::{TransformOptions, Transformer};

    let source_type = SourceType::from_path(path).map_err(|error| {
        RaptorError::new(ErrorCode::ModuleUnsupported, "extensie de fisier nerecunoscuta")
            .with("path", path)
            .with("cause", format!("{error:?}"))
    })?;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        // Prima eroare este cea care conteaza; restul sunt de obicei consecinte.
        let first = &parsed.diagnostics[0];
        return Err(RaptorError::new(ErrorCode::EngineEvaluation, format!("TypeScript invalid: {first}"))
            .with("path", path)
            .with("erori", parsed.diagnostics.len().to_string()));
    }

    let mut program = parsed.program;

    // Transformatorul are nevoie de domenii si simboluri: fara ele nu poate sti
    // ce este un tip si ce este o valoare cu acelasi nume.
    let scoping = SemanticBuilder::new().build(&program).semantic.into_scoping();

    let options = TransformOptions::default();
    let transformed = Transformer::new(&allocator, std::path::Path::new(path), &options)
        .build_with_scoping(scoping, &mut program);

    if !transformed.diagnostics.is_empty() {
        let first = &transformed.diagnostics[0];
        return Err(RaptorError::new(
            ErrorCode::ModuleUnsupported,
            format!("TypeScript pe care nu il pot transforma: {first}"),
        )
        .with("path", path));
    }

    Ok(Codegen::new().build(&program).code)
}

/// Varianta fara feature: refuz explicit, ca sa nu existe o cale tacuta.
#[cfg(not(feature = "typescript"))]
pub fn strip(_source: &str, path: &str) -> Result<String> {
    Err(RaptorError::new(
        ErrorCode::ModuleUnsupported,
        "acest binar este compilat fara suport de TypeScript (cargo build --features typescript)",
    )
    .with("path", path))
}

#[cfg(all(test, feature = "typescript"))]
mod tests {
    use super::*;

    fn strip_ts(source: &str) -> String {
        strip(source, "main.ts").expect("stripping reusit")
    }

    #[test]
    fn recunoaste_extensiile_de_typescript() {
        for path in ["a.ts", "b.tsx", "c.mts", "d.cts"] {
            assert!(needs_stripping(path), "{path} este TypeScript");
        }
        for path in ["a.js", "b.mjs", "c.json"] {
            assert!(!needs_stripping(path), "{path} nu este TypeScript");
        }
    }

    #[test]
    fn adnotarile_de_tip_dispar_iar_valorile_raman() {
        let output = strip_ts("export const x: number = 1;\nexport const y: string = \"a\";\n");
        assert!(output.contains("const x = 1"), "valoarea ramane: {output}");
        assert!(!output.contains(": number"), "tipul dispare: {output}");
        assert!(!output.contains(": string"), "tipul dispare: {output}");
    }

    #[test]
    fn interfetele_si_aliasurile_dispar_complet() {
        let output = strip_ts("interface Om { nume: string }\ntype Varsta = number;\nexport const a = 1;\n");
        assert!(!output.contains("interface"), "interfata dispare: {output}");
        assert!(!output.contains("Varsta"), "aliasul dispare: {output}");
        assert!(output.contains("const a = 1"));
    }

    #[test]
    fn genericele_si_asertiunile_dispar() {
        let output = strip_ts(
            "export function primul<T>(lista: T[]): T { return lista[0]!; }\nexport const n = (1 as number);\n",
        );
        assert!(output.contains("function primul"), "functia ramane: {output}");
        assert!(!output.contains("<T>"), "genericul dispare: {output}");
        assert!(!output.contains(" as "), "asertiunea dispare: {output}");
    }

    #[test]
    fn import_type_dispare_dar_importul_de_valoare_ramane() {
        let output = strip_ts("import type { A } from \"./a.ts\";\nimport { b } from \"./b.ts\";\nexport const c = b;\n");
        assert!(!output.contains("import type"), "importul de tip dispare: {output}");
        assert!(output.contains("./b.ts"), "importul de valoare ramane: {output}");
    }

    #[test]
    fn o_comparatie_nu_este_confundata_cu_un_generic() {
        // Cazul care face imposibil un stripper cu expresii regulate: aceleasi
        // caractere, intelesuri diferite, distinse doar de un parser real.
        let output = strip_ts("export const rezultat = (a: number, b: number, c: number) => a < b > c;\n");
        assert!(output.contains("a < b"), "comparatia ramane intacta: {output}");
    }

    #[test]
    fn jsx_din_tsx_este_pastrat_ca_apeluri() {
        let output = strip(
            "export const e = <div id=\"x\">salut</div>;\n",
            "main.tsx",
        )
        .expect("tsx");
        assert!(!output.contains("<div"), "JSX-ul este transformat: {output}");
    }

    #[test]
    fn typescript_invalid_este_raportat_cu_pozitie() {
        let error = strip("export const x: = ;\n", "main.ts").expect_err("sintaxa invalida");
        assert_eq!(error.code, ErrorCode::EngineEvaluation);
        assert!(error.message.contains("TypeScript invalid"), "{}", error.message);
    }

    #[test]
    fn rezultatul_este_javascript_valid_pentru_motor() {
        // Proprietatea care conteaza de fapt: iesirea trebuie sa treaca prin
        // motor. Verificam forma minima - nu mai contine sintaxa de tip.
        let output = strip_ts(
            "type Nota = { text: string };\nexport const note: Nota[] = [{ text: \"a\" }];\nexport const cate: number = note.length;\n",
        );
        assert!(!output.contains("type "), "{output}");
        assert!(!output.contains("Nota"), "{output}");
        assert!(output.contains("note.length"), "{output}");
    }
}
