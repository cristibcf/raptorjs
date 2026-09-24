//! Binarul `raptor-runtime` - host-ul nativ RaptorRuntime.
//!
//! Numele executabilului ramane `raptor-runtime`, nu `raptor`, pana la auditul
//! de compatibilitate (spec sectiunile 2 si 13): in depozit exista deja
//! `raptor`, `raptor-run` si `raptor-bundle`, si nu le suprascriem.
//!
//! Suprafata de comanda este aceeasi cu a launcher-ului TypeScript, ca migrarea
//! sa nu schimbe nimic pentru utilizator.

mod args;
mod commands;

use commands::{Input, Outcome, EXIT_OK, EXIT_USAGE};
use raptor_runtime_core::host::RUNTIME_VERSION;
use raptor_runtime_core::json;

const USAGE: &str = "\
RaptorRuntime (host nativ)

  raptor-runtime doctor                  verifica manifest, politici si graf static
  raptor-runtime init [director]         creeaza un proiect nou
  raptor-runtime pack [--out dir]        ambaleaza o unitate reproductibila cu lockfile
  raptor-runtime explain <cap> [tinta]   spune daca un acces ar fi permis, fara sa ruleze nimic
  raptor-runtime run [-- args...]        porneste runtime-ul (cere motor JavaScript)
  raptor-runtime test                    ruleaza testele proiectului (cere motor JavaScript)
  raptor-runtime trace                   scrie urmarire OpenTelemetry (cere motor JavaScript)

  --policy development|production        suprascrie politica din manifest
  --cwd <cale>                           porneste din alt director
  --json                                 iesire structurata pentru automatizare
  --version, --help

Coduri de iesire: 0 succes, 1 eroare, 2 utilizare gresita, 3 nu in acest milestone.";

fn dispatch(parsed: &args::Args) -> Outcome {
    if parsed.has("version") || parsed.command.as_deref() == Some("version") {
        return Outcome {
            code: EXIT_OK,
            text: format!("raptor-runtime {RUNTIME_VERSION} (nativ)"),
            data: json::Json::from_pairs([
                ("version", json::Json::string(RUNTIME_VERSION)),
                ("host", json::Json::string("native")),
            ]),
        };
    }

    let command = match parsed.command.as_deref() {
        None | Some("help") => {
            return Outcome {
                code: EXIT_OK,
                text: USAGE.to_string(),
                data: json::Json::from_pairs([(
                    "commands",
                    json::Json::array(
                        ["doctor", "init", "pack", "explain", "run", "test", "trace"]
                            .iter()
                            .map(|name| json::Json::string(*name)),
                    ),
                )]),
            }
        }
        Some(command) if parsed.has("help") => {
            return Outcome {
                code: EXIT_OK,
                text: format!("{USAGE}\n\n(ajutor pentru '{command}': vezi lista de mai sus)"),
                data: json::Json::object(),
            }
        }
        Some(command) => command,
    };

    let policy_override = match parsed.flag("policy") {
        None => None,
        Some(value) => match commands::parse_policy(value) {
            Some(mode) => Some(mode),
            None => {
                return Outcome {
                    code: EXIT_USAGE,
                    text: format!("politica necunoscuta: {value} (asteptat development sau production)"),
                    data: json::Json::from_pairs([("flag", json::Json::string("policy"))]),
                }
            }
        },
    };

    // `--cwd` se rezolva fata de directorul procesului, nu fata de radacina.
    // Altfel `--cwd examples/app` - forma pe care o scrie oricine - cauta
    // manifestul in `/examples/app` si raporteaza ca proiectul nu exista.
    let process_cwd =
        std::env::current_dir().ok().and_then(|path| path.to_str().map(str::to_string)).unwrap_or_else(|| ".".to_string());
    let cwd = match parsed.flag("cwd") {
        Some(flag) => raptor_runtime_core::paths::resolve(&process_cwd, flag),
        None => process_cwd,
    };

    let input = Input {
        cwd,
        positionals: parsed.positionals.clone(),
        flags: parsed.flags.clone(),
        app_args: parsed.app_args.clone(),
        policy_override,
    };

    let result = match command {
        "doctor" => Ok(commands::doctor(&input)),
        "init" => commands::init(&input),
        "pack" => commands::pack(&input),
        "explain" => commands::explain(&input),
        "run" => commands::run(&input),
        "test" => Ok(commands::not_yet("test", "un motor JavaScript care sa evalueze fisierele *.test.ts")),
        "trace" => Ok(commands::not_yet("trace", "o rulare reala, deci un motor JavaScript")),
        other => {
            return Outcome {
                code: EXIT_USAGE,
                text: format!("comanda necunoscuta: {other}\n\n{USAGE}"),
                data: json::Json::from_pairs([("command", json::Json::string(other))]),
            }
        }
    };

    result.unwrap_or_else(|error| Outcome::from_error(&error))
}

fn main() {
    let parsed = args::parse(std::env::args().skip(1));
    let as_json = parsed.has("json");
    let outcome = dispatch(&parsed);

    let text = if as_json { json::to_string_pretty(&outcome.data) } else { outcome.text };
    if outcome.code == EXIT_OK {
        println!("{text}");
    } else {
        eprintln!("{text}");
    }
    std::process::exit(outcome.code);
}
