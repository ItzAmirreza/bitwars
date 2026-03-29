// ── Vehicle Rockets ──
// Hydra rockets — projectile, explosive, wide oblate destruction.

use super::{DeliveryMethod, VehicleWeaponDef};

pub const DEF: VehicleWeaponDef = VehicleWeaponDef {
    name: "Hydra Rockets",
    index: 1,
    damage: 45,
    player_damage_scale: 0.6,
    radius: 6.0,
    fire_rate: 2.5,
    max_ammo: 16,
    max_range: 120.0,
    projectile_speed: 80.0,
    gravity: 3.0,
    delivery: DeliveryMethod::Projectile,
};
