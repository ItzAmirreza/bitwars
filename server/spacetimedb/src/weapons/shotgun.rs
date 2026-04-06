// ── Shotgun ──
// Slow, spread, close range hitscan with splash radius.

use super::{DeliveryMethod, WeaponDef};

pub const DEF: WeaponDef = WeaponDef {
    name: "Shotgun",
    index: 1,
    damage: 12,
    radius: 1.5,
    fire_rate: 1.0,
    max_ammo: 24,
    max_range: 30.0,
    projectile_speed: 0.0,
    delivery: DeliveryMethod::Hitscan,
    close_range_threshold: 0.0,
    close_range_damage_mult: 1.0,
};
