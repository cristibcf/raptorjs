//! The `raptor-runtime` binary - the native RaptorRuntime host.
//!
//! The executable name stays `raptor-runtime`, not `raptor`, until the
//! compatibility audit (spec sections 2 and 13): the repository already has
//! `raptor`, `raptor-run` and `raptor-bundle`, and we don't overwrite them.
//!
//! The command surface is the same as the TypeScript launcher's, so the
//! migration changes nothing for the user.

mod args;
mod commands;

use commands::{Input, Outcome, EXIT_OK, EXIT_USAGE};
use raptor_runtime_core::host::RUNTIME_VERSION;
use raptor_runtime_core::json;

const USAGE: &str = "\
RaptorRuntime (native host)

  raptor-runtime doctor                  check manifest, policies and static graph
  raptor-runtime init [dir]              create a new project
  raptor-runtime pack [--out dir]        package a reproducible unit with a lockfile
  raptor-runtime explain <cap> [target]  say whether an access would be allowed, without running anything
  raptor-runtime run [-- args...]        start the runtime (requires a JavaScript engine)
  raptor-runtime test                    run the project's tests (requires a JavaScript engine)
  raptor-runtime trace                   write OpenTelemetry tracing (requires a JavaScript engine)

  --policy development|production        override the policy from the manifest
  --cwd <path>                           start from another directory
  --json                                 structured output for automation
  --version, --help

Exit codes: 0 success, 1 error, 2 wrong usage, 3 not in this milestone.";

fn dispatch(parsed: &args::Args) -> Outcome {
    if parsed.has("version") || parsed.command.as_deref() == Some("version") {
        return Outcome {
            code: EXIT_OK,
            text: format!("raptor-runtime {RUNTIME_VERSION} (native)"),
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
                text: format!("{USAGE}\n\n(help for '{command}': see the list above)"),
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
                    text: format!("unknown policy: {value} (expected development or production)"),
                    data: json::Json::from_pairs([("flag", json::Json::string("policy"))]),
                }
            }
        },
    };

    // `--cwd` resolves against the process directory, not against the root.
    // Otherwise `--cwd examples/app` - the form everyone writes - looks for
    // the manifest in `/examples/app` and reports that the project doesn't exist.
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
        "test" => Ok(commands::not_yet("test", "a JavaScript engine to evaluate the *.test.ts files")),
        "trace" => Ok(commands::not_yet("trace", "a real run, hence a JavaScript engine")),
        other => {
            return Outcome {
                code: EXIT_USAGE,
                text: format!("unknown command: {other}\n\n{USAGE}"),
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
