// ── RPG ──
// Explosive projectile, high damage.

use super::{DeliveryMethod, WeaponDef};

pub const DEF: WeaponDef = WeaponDef {
    name: "RPG",
    index: 2,
    damage: 80,
    radius: 3.5,
    fire_rate: 1.0,
    max_ammo: 12,
    max_range: 80.0,
    projectile_speed: 120.0,
    delivery: DeliveryMethod::Projectile,
    close_range_threshold: 0.0,
    close_range_damage_mult: 1.0,
};
