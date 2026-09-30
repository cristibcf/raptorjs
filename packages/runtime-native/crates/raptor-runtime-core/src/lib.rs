pub mod capabilities;
pub mod digest;
pub mod engine;
pub mod error;
pub mod graph;
pub mod host;
pub mod http;
pub mod json;
pub mod manifest;
pub mod modules;
pub mod observe;
pub mod paths;
/// The QuickJS engine; available only with `--features quickjs`, so the default
/// build stays free of any external dependency.
#[cfg(feature = "quickjs")]
pub mod quickjs;
pub mod tasks;
/// TypeScript type stripping. Refuses explicitly without `--features typescript`,
/// so there is no path by which `.ts` fails silently.
pub mod typescript;
