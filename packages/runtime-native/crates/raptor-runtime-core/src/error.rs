//! Erorile RaptorRuntime (spec sectiunea 3: implementare originala, fara text
//! de eroare copiat din alte runtime-uri).
//!
//! Fiecare eroare poarta un cod stabil `raptor:<domeniu>/<motiv>`, identic cu
//! cel din implementarea TypeScript. Asta este ce face migrarea la host-ul
//! nativ invizibila pentru aplicatii: testele de contract verifica acelasi cod,
//! nu formularea mesajului.

use std::collections::BTreeMap;
use std::fmt;

/// Codurile de eroare expuse aplicatiilor. Lista este inchisa intentionat:
/// un cod nou este o schimbare de contract, nu un detaliu de implementare.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ErrorCode {
    CapabilityDenied,
    CapabilityUndeclared,
    CapabilityRevoked,
    ManifestInvalid,
    ManifestMissing,
    ModuleNotFound,
    ModuleUnsupported,
    TaskCancelled,
    TaskDeadline,
    TaskQuota,
    EngineEvaluation,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::CapabilityDenied => "raptor:capability/denied",
            ErrorCode::CapabilityUndeclared => "raptor:capability/undeclared",
            ErrorCode::CapabilityRevoked => "raptor:capability/revoked",
            ErrorCode::ManifestInvalid => "raptor:manifest/invalid",
            ErrorCode::ManifestMissing => "raptor:manifest/missing",
            ErrorCode::ModuleNotFound => "raptor:module/not-found",
            ErrorCode::ModuleUnsupported => "raptor:module/unsupported",
            ErrorCode::TaskCancelled => "raptor:task/cancelled",
            ErrorCode::TaskDeadline => "raptor:task/deadline",
            ErrorCode::TaskQuota => "raptor:task/quota",
            ErrorCode::EngineEvaluation => "raptor:engine/evaluation",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Eroarea unificata a runtime-ului. `detail` este ordonat (BTreeMap) ca
/// diagnosticele serializate sa fie deterministe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RaptorError {
    pub code: ErrorCode,
    pub message: String,
    pub detail: BTreeMap<String, String>,
}

impl RaptorError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), detail: BTreeMap::new() }
    }

    /// Adauga o pereche in diagnostic; se inlantuie la constructie.
    #[must_use]
    pub fn with(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.detail.insert(key.into(), value.into());
        self
    }

    /// Refuz de capability: singura cale prin care host-ul blocheaza un acces.
    pub fn capability(code: ErrorCode, capability: &str, target: &str, reason: &str) -> Self {
        Self::new(code, format!("capability '{capability}' nu acopera '{target}': {reason}"))
            .with("capability", capability)
            .with("target", target)
            .with("reason", reason)
    }
}

impl fmt::Display for RaptorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for RaptorError {}

pub type Result<T> = std::result::Result<T, RaptorError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codurile_sunt_stabile_si_au_prefix_de_domeniu() {
        for code in [
            ErrorCode::CapabilityDenied,
            ErrorCode::ManifestMissing,
            ErrorCode::ModuleNotFound,
            ErrorCode::TaskDeadline,
            ErrorCode::EngineEvaluation,
        ] {
            let text = code.as_str();
            assert!(text.starts_with("raptor:"), "{text} nu are prefixul de produs");
            assert!(text.contains('/'), "{text} nu are forma domeniu/motiv");
        }
    }

    #[test]
    fn eroarea_de_capability_poarta_tinta_si_motivul() {
        let error = RaptorError::capability(
            ErrorCode::CapabilityDenied,
            "files.read",
            "/proiect/secret.txt",
            "in afara domeniului declarat",
        );
        assert_eq!(error.detail.get("capability").map(String::as_str), Some("files.read"));
        assert_eq!(error.detail.get("target").map(String::as_str), Some("/proiect/secret.txt"));
        assert!(error.to_string().contains("raptor:capability/denied"));
    }
}
