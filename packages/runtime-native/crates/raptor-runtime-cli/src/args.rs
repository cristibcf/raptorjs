//! Argument parser for the `raptor-runtime` binary.
//!
//! Spec section 4: every command supports both human-readable output and
//! `--json` for automation. The `--` separator passes the rest of the
//! arguments to the application, so `raptor-runtime run -- --port 8080` is
//! unambiguous.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Flag {
    Set,
    Value(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Args {
    pub command: Option<String>,
    pub positionals: Vec<String>,
    pub flags: BTreeMap<String, Flag>,
    /// The arguments after `--`, destined for the application.
    pub app_args: Vec<String>,
}

/// Flags that consume the next value when `--flag=value` is not used.
const VALUE_FLAGS: [&str; 5] = ["policy", "cwd", "out", "filter", "port"];

impl Args {
    pub fn flag(&self, name: &str) -> Option<&str> {
        match self.flags.get(name) {
            Some(Flag::Value(value)) => Some(value),
            _ => None,
        }
    }

    pub fn has(&self, name: &str) -> bool {
        self.flags.contains_key(name)
    }
}

pub fn parse<I, S>(argv: I) -> Args
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let tokens: Vec<String> = argv.into_iter().map(Into::into).collect();
    let mut args = Args::default();
    let mut after_separator = false;
    let mut index = 0usize;

    while index < tokens.len() {
        let token = &tokens[index];

        if after_separator {
            args.app_args.push(token.clone());
            index += 1;
            continue;
        }
        if token == "--" {
            after_separator = true;
            index += 1;
            continue;
        }

        if let Some(body) = token.strip_prefix("--") {
            if let Some((name, value)) = body.split_once('=') {
                args.flags.insert(name.to_string(), Flag::Value(value.to_string()));
                index += 1;
                continue;
            }
            if VALUE_FLAGS.contains(&body) {
                if let Some(next) = tokens.get(index + 1) {
                    if !next.starts_with('-') {
                        args.flags.insert(body.to_string(), Flag::Value(next.clone()));
                        index += 2;
                        continue;
                    }
                }
            }
            args.flags.insert(body.to_string(), Flag::Set);
            index += 1;
            continue;
        }

        if args.command.is_none() {
            args.command = Some(token.clone());
        } else {
            args.positionals.push(token.clone());
        }
        index += 1;
    }

    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separatorul_desparte_argumentele_launcherului_de_cele_ale_aplicatiei() {
        let args = parse(["run", "--policy", "production", "--json", "--", "--port", "8080"]);
        assert_eq!(args.command.as_deref(), Some("run"));
        assert_eq!(args.flag("policy"), Some("production"));
        assert!(args.has("json"));
        assert_eq!(args.app_args, ["--port", "8080"]);
        assert!(args.positionals.is_empty(), "what follows '--' is not positional");
    }

    #[test]
    fn forma_cu_egal_este_echivalenta_cu_forma_cu_spatiu() {
        assert_eq!(parse(["run", "--policy=production"]).flag("policy"), Some("production"));
        assert_eq!(parse(["run", "--policy", "production"]).flag("policy"), Some("production"));
    }

    #[test]
    fn un_flag_de_valoare_fara_valoare_ramane_boolean() {
        let args = parse(["run", "--policy"]);
        assert!(args.has("policy"));
        assert_eq!(args.flag("policy"), None);
    }

    #[test]
    fn un_flag_de_valoare_nu_inghite_urmatorul_flag() {
        let args = parse(["run", "--policy", "--json"]);
        assert_eq!(args.flag("policy"), None);
        assert!(args.has("json"));
    }

    #[test]
    fn pozitionalele_pastreaza_ordinea_dupa_comanda() {
        let args = parse(["init", "new-project", "extra"]);
        assert_eq!(args.command.as_deref(), Some("init"));
        assert_eq!(args.positionals, ["new-project", "extra"]);
    }

    #[test]
    fn fara_argumente_nu_exista_comanda() {
        assert_eq!(parse(Vec::<String>::new()).command, None);
    }
}
