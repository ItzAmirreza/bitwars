//! BitWars neural-bot training engine.
//!
//! Reusable library shared by two binaries:
//!   - `bitwars-training` (the Tauri desktop GUI app; requires the `gui` feature)
//!   - `train` (the headless CPU trainer; builds with `--no-default-features`)
//!
//! Everything except the `bridge` module (the Tauri IPC command layer) is
//! tauri-free, so the engine compiles and runs on a headless training server.

pub mod rl;
pub mod sim;
pub mod state;
pub mod training_loop;
#[allow(dead_code, unused_imports)]
pub mod worldgen;

#[cfg(feature = "gui")]
pub mod bridge;
