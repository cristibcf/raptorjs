//! Capability broker (spec sectiunile 5 si 7): securitatea este o functie de
//! produs, nu un wrapper optional.
//!
//! Reguli implementate aici, identice cu cele din implementarea TypeScript:
//!
//! - implicit totul este refuzat, cu exceptia `clock.real` / `crypto.random`,
//!   permise dar adnotate in trace;
//! - granularitatea este per tinta: cale, `gazda:port`, variabila, comanda;
//! - grant-urile sunt revocabile in timpul rularii;
//! - delegarea catre un izolat copil se face doar explicit, printr-un subset
//!   declarat - nu prin mostenire ambientala;
//! - fiecare verificare, permisa sau refuzata, intra in diagnostic.
//!
//! `Broker` este `Send + Sync` si se partajeaza prin `Arc`: un worker primeste
//! acelasi broker (sau un copil delegat), niciodata acces necontrolat la host.

use crate::error::{ErrorCode, RaptorError, Result};
use crate::json::Json;
use crate::manifest::{CapabilityKind, Grant, PolicyMode, CAPABILITY_KINDS};
use crate::observe::{Observer, Severity};
use crate::paths;
use std::collections::BTreeMap;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub granted: bool,
    pub capability: CapabilityKind,
    pub target: String,
    pub reason: String,
    /// Regula din manifest care a decis; utila in `doctor` si in erori.
    pub rule: Option<String>,
    /// Accesul e permis, dar trebuie marcat in trace.
    pub annotated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Usage {
    pub capability: CapabilityKind,
    pub target: String,
    pub granted: bool,
    pub count: u64,
}

/// `api.example.com:443`, `*.example.com:443`, `api.example.com:*`.
fn matches_host(rule: &str, target: &str) -> bool {
    let Some((rule_host, rule_port)) = rule.rsplit_once(':') else { return false };
    let Some((host, port)) = target.rsplit_once(':') else { return false };
    if rule_host.is_empty() || host.is_empty() {
        return false;
    }
    if rule_port != "*" && rule_port != port {
        return false;
    }

    let rule_host = rule_host.to_ascii_lowercase();
    let host = host.to_ascii_lowercase();
    if rule_host == host {
        return true;
    }
    if let Some(suffix) = rule_host.strip_prefix('*') {
        // `*.example.com` acopera `a.example.com`, dar nu `example.com` insusi
        // si nici `rau-example.com`.
        return suffix.starts_with('.') && host.ends_with(suffix) && host.len() > suffix.len();
    }
    false
}

/// `DATABASE_URL` sau prefix `DATABASE_*`.
fn matches_name(rule: &str, target: &str) -> bool {
    match rule.strip_suffix('*') {
        Some(prefix) => target.starts_with(prefix),
        None => rule == target,
    }
}

pub struct Broker {
    project_root: String,
    policy: PolicyMode,
    strict: bool,
    declarations: BTreeMap<CapabilityKind, Grant>,
    revoked: Mutex<Vec<CapabilityKind>>,
    usage: Mutex<BTreeMap<(CapabilityKind, String), Usage>>,
    observer: Observer,
}

impl Broker {
    pub fn new(
        project_root: &str,
        declarations: BTreeMap<CapabilityKind, Grant>,
        policy: PolicyMode,
        strict: Option<bool>,
        observer: Observer,
    ) -> Self {
        Self {
            project_root: paths::normalize(project_root),
            policy,
            // Politica de productie porneste implicit in regim strict.
            strict: strict.unwrap_or(policy == PolicyMode::Production),
            declarations,
            revoked: Mutex::new(Vec::new()),
            usage: Mutex::new(BTreeMap::new()),
            observer,
        }
    }

    pub fn project_root(&self) -> &str {
        &self.project_root
    }

    pub fn policy(&self) -> PolicyMode {
        self.policy
    }

    /// `true` daca nu se aplica niciun domeniu implicit.
    pub fn strict(&self) -> bool {
        self.strict
    }

    pub fn declarations(&self) -> &BTreeMap<CapabilityKind, Grant> {
        &self.declarations
    }

    fn is_revoked(&self, capability: CapabilityKind) -> bool {
        self.revoked.lock().map(|list| list.contains(&capability)).unwrap_or(false)
    }

    fn targets(&self, capability: CapabilityKind) -> &[String] {
        match self.declarations.get(&capability) {
            Some(Grant::Targets(targets)) => targets,
            _ => &[],
        }
    }

    fn decide(&self, capability: CapabilityKind, target: &str) -> Decision {
        let denied = |reason: &str, rule: Option<String>| Decision {
            granted: false,
            capability,
            target: target.to_string(),
            reason: reason.to_string(),
            rule,
            annotated: false,
        };

        if self.is_revoked(capability) {
            return denied("capability revocata in timpul rularii", None);
        }

        if capability.is_ambient() {
            return match self.declarations.get(&capability) {
                Some(Grant::Ambient(false)) => {
                    denied("dezactivata explicit in manifest", Some(format!("{capability}: false")))
                }
                Some(Grant::Ambient(true)) => Decision {
                    granted: true,
                    capability,
                    target: target.to_string(),
                    reason: "declarata in manifest".to_string(),
                    rule: Some(format!("{capability}: true")),
                    annotated: false,
                },
                // Implicit permisa, dar marcata in trace (spec sectiunea 7).
                _ => Decision {
                    granted: true,
                    capability,
                    target: target.to_string(),
                    reason: "implicit permisa, adnotata in trace".to_string(),
                    rule: None,
                    annotated: true,
                },
            };
        }

        let rules = self.targets(capability);
        if rules.is_empty() {
            // Spec sectiunea 7: citirea de fisiere este "refuzata in afara
            // proiectului". Fara declaratie, domeniul implicit este exact
            // radacina proiectului; un manifest care declara `files.read`
            // inlocuieste complet acest implicit.
            if !self.strict
                && capability == CapabilityKind::FilesRead
                && paths::contains(&self.project_root, target)
            {
                return Decision {
                    granted: true,
                    capability,
                    target: target.to_string(),
                    reason: "in radacina proiectului (domeniu implicit)".to_string(),
                    rule: Some("(implicit: radacina proiectului)".to_string()),
                    annotated: true,
                };
            }
            return denied("nedeclarata in manifest", None);
        }

        for rule in rules {
            let hit = match capability {
                CapabilityKind::FilesRead | CapabilityKind::FilesWrite => {
                    paths::contains(&paths::resolve(&self.project_root, rule), target)
                }
                CapabilityKind::NetConnect | CapabilityKind::NetListen => matches_host(rule, target),
                _ => matches_name(rule, target),
            };
            if hit {
                return Decision {
                    granted: true,
                    capability,
                    target: target.to_string(),
                    reason: "acoperita de o regula declarata".to_string(),
                    rule: Some(rule.clone()),
                    annotated: false,
                };
            }
        }

        denied(&format!("in afara domeniului declarat ({})", rules.join(", ")), None)
    }

    /// Verifica un acces si il inregistreaza in diagnostic si telemetrie.
    pub fn check(&self, capability: CapabilityKind, target: &str) -> Decision {
        let normalized = match capability {
            CapabilityKind::FilesRead | CapabilityKind::FilesWrite => {
                paths::resolve(&self.project_root, target)
            }
            _ => target.to_string(),
        };

        let decision = self.decide(capability, &normalized);

        if let Ok(mut usage) = self.usage.lock() {
            usage.entry((capability, normalized.clone())).and_modify(|entry| entry.count += 1).or_insert(
                Usage { capability, target: normalized.clone(), granted: decision.granted, count: 1 },
            );
        }

        let severity = if !decision.granted {
            Severity::Warn
        } else if decision.annotated {
            Severity::Debug
        } else {
            Severity::Info
        };
        self.observer.capability_event(
            capability.as_str(),
            severity,
            BTreeMap::from([
                ("target".to_string(), Json::string(normalized)),
                ("granted".to_string(), Json::Bool(decision.granted)),
                ("reason".to_string(), Json::string(decision.reason.clone())),
                ("rule".to_string(), decision.rule.clone().map_or(Json::Null, Json::string)),
                ("annotated".to_string(), Json::Bool(decision.annotated)),
                ("policy".to_string(), Json::string(self.policy.as_str())),
            ]),
        );

        decision
    }

    /// Ca `check`, dar esueaza daca accesul este refuzat.
    pub fn require(&self, capability: CapabilityKind, target: &str) -> Result<Decision> {
        let decision = self.check(capability, target);
        if decision.granted {
            return Ok(decision);
        }
        let code = if self.is_revoked(capability) {
            ErrorCode::CapabilityRevoked
        } else if self.targets(capability).is_empty() && !capability.is_ambient() {
            ErrorCode::CapabilityUndeclared
        } else {
            ErrorCode::CapabilityDenied
        };
        Err(RaptorError::capability(code, capability.as_str(), &decision.target, &decision.reason))
    }

    pub fn revoke(&self, capability: CapabilityKind) {
        if let Ok(mut revoked) = self.revoked.lock() {
            if !revoked.contains(&capability) {
                revoked.push(capability);
            }
        }
        self.observer.log(
            Severity::Info,
            "capability.revoked",
            BTreeMap::from([("capability".to_string(), Json::string(capability.as_str()))]),
        );
    }

    /// Sub-broker cu un subset explicit; nimic nu se mosteneste implicit.
    pub fn delegate(&self, capabilities: &[CapabilityKind], label: &str) -> Broker {
        let mut subset = BTreeMap::new();
        for capability in capabilities {
            if self.is_revoked(*capability) {
                continue;
            }
            if let Some(grant) = self.declarations.get(capability) {
                subset.insert(*capability, grant.clone());
            }
        }
        // Ambientalele nu se propaga implicit: daca nu sunt cerute, copilul le pierde.
        for ambient in CAPABILITY_KINDS.into_iter().filter(|kind| kind.is_ambient()) {
            if !capabilities.contains(&ambient) {
                subset.insert(ambient, Grant::Ambient(false));
            }
        }

        self.observer.log(
            Severity::Info,
            "capability.delegated",
            BTreeMap::from([
                ("label".to_string(), Json::string(label)),
                (
                    "capabilities".to_string(),
                    Json::array(capabilities.iter().map(|kind| Json::string(kind.as_str()))),
                ),
            ]),
        );

        Broker::new(&self.project_root, subset, self.policy, Some(self.strict), self.observer.child(label))
    }

    pub fn usage(&self) -> Vec<Usage> {
        self.usage.lock().map(|usage| usage.values().cloned().collect()).unwrap_or_default()
    }

    pub fn diagnostics(&self) -> Json {
        let mut declared = Json::object();
        for (kind, grant) in &self.declarations {
            declared.insert(
                kind.as_str(),
                match grant {
                    Grant::Ambient(flag) => Json::Bool(*flag),
                    Grant::Targets(targets) => {
                        Json::array(targets.iter().map(|target| Json::string(target.clone())))
                    }
                },
            );
        }

        let revoked = self.revoked.lock().map(|list| list.clone()).unwrap_or_default();

        Json::from_pairs([
            ("policy", Json::string(self.policy.as_str())),
            ("projectRoot", Json::string(self.project_root.clone())),
            ("strict", Json::Bool(self.strict)),
            ("declared", declared),
            ("revoked", Json::array(revoked.iter().map(|kind| Json::string(kind.as_str())))),
            (
                "usage",
                Json::array(self.usage().into_iter().map(|entry| {
                    Json::from_pairs([
                        ("capability", Json::string(entry.capability.as_str())),
                        ("target", Json::string(entry.target)),
                        ("granted", Json::Bool(entry.granted)),
                        ("count", Json::from(entry.count)),
                    ])
                })),
            ),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> String {
        paths::normalize(if cfg!(windows) { "C:/proiect/app" } else { "/proiect/app" })
    }

    fn broker(pairs: &[(CapabilityKind, Grant)]) -> Broker {
        Broker::new(
            &root(),
            pairs.iter().cloned().collect(),
            PolicyMode::Development,
            None,
            Observer::frozen(),
        )
    }

    fn targets(items: &[&str]) -> Grant {
        Grant::Targets(items.iter().map(|item| (*item).to_string()).collect())
    }

    #[test]
    fn fara_declaratie_scrierea_si_reteaua_sunt_refuzate() {
        let capabilities = broker(&[]);
        assert!(!capabilities.check(CapabilityKind::FilesWrite, "./dist/a.js").granted);
        assert!(!capabilities.check(CapabilityKind::NetConnect, "example.com:443").granted);
        assert!(!capabilities.check(CapabilityKind::ProcessSpawn, "git").granted);
        assert!(!capabilities.check(CapabilityKind::EnvRead, "PATH").granted);
    }

    #[test]
    fn citirea_implicita_se_opreste_la_radacina_proiectului() {
        let capabilities = broker(&[]);
        assert!(capabilities.check(CapabilityKind::FilesRead, "./src/main.ts").granted);

        let outside = paths::resolve(&root(), "../alt-proiect/secret");
        assert!(!capabilities.check(CapabilityKind::FilesRead, &outside).granted);
    }

    #[test]
    fn un_prefix_comun_nu_inseamna_continere() {
        let capabilities = broker(&[(CapabilityKind::FilesRead, targets(&["./src"]))]);
        assert!(capabilities.check(CapabilityKind::FilesRead, "./src/a.ts").granted);
        assert!(!capabilities.check(CapabilityKind::FilesRead, "./src-privat/a.ts").granted);
    }

    #[test]
    fn traversarea_nu_scapa_din_domeniul_declarat() {
        let capabilities = broker(&[(CapabilityKind::FilesRead, targets(&["./src"]))]);
        assert!(!capabilities.check(CapabilityKind::FilesRead, "./src/../raptor.runtime.json").granted);
        assert!(capabilities.check(CapabilityKind::FilesRead, "./src/./adanc/a.ts").granted);
    }

    #[test]
    fn regimul_strict_elimina_domeniul_implicit_de_citire() {
        let capabilities =
            Broker::new(&root(), BTreeMap::new(), PolicyMode::Development, Some(true), Observer::frozen());
        assert!(capabilities.strict());
        assert!(!capabilities.check(CapabilityKind::FilesRead, "./src/main.ts").granted);
    }

    #[test]
    fn politica_de_productie_porneste_implicit_in_regim_strict() {
        let capabilities =
            Broker::new(&root(), BTreeMap::new(), PolicyMode::Production, None, Observer::frozen());
        assert!(capabilities.strict());
        assert!(!capabilities.check(CapabilityKind::FilesRead, "./src/main.ts").granted);
    }

    #[test]
    fn allowlist_ul_de_retea_respecta_gazda_si_portul() {
        let capabilities = broker(&[(
            CapabilityKind::NetConnect,
            targets(&["api.example.com:443", "*.intern.example.com:*"]),
        )]);
        assert!(capabilities.check(CapabilityKind::NetConnect, "api.example.com:443").granted);
        assert!(!capabilities.check(CapabilityKind::NetConnect, "api.example.com:80").granted);
        assert!(capabilities.check(CapabilityKind::NetConnect, "a.intern.example.com:8080").granted);
        assert!(!capabilities.check(CapabilityKind::NetConnect, "intern.example.com:8080").granted);
        assert!(!capabilities.check(CapabilityKind::NetConnect, "rau-api.example.com:443").granted);
    }

    #[test]
    fn variabilele_de_mediu_accepta_nume_exact_sau_prefix() {
        let capabilities = broker(&[(CapabilityKind::EnvRead, targets(&["DATABASE_URL", "RAPTOR_*"]))]);
        assert!(capabilities.check(CapabilityKind::EnvRead, "DATABASE_URL").granted);
        assert!(!capabilities.check(CapabilityKind::EnvRead, "DATABASE_URL_BACKUP").granted);
        assert!(capabilities.check(CapabilityKind::EnvRead, "RAPTOR_TOKEN").granted);
        assert!(!capabilities.check(CapabilityKind::EnvRead, "PATH").granted);
    }

    #[test]
    fn ceasul_si_aleatoriul_sunt_permise_implicit_dar_adnotate() {
        let capabilities = broker(&[]);
        let decision = capabilities.check(CapabilityKind::ClockReal, "");
        assert!(decision.granted);
        assert!(decision.annotated, "accesul implicit trebuie marcat in trace");

        let off = broker(&[(CapabilityKind::ClockReal, Grant::Ambient(false))]);
        assert!(!off.check(CapabilityKind::ClockReal, "").granted);
    }

    #[test]
    fn revocarea_are_efect_imediat() {
        let capabilities = broker(&[(CapabilityKind::FilesRead, targets(&["./src"]))]);
        assert!(capabilities.check(CapabilityKind::FilesRead, "./src/a.ts").granted);

        capabilities.revoke(CapabilityKind::FilesRead);
        assert!(!capabilities.check(CapabilityKind::FilesRead, "./src/a.ts").granted);

        let error = capabilities.require(CapabilityKind::FilesRead, "./src/a.ts").expect_err("refuz");
        assert_eq!(error.code, ErrorCode::CapabilityRevoked);
    }

    #[test]
    fn delegarea_transmite_doar_subsetul_cerut() {
        let capabilities = broker(&[
            (CapabilityKind::FilesRead, targets(&["./src"])),
            (CapabilityKind::FilesWrite, targets(&["./dist"])),
            (CapabilityKind::ClockReal, Grant::Ambient(true)),
        ]);
        let child = capabilities.delegate(&[CapabilityKind::FilesRead], "worker");

        assert!(child.check(CapabilityKind::FilesRead, "./src/a.ts").granted);
        assert!(!child.check(CapabilityKind::FilesWrite, "./dist/a.js").granted);
        assert!(
            !child.check(CapabilityKind::ClockReal, "").granted,
            "ambientalele nu se mostenesc fara cerere explicita"
        );
    }

    #[test]
    fn delegarea_nu_poate_reinvia_o_capability_revocata() {
        let capabilities = broker(&[(CapabilityKind::FilesWrite, targets(&["./dist"]))]);
        capabilities.revoke(CapabilityKind::FilesWrite);
        let child = capabilities.delegate(&[CapabilityKind::FilesWrite], "worker");
        assert!(!child.check(CapabilityKind::FilesWrite, "./dist/a.js").granted);
    }

    #[test]
    fn require_poarta_codul_tinta_si_motivul() {
        let capabilities = broker(&[(CapabilityKind::FilesRead, targets(&["./src"]))]);
        let error = capabilities.require(CapabilityKind::FilesRead, "./secrete/a.txt").expect_err("refuz");
        assert_eq!(error.code, ErrorCode::CapabilityDenied);
        assert_eq!(error.detail.get("capability").map(String::as_str), Some("files.read"));
        assert!(error.detail.get("target").is_some_and(|target| target.ends_with("/secrete/a.txt")));
    }

    #[test]
    fn o_capability_nedeclarata_se_distinge_de_una_refuzata() {
        let capabilities = broker(&[(CapabilityKind::NetConnect, targets(&["api.example.com:443"]))]);
        assert_eq!(
            capabilities.require(CapabilityKind::ProcessSpawn, "git").expect_err("refuz").code,
            ErrorCode::CapabilityUndeclared
        );
        assert_eq!(
            capabilities.require(CapabilityKind::NetConnect, "alt.example.com:443").expect_err("refuz").code,
            ErrorCode::CapabilityDenied
        );
    }

    #[test]
    fn fiecare_decizie_ajunge_in_diagnostic_si_in_telemetrie() {
        let observer = Observer::frozen();
        let capabilities = Broker::new(
            &root(),
            BTreeMap::from([(CapabilityKind::FilesRead, targets(&["./src"]))]),
            PolicyMode::Development,
            None,
            observer.clone(),
        );

        capabilities.check(CapabilityKind::FilesRead, "./src/a.ts");
        capabilities.check(CapabilityKind::FilesRead, "./src/a.ts");
        capabilities.check(CapabilityKind::NetConnect, "example.com:443");

        let usage = capabilities.usage();
        let granted =
            usage.iter().find(|entry| entry.capability == CapabilityKind::FilesRead).expect("citire");
        assert_eq!(granted.count, 2);
        assert!(granted.granted);
        assert!(usage.iter().any(|entry| entry.capability == CapabilityKind::NetConnect && !entry.granted));

        let recorded = observer
            .events()
            .into_iter()
            .filter(|event| event.kind == crate::observe::EventKind::Capability)
            .count();
        assert_eq!(recorded, 3);
    }

    #[test]
    fn brokerul_poate_fi_folosit_din_mai_multe_fire() {
        let capabilities = std::sync::Arc::new(broker(&[(CapabilityKind::FilesRead, targets(&["./src"]))]));
        let handles: Vec<_> = (0..8)
            .map(|index| {
                let shared = std::sync::Arc::clone(&capabilities);
                let _ = index;
                std::thread::spawn(move || shared.check(CapabilityKind::FilesRead, "./src/a.ts").granted)
            })
            .collect();
        for handle in handles {
            assert!(handle.join().expect("firul se incheie curat"));
        }
        let usage = capabilities.usage();
        assert_eq!(usage.iter().map(|entry| entry.count).sum::<u64>(), 8);
    }
}
