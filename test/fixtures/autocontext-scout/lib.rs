// v7 scout oracle fixture crate root. Wires the two modules so rust-analyzer
// resolves consumer.rs -> domain.rs cross-file. The resolver-fidelity oracle
// anchors at a consumer.rs site and walks into domain.rs.
pub mod consumer;
pub mod domain;
