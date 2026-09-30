//! The contract suite for the native binary (spec section 12).
//!
//! The tests start the real executable, not internal functions: what is checked
//! here is exactly what someone running `raptor-runtime` sees.
//!
//! Two properties are tracked in particular:
//!  - **agreement with the TypeScript implementation**: the same exit codes,
//!    the same lockfile, the same integrity;
//!  - **honesty about what doesn't exist yet**: the commands that need a
//!    JavaScript engine exit with code 3, they don't pretend they ran anything.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const EXIT_ERROR: i32 = 1;
const EXIT_USAGE: i32 = 2;
const EXIT_NOT_YET: i32 = 3;

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new(label: &str) -> Self {
        let unique = format!(
            "raptor-cli-{label}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&root).expect("workspace");
        Self { root }
    }

    fn path(&self) -> &str {
        self.root.to_str().expect("valid path")
    }

    fn read(&self, relative: &str) -> String {
        std::fs::read_to_string(self.root.join(relative))
            .unwrap_or_else(|error| panic!("could not read {relative}: {error}"))
    }

    fn write(&self, relative: &str, contents: &str) {
        let full = self.root.join(relative);
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).expect("directory");
        }
        std::fs::write(full, contents).expect("file written");
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn run(workspace: &Workspace, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_raptor-runtime"))
        .args(args)
        .arg("--cwd")
        .arg(workspace.path())
        .output()
        .expect("the binary starts")
}

fn code(output: &Output) -> i32 {
    output.status.code().unwrap_or(-1)
}

fn text(output: &Output) -> String {
    format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr))
}

fn json(output: &Output) -> raptor_runtime_core::json::Json {
    let combined = text(output);
    raptor_runtime_core::json::parse(combined.trim())
        .unwrap_or_else(|error| panic!("the --json output is not valid JSON: {error}\n{combined}"))
}

#[test]
fn ajutorul_si_versiunea_raspund_fara_proiect() {
    let workspace = Workspace::new("help");

    let help = run(&workspace, &[]);
    assert_eq!(code(&help), 0);
    for command in ["doctor", "init", "pack", "explain", "run"] {
        assert!(text(&help).contains(command), "help does not mention '{command}'");
    }

    let version = run(&workspace, &["--version"]);
    assert_eq!(code(&version), 0);
    assert!(text(&version).contains("raptor-runtime"));
}

#[test]
fn o_comanda_necunoscuta_iese_cu_cod_de_utilizare_nu_de_eroare() {
    let workspace = Workspace::new("unknown");
    let output = run(&workspace, &["zboara"]);
    assert_eq!(code(&output), EXIT_USAGE, "usage errors are not confused with failures");
}

#[test]
fn o_politica_invalida_este_respinsa_inainte_sa_se_atinga_proiectul() {
    let workspace = Workspace::new("policy");
    let output = run(&workspace, &["doctor", "--policy", "chaotic"]);
    assert_eq!(code(&output), EXIT_USAGE);
    assert!(text(&output).contains("development"));
}

#[test]
fn doctor_raporteaza_lipsa_manifestului_in_loc_sa_se_blocheze() {
    let workspace = Workspace::new("nomanifest");
    let output = run(&workspace, &["doctor"]);
    assert_eq!(code(&output), EXIT_ERROR);
    assert!(text(&output).contains("raptor.runtime.json"));
}

#[test]
fn doctor_listeaza_toate_problemele_unui_manifest_invalid() {
    let workspace = Workspace::new("badmanifest");
    workspace.write("raptor.runtime.json", r#"{"capabilities":{"files.zbor":["."]}}"#);

    let output = run(&workspace, &["doctor"]);
    assert_eq!(code(&output), EXIT_ERROR);
    let rendered = text(&output);
    for expected in ["name", "entry", "files.zbor"] {
        assert!(rendered.contains(expected), "'{expected}' missing from:\n{rendered}");
    }
}

#[test]
fn init_creeaza_un_proiect_pe_care_doctor_il_accepta() {
    let workspace = Workspace::new("init");

    let created = run(&workspace, &["init"]);
    assert_eq!(code(&created), 0, "{}", text(&created));
    for file in ["raptor.runtime.json", "raptor.policy.json", "src/main.ts", ".gitignore"] {
        assert!(!workspace.read(file).is_empty(), "{file} missing");
    }

    let doctor = run(&workspace, &["doctor"]);
    assert_eq!(code(&doctor), 0, "{}", text(&doctor));
}

#[test]
fn init_nu_suprascrie_un_proiect_existent() {
    let workspace = Workspace::new("initagain");
    assert_eq!(code(&run(&workspace, &["init"])), 0);
    workspace.write("src/main.ts", "// my work\nexport default () => undefined;\n");

    let again = run(&workspace, &["init"]);
    assert_eq!(code(&again), EXIT_ERROR);
    assert!(workspace.read("src/main.ts").contains("my work"), "the user's code was preserved");
}

#[test]
fn doctor_semnaleaza_module_de_host_necunoscute_si_ocolirea_brokerului() {
    let workspace = Workspace::new("hostmods");
    assert_eq!(code(&run(&workspace, &["init"])), 0);
    workspace.write(
        "src/main.ts",
        "import \"raptor:teleport\";\nimport \"node:fs\";\nimport \"zod\";\nexport default () => undefined;\n",
    );

    let output = run(&workspace, &["doctor"]);
    assert_eq!(code(&output), EXIT_ERROR, "a non-existent host module is an error");
    let rendered = text(&output);
    assert!(rendered.contains("raptor:teleport"));
    assert!(rendered.contains("node:fs"));
    assert!(rendered.contains("zod"));
}

#[test]
fn iesirea_json_este_structurata_nu_text_pentru_oameni() {
    let workspace = Workspace::new("json");
    assert_eq!(code(&run(&workspace, &["init"])), 0);

    let output = run(&workspace, &["doctor", "--json"]);
    let payload = json(&output);
    assert!(payload.get("environment").is_some());
    assert!(payload.get("findings").and_then(|f| f.as_array()).is_some());
    assert_eq!(
        payload.get("project").and_then(|p| p.get("policy")).and_then(|p| p.as_str()),
        Some("development")
    );
}

#[test]
fn pack_produce_acelasi_rezultat_la_fiecare_rulare() {
    let workspace = Workspace::new("pack");
    assert_eq!(code(&run(&workspace, &["init"])), 0);

    assert_eq!(code(&run(&workspace, &["pack"])), 0);
    let first_lock = workspace.read("dist/raptor.lock.json");
    let first_bundle = workspace.read("dist/raptor.bundle.json");

    assert_eq!(code(&run(&workspace, &["pack"])), 0);
    assert_eq!(workspace.read("dist/raptor.lock.json"), first_lock, "the lockfile is not stable");
    assert_eq!(workspace.read("dist/raptor.bundle.json"), first_bundle, "the descriptor is not stable");
}

#[test]
fn lockfile_ul_poarta_integritatea_fiecarui_modul() {
    let workspace = Workspace::new("lock");
    assert_eq!(code(&run(&workspace, &["init"])), 0);
    assert_eq!(code(&run(&workspace, &["pack"])), 0);

    let lock =
        raptor_runtime_core::json::parse(&workspace.read("dist/raptor.lock.json")).expect("lockfile JSON");
    let modules = lock.get("modules").and_then(|m| m.as_array()).expect("list of modules");
    assert!(!modules.is_empty());
    for module in modules {
        let integrity = module.get("integrity").and_then(|i| i.as_str()).expect("integrity");
        assert!(integrity.starts_with("sha256-"), "unexpected format: {integrity}");
    }

    // The packaged unit carries the capabilities: what was declared at development
    // time is exactly what applies at runtime (spec section 7).
    let bundle =
        raptor_runtime_core::json::parse(&workspace.read("dist/raptor.bundle.json")).expect("bundle JSON");
    assert!(bundle.get("capabilities").is_some());
    assert!(bundle
        .get("contentIntegrity")
        .and_then(|c| c.as_str())
        .is_some_and(|c| c.starts_with("sha256-")));
}

#[test]
fn pack_refuza_un_proiect_cu_pachete_externe_nerezolvate() {
    let workspace = Workspace::new("packext");
    assert_eq!(code(&run(&workspace, &["init"])), 0);
    workspace.write("src/main.ts", "import \"left-pad\";\nexport default () => undefined;\n");

    let output = run(&workspace, &["pack"]);
    assert_eq!(code(&output), EXIT_ERROR);
    assert!(text(&output).contains("left-pad"));
}

#[test]
fn explain_raspunde_fara_sa_ruleze_aplicatia() {
    let workspace = Workspace::new("explain");
    assert_eq!(code(&run(&workspace, &["init"])), 0);
    // If `explain` evaluated the module, the test would fail here.
    workspace.write("src/main.ts", "throw new Error(\"explain must not run me\");\n");

    let granted = run(&workspace, &["explain", "files.read", "./src/main.ts"]);
    assert_eq!(code(&granted), 0, "{}", text(&granted));
    assert!(text(&granted).contains("GRANTED"));

    let denied = run(&workspace, &["explain", "files.read", "../outside.txt"]);
    assert_eq!(code(&denied), EXIT_ERROR);
    assert!(text(&denied).contains("DENIED"));
}

#[test]
fn explain_respecta_regimul_strict_al_politicii_de_productie() {
    let workspace = Workspace::new("explainstrict");
    assert_eq!(code(&run(&workspace, &["init"])), 0);

    // `raptor.policy.json` is not in `files.read`, so it is denied anyway;
    // what we check is that the policy reaches the decision.
    let output = run(
        &workspace,
        &["explain", "files.read", "./raptor.policy.json", "--policy", "production", "--json"],
    );
    let payload = json(&output);
    assert_eq!(payload.get("granted").and_then(|g| g.as_bool()), Some(false));
    assert_eq!(payload.get("strict").and_then(|s| s.as_bool()), Some(true));
    assert_eq!(payload.get("policy").and_then(|p| p.as_str()), Some("production"));
}

#[test]
fn explain_cere_o_capability_valida() {
    let workspace = Workspace::new("explainbad");
    assert_eq!(code(&run(&workspace, &["init"])), 0);
    let output = run(&workspace, &["explain", "files.zbor"]);
    assert_eq!(code(&output), EXIT_USAGE);
    assert!(text(&output).contains("files.read"), "the error lists the valid capabilities");
}

#[test]
fn comenzile_care_cer_un_motor_spun_asta_in_loc_sa_pretinda_ca_au_rulat() {
    let workspace = Workspace::new("engine");
    assert_eq!(code(&run(&workspace, &["init"])), 0);

    // `test` and `trace` lag behind the engine: they also need tasks bound to
    // the isolate, not just module evaluation.
    let inca_fara_motor: &[&str] =
        if cfg!(all(feature = "quickjs", feature = "typescript")) {
            &["test", "trace"]
        } else {
            &["run", "test", "trace"]
        };

    for command in inca_fara_motor {
        let output = run(&workspace, &[command]);
        assert_eq!(
            code(&output),
            EXIT_NOT_YET,
            "'{command}' must exit with the reserved code, not 0 or 1:\n{}",
            text(&output)
        );
        assert!(text(&output).to_lowercase().contains("engine"), "'{command}' must say what is missing");
    }

    // The project generated by `init` is TypeScript, so `run` needs both the
    // engine and the stripper - exactly the `full` configuration.
    #[cfg(all(feature = "quickjs", feature = "typescript"))]
    {
        let output = run(&workspace, &["run"]);
        assert_eq!(code(&output), 0, "with an engine, `run` succeeds:\n{}", text(&output));
    }
}

#[test]
fn run_ajunge_pana_la_marginea_motorului_si_raporteaza_diagnosticul() {
    let workspace = Workspace::new("runedge");
    assert_eq!(code(&run(&workspace, &["init"])), 0);

    let output = run(&workspace, &["run", "--json"]);
    let asteptat = if cfg!(all(feature = "quickjs", feature = "typescript")) { 0 } else { EXIT_NOT_YET };
    assert_eq!(code(&output), asteptat, "{}", text(&output));
    let payload = json(&output);

    // Even without an engine, everything native worked: broker, task fabric,
    // host modules, diagnostic.
    let diagnostics = payload.get("diagnostics").expect("diagnostic present");
    assert!(diagnostics.get("capabilities").is_some());
    assert!(diagnostics.get("tasks").is_some());
    assert_eq!(
        diagnostics
            .get("hostModules")
            .and_then(|m| m.as_array())
            .map(<[raptor_runtime_core::json::Json]>::len),
        Some(raptor_runtime_core::host::HOST_MODULE_NAMES.len())
    );
    // Without an engine, the report says why it stopped; with an engine, it says
    // what the module exported. In both cases, everything native worked fully.
    #[cfg(not(all(feature = "quickjs", feature = "typescript")))]
    assert_eq!(
        payload.get("blocked").and_then(|b| b.get("reason")).and_then(|r| r.as_str()),
        Some("engine-missing")
    );
    #[cfg(all(feature = "quickjs", feature = "typescript"))]
    assert!(payload.get("exports").is_some(), "with an engine, the exports are reported");
}

#[test]
fn argumentele_de_dupa_separator_ajung_la_aplicatie_nu_la_launcher() {
    let workspace = Workspace::new("appargs");
    assert_eq!(code(&run(&workspace, &["init"])), 0);

    // `--policy` after `--` belongs to the application, so the launcher must not
    // interpret it and fail on it.
    let output = Command::new(env!("CARGO_BIN_EXE_raptor-runtime"))
        .args(["run", "--cwd", workspace.path(), "--", "--policy", "anything"])
        .output()
        .expect("the binary starts");
    // What matters is that the launcher did not try to interpret `--policy`:
    // if it had, it would have exited with the wrong-usage code.
    assert_ne!(code(&output), EXIT_USAGE, "{}", text(&output));
    let asteptat = if cfg!(all(feature = "quickjs", feature = "typescript")) { 0 } else { EXIT_NOT_YET };
    assert_eq!(code(&output), asteptat, "{}", text(&output));
}

#[test]
fn cwd_permite_lucrul_pe_un_proiect_din_alt_director() {
    let workspace = Workspace::new("cwd");
    assert_eq!(code(&run(&workspace, &["init"])), 0);

    let elsewhere = std::env::temp_dir();
    let output = Command::new(env!("CARGO_BIN_EXE_raptor-runtime"))
        .current_dir(&elsewhere)
        .args(["doctor", "--cwd", workspace.path()])
        .output()
        .expect("the binary starts");
    assert_eq!(code(&output), 0, "{}", text(&output));
    assert!(Path::new(workspace.path()).exists());
}
