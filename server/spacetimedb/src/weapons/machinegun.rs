// ── Machine Gun ──
// Very high fire-rate bullet hose (hitscan).

use super::{DeliveryMethod, WeaponDef};

pub const DEF: WeaponDef = WeaponDef {
    name: "Machine Gun",
    index: 3,
    damage: 14,
    radius: 0.0,
    fire_rate: 13.0,
    max_ammo: 180,
    max_range: 90.0,
    projectile_speed: 0.0,
    delivery: DeliveryMethod::Hitscan,
    close_range_threshold: 0.0,
    close_range_damage_mult: 1.0,
};
