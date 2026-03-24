// ── Combat System ──
// Modular combat: damage resolution, weapon firing, projectile impacts.

pub mod blocks;
pub mod bunker_buster;
pub mod damage;
pub mod fire;
pub mod projectile;

// Re-export everything for backward compat
pub use blocks::{destroy_blocks_physics, sync_entity_transform};
pub use damage::*;
pub use fire::{fire_weapon, reload_weapon};
pub use projectile::*;
