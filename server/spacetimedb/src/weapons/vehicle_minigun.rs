// ── Vehicle Minigun ──
// Nose-mounted hitscan chaingun.

use super::{DeliveryMethod, VehicleWeaponDef};

pub const DEF: VehicleWeaponDef = VehicleWeaponDef {
    name: "Minigun",
    index: 0,
    damage: 8,
    radius: 0.0,
    fire_rate: 15.0,
    max_ammo: 300,
    max_range: 100.0,
    projectile_speed: 0.0,
    gravity: 0.0,
    delivery: DeliveryMethod::Hitscan,
};
