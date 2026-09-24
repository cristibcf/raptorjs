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
/// Motorul QuickJS; disponibil doar cu `--features quickjs`, ca build-ul
/// implicit sa ramana fara nicio dependenta externa.
#[cfg(feature = "quickjs")]
pub mod quickjs;
pub mod tasks;
/// Eliminarea tipurilor TypeScript. Refuza explicit fara `--features typescript`,
/// ca sa nu existe o cale prin care `.ts` esueaza tacut.
pub mod typescript;
