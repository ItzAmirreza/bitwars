// ── Rifle ──
// Fast, precise, moderate damage hitscan weapon.

use super::{DeliveryMethod, WeaponDef};

pub const DEF: WeaponDef = WeaponDef {
    name: "Rifle",
    index: 0,
    damage: 25,
    radius: 0.0,
    fire_rate: 5.0,
    max_ammo: 90,
    max_range: 80.0,
    projectile_speed: 0.0,
    delivery: DeliveryMethod::Hitscan,
    close_range_threshold: 0.0,
    close_range_damage_mult: 1.0,
};
