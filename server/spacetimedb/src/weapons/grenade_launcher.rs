// ── Grenade Launcher ──
// Arcing explosive — server-authoritative bouncing projectile.

use super::{DeliveryMethod, WeaponDef};

pub const DEF: WeaponDef = WeaponDef {
    name: "Grenade Launcher",
    index: 4,
    damage: 95,
    radius: 4.8,
    fire_rate: 1.4,
    max_ammo: 14,
    max_range: 85.0,
    projectile_speed: 48.0,
    delivery: DeliveryMethod::ServerProjectile,
    close_range_threshold: 0.0,
    close_range_damage_mult: 1.0,
};
