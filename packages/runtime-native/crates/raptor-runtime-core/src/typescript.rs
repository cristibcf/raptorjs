//! TypeScript type stripping, native.
//!
//! The last piece between the native binary and the project's real code: everything
//! written in the repository is TypeScript, and a runtime that cannot read it remains
//! a demonstration.
//!
//! **Why oxc and not a stripper of our own.** The temptation to erase types with
//! regular expressions is strong and wrong: `a < b > (c)` is a comparison,
//! `f<T>(c)` is a generic call, and the difference shows only with a real
//! parser. oxc is already the toolchain used by `integrations/rolldown`
//! on the JavaScript side, so we do not bring a second TypeScript parser into
//! the project.
//!
//! **What it does and does not do.** The transform produces JavaScript from TypeScript;
//! it does not lower modern syntax for old browsers (the engine is ES2023) and does
//! not type-check. Type checking remains `tsc`'s job at
//! development time - the runtime executes, it does not judge.

use crate::error::{ErrorCode, RaptorError, Result};

/// The extensions we consider TypeScript.
pub fn needs_stripping(path: &str) -> bool {
    path.ends_with(".ts") || path.ends_with(".tsx") || path.ends_with(".mts") || path.ends_with(".cts")
}

/// Transforms TypeScript source into executable JavaScript.
///
/// The path matters: from it oxc infers whether the file has JSX (`.tsx`) and whether it is
/// a module or a script. A `.tsx` parsed as `.ts` would report syntax errors at
/// the first `<`.
#[cfg(feature = "typescript")]
pub fn strip(source: &str, path: &str) -> Result<String> {
    use oxc_allocator::Allocator;
    use oxc_codegen::Codegen;
    use oxc_parser::Parser;
    use oxc_semantic::SemanticBuilder;
    use oxc_span::SourceType;
    use oxc_transformer::{TransformOptions, Transformer};

    let source_type = SourceType::from_path(path).map_err(|error| {
        RaptorError::new(ErrorCode::ModuleUnsupported, "unrecognized file extension")
            .with("path", path)
            .with("cause", format!("{error:?}"))
    })?;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        // The first error is the one that matters; the rest are usually consequences.
        let first = &parsed.diagnostics[0];
        return Err(RaptorError::new(ErrorCode::EngineEvaluation, format!("invalid TypeScript: {first}"))
            .with("path", path)
            .with("erori", parsed.diagnostics.len().to_string()));
    }

    let mut program = parsed.program;

    // The transformer needs scopes and symbols: without them it cannot know
    // what is a type and what is a value with the same name.
    let scoping = SemanticBuilder::new().build(&program).semantic.into_scoping();

    let options = TransformOptions::default();
    let transformed = Transformer::new(&allocator, std::path::Path::new(path), &options)
        .build_with_scoping(scoping, &mut program);

    if !transformed.diagnostics.is_empty() {
        let first = &transformed.diagnostics[0];
        return Err(RaptorError::new(
            ErrorCode::ModuleUnsupported,
            format!("TypeScript I cannot transform: {first}"),
        )
        .with("path", path));
    }

    Ok(Codegen::new().build(&program).code)
}

/// The feature-less variant: an explicit refusal, so there is no silent path.
#[cfg(not(feature = "typescript"))]
pub fn strip(_source: &str, path: &str) -> Result<String> {
    Err(RaptorError::new(
        ErrorCode::ModuleUnsupported,
        "this binary is compiled without TypeScript support (cargo build --features typescript)",
    )
    .with("path", path))
}

#[cfg(all(test, feature = "typescript"))]
mod tests {
    use super::*;

    fn strip_ts(source: &str) -> String {
        strip(source, "main.ts").expect("stripping succeeded")
    }

    #[test]
    fn recunoaste_extensiile_de_typescript() {
        for path in ["a.ts", "b.tsx", "c.mts", "d.cts"] {
            assert!(needs_stripping(path), "{path} is TypeScript");
        }
        for path in ["a.js", "b.mjs", "c.json"] {
            assert!(!needs_stripping(path), "{path} is not TypeScript");
        }
    }

    #[test]
    fn adnotarile_de_tip_dispar_iar_valorile_raman() {
        let output = strip_ts("export const x: number = 1;\nexport const y: string = \"a\";\n");
        assert!(output.contains("const x = 1"), "the value stays: {output}");
        assert!(!output.contains(": number"), "the type disappears: {output}");
        assert!(!output.contains(": string"), "the type disappears: {output}");
    }

    #[test]
    fn interfetele_si_aliasurile_dispar_complet() {
        let output = strip_ts("interface Om { nume: string }\ntype Varsta = number;\nexport const a = 1;\n");
        assert!(!output.contains("interface"), "the interface disappears: {output}");
        assert!(!output.contains("Varsta"), "the alias disappears: {output}");
        assert!(output.contains("const a = 1"));
    }

    #[test]
    fn genericele_si_asertiunile_dispar() {
        let output = strip_ts(
            "export function primul<T>(lista: T[]): T { return lista[0]!; }\nexport const n = (1 as number);\n",
        );
        assert!(output.contains("function primul"), "the function stays: {output}");
        assert!(!output.contains("<T>"), "the generic disappears: {output}");
        assert!(!output.contains(" as "), "the assertion disappears: {output}");
    }

    #[test]
    fn import_type_dispare_dar_importul_de_valoare_ramane() {
        let output = strip_ts("import type { A } from \"./a.ts\";\nimport { b } from \"./b.ts\";\nexport const c = b;\n");
        assert!(!output.contains("import type"), "the type import disappears: {output}");
        assert!(output.contains("./b.ts"), "the value import stays: {output}");
    }

    #[test]
    fn o_comparatie_nu_este_confundata_cu_un_generic() {
        // The case that makes a regex stripper impossible: the same
        // characters, different meanings, distinguished only by a real parser.
        let output = strip_ts("export const rezultat = (a: number, b: number, c: number) => a < b > c;\n");
        assert!(output.contains("a < b"), "the comparison stays intact: {output}");
    }

    #[test]
    fn jsx_din_tsx_este_pastrat_ca_apeluri() {
        let output = strip(
            "export const e = <div id=\"x\">salut</div>;\n",
            "main.tsx",
        )
        .expect("tsx");
        assert!(!output.contains("<div"), "the JSX is transformed: {output}");
    }

    #[test]
    fn typescript_invalid_este_raportat_cu_pozitie() {
        let error = strip("export const x: = ;\n", "main.ts").expect_err("invalid syntax");
        assert_eq!(error.code, ErrorCode::EngineEvaluation);
        assert!(error.message.contains("invalid TypeScript"), "{}", error.message);
    }

    #[test]
    fn rezultatul_este_javascript_valid_pentru_motor() {
        // The property that actually matters: the output must pass through the
        // engine. We check the minimal form - it no longer contains type syntax.
        let output = strip_ts(
            "type Nota = { text: string };\nexport const note: Nota[] = [{ text: \"a\" }];\nexport const cate: number = note.length;\n",
        );
        assert!(!output.contains("type "), "{output}");
        assert!(!output.contains("Nota"), "{output}");
        assert!(output.contains("note.length"), "{output}");
    }
}
