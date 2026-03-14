// ── Combat System ──
// Modular combat: damage resolution, weapon firing, projectile impacts.

pub mod damage;
pub mod fire;
pub mod projectile;
pub mod blocks;

// Re-export everything for backward compat
pub use damage::*;
pub use fire::{fire_weapon, reload_weapon};
pub use projectile::projectile_impact;
pub use blocks::{destroy_blocks_physics, sync_entity_transform};
