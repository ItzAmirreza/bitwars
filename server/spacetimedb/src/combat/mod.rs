// ── Combat System ──
// Modular combat: damage resolution, weapon firing, projectile impacts.

pub mod blocks;
pub mod damage;
pub mod fire;
pub mod kinetic_penetrator;
pub mod projectile;
pub mod vehicle_destruction;

// Re-export everything for backward compat
pub use blocks::{destroy_blocks_physics, sync_entity_transform};
pub use damage::*;
pub use fire::{fire_weapon, reload_weapon};
pub use projectile::*;
pub use vehicle_destruction::emit_vehicle_destruction_explosion;
