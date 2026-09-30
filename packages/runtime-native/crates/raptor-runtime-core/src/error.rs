//! RaptorRuntime errors (spec section 3: original implementation, no error text
//! copied from other runtimes).
//!
//! Every error carries a stable code `raptor:<domain>/<reason>`, identical to
//! the one in the TypeScript implementation. This is what makes migration to the
//! native host invisible to applications: the contract tests check the same
//! code, not the wording of the message.

use std::collections::BTreeMap;
use std::fmt;

/// The error codes exposed to applications. The list is intentionally closed:
/// a new code is a contract change, not an implementation detail.
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

/// The runtime's unified error. `detail` is ordered (BTreeMap) so that the
/// serialized diagnostics are deterministic.
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

    /// Adds a pair to the diagnostics; chains at construction.
    #[must_use]
    pub fn with(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.detail.insert(key.into(), value.into());
        self
    }

    /// Capability denial: the only way the host blocks an access.
    pub fn capability(code: ErrorCode, capability: &str, target: &str, reason: &str) -> Self {
        Self::new(code, format!("capability '{capability}' does not cover '{target}': {reason}"))
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
            assert!(text.starts_with("raptor:"), "{text} has no product prefix");
            assert!(text.contains('/'), "{text} does not have the domain/reason form");
        }
    }

    #[test]
    fn eroarea_de_capability_poarta_tinta_si_motivul() {
        let error = RaptorError::capability(
            ErrorCode::CapabilityDenied,
            "files.read",
            "/proiect/secret.txt",
            "outside the declared scope",
        );
        assert_eq!(error.detail.get("capability").map(String::as_str), Some("files.read"));
        assert_eq!(error.detail.get("target").map(String::as_str), Some("/proiect/secret.txt"));
        assert!(error.to_string().contains("raptor:capability/denied"));
    }
}
