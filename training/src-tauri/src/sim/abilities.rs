//! Ability / buff / pickup system for training simulation.
//!
//! Implements ability pickups, active buffs, and their effects.
//! All constants match game-constants.json abilities section.

use super::world::EnvTerrain;
use crate::worldgen;

// ── Constants from game-constants.json ──

pub const SPEED_BOOST_DURATION: f32 = 12.0;
pub const SPEED_BOOST_MULTIPLIER: f32 = 2.4;
pub const DOUBLE_DAMAGE_DURATION: f32 = 7.5;
pub const DOUBLE_DAMAGE_MULTIPLIER: f32 = 2.0;
pub const SHIELD_DURATION: f32 = 15.0;
pub const SHIELD_DAMAGE_REDUCTION: f32 = 0.5;
pub const PICKUP_RADIUS: f32 = 2.0;
pub const PICKUP_RESPAWN_SECS: f32 = 45.0;
pub const MAX_ACTIVE_PICKUPS: usize = 12;

// ── Ability Type ──

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum AbilityType {
    HealthRegen = 0,
    DoubleDamage = 1,
    SpeedBoost = 2,
    Shield = 3,
}

impl AbilityType {
    /// Get the duration for this ability type.
    pub fn duration(self) -> f32 {
        match self {
            AbilityType::HealthRegen => 10.0, // health regen is instant effect, timer unused
            AbilityType::DoubleDamage => DOUBLE_DAMAGE_DURATION,
            AbilityType::SpeedBoost => SPEED_BOOST_DURATION,
            AbilityType::Shield => SHIELD_DURATION,
        }
    }

    /// Get all ability types for random selection.
    pub fn all() -> &'static [AbilityType] {
        &[
            AbilityType::HealthRegen,
            AbilityType::DoubleDamage,
            AbilityType::SpeedBoost,
            AbilityType::Shield,
        ]
    }
}

// ── Pickup ──

/// An ability pickup placed in the world.
#[derive(Clone, Debug)]
pub struct AbilityPickup {
    pub id: u32,
    pub pos_x: f32,
    pub pos_y: f32,
    pub pos_z: f32,
    pub ability_type: AbilityType,
    /// Time remaining before this pickup respawns (0 = available).
    pub respawn_timer: f32,
}

impl AbilityPickup {
    pub fn is_available(&self) -> bool {
        self.respawn_timer <= 0.0
    }
}

// ── Active Buff ──

/// An active buff on the player.
#[derive(Clone, Debug)]
pub struct Buff {
    pub ability_type: AbilityType,
    pub remaining_secs: f32,
}

// ── Ability System ──

/// Manages ability pickups and active buffs for one environment.
#[derive(Clone, Debug)]
pub struct AbilitySystem {
    pub pickups: Vec<AbilityPickup>,
    pub active_buffs: Vec<Buff>,
    next_pickup_id: u32,
}

impl AbilitySystem {
    pub fn new() -> Self {
        AbilitySystem {
            pickups: Vec::new(),
            active_buffs: Vec::new(),
            next_pickup_id: 1,
        }
    }

    /// Spawn pickups at random valid ground positions in the world.
    /// Uses a simple deterministic hash for placement.
    pub fn spawn_pickups(&mut self, world: &EnvTerrain, seed: u64, count: usize) {
        self.pickups.clear();
        let count = count.min(MAX_ACTIVE_PICKUPS);
        let ability_types = AbilityType::all();
        let mut placed = 0u32;
        let mut attempt = 0u64;

        while (placed as usize) < count && attempt < count as u64 * 20 {
            // Deterministic pseudo-random position from seed + attempt
            let hash1 = simple_hash(seed, attempt * 3);
            let hash2 = simple_hash(seed, attempt * 3 + 1);
            let hash3 = simple_hash(seed, attempt * 3 + 2);

            let x = 20.0 + (hash1 % (worldgen::WORLD_SIZE_X as u64 - 40)) as f32;
            let z = 20.0 + (hash2 % (worldgen::WORLD_SIZE_Z as u64 - 40)) as f32;

            // Find ground height
            let ground_y = world.get_ground_height_below(x, worldgen::WORLD_SIZE_Y as f32, z);
            if ground_y < 0 {
                attempt += 1;
                continue;
            }

            let y = ground_y as f32 + 1.5; // float above ground

            let ability_type = ability_types[(hash3 % ability_types.len() as u64) as usize];

            self.pickups.push(AbilityPickup {
                id: self.next_pickup_id,
                pos_x: x,
                pos_y: y,
                pos_z: z,
                ability_type,
                respawn_timer: 0.0,
            });
            self.next_pickup_id += 1;
            placed += 1;
            attempt += 1;
        }
    }

    /// Try to collect a pickup near the player position.
    /// Returns the ability type if a pickup was collected.
    pub fn try_collect(&mut self, player_pos: (f32, f32, f32)) -> Option<AbilityType> {
        let pickup_radius_sq = PICKUP_RADIUS * PICKUP_RADIUS;

        for pickup in self.pickups.iter_mut() {
            if !pickup.is_available() {
                continue;
            }

            let dx = player_pos.0 - pickup.pos_x;
            let dy = player_pos.1 - pickup.pos_y;
            let dz = player_pos.2 - pickup.pos_z;
            let dist_sq = dx * dx + dy * dy + dz * dz;

            if dist_sq <= pickup_radius_sq {
                let ability_type = pickup.ability_type;
                pickup.respawn_timer = PICKUP_RESPAWN_SECS;

                // Apply the buff
                self.apply_buff(ability_type);
                return Some(ability_type);
            }
        }

        None
    }

    /// Find the nearest currently available pickup to the given player position.
    pub fn nearest_available_pickup(&self, player_pos: (f32, f32, f32)) -> Option<&AbilityPickup> {
        self.pickups
            .iter()
            .filter(|pickup| pickup.is_available())
            .min_by(|a, b| {
                let da = distance_sq(player_pos, (a.pos_x, a.pos_y, a.pos_z));
                let db = distance_sq(player_pos, (b.pos_x, b.pos_y, b.pos_z));
                da.total_cmp(&db)
            })
    }

    /// Apply a buff (replaces existing buff of same type).
    fn apply_buff(&mut self, ability_type: AbilityType) {
        // Remove existing buff of same type
        self.active_buffs.retain(|b| b.ability_type != ability_type);

        // Add new buff
        self.active_buffs.push(Buff {
            ability_type,
            remaining_secs: ability_type.duration(),
        });
    }

    /// Tick buff durations and pickup respawn timers.
    pub fn tick(&mut self, dt: f32) {
        // Tick buff durations
        for buff in self.active_buffs.iter_mut() {
            buff.remaining_secs -= dt;
        }
        self.active_buffs.retain(|b| b.remaining_secs > 0.0);

        // Tick pickup respawn timers
        for pickup in self.pickups.iter_mut() {
            if pickup.respawn_timer > 0.0 {
                pickup.respawn_timer = (pickup.respawn_timer - dt).max(0.0);
            }
        }
    }

    /// Get speed multiplier (2.4 if speed boost active, else 1.0).
    pub fn get_speed_multiplier(&self) -> f32 {
        for buff in &self.active_buffs {
            if buff.ability_type == AbilityType::SpeedBoost {
                return SPEED_BOOST_MULTIPLIER;
            }
        }
        1.0
    }

    /// Get damage reduction factor (0.5 if shield active, else 1.0).
    /// Multiply incoming damage by this value.
    pub fn get_damage_reduction(&self) -> f32 {
        for buff in &self.active_buffs {
            if buff.ability_type == AbilityType::Shield {
                return SHIELD_DAMAGE_REDUCTION;
            }
        }
        1.0
    }

    /// Get damage multiplier (2.0 if double damage active, else 1.0).
    pub fn get_damage_multiplier(&self) -> f32 {
        for buff in &self.active_buffs {
            if buff.ability_type == AbilityType::DoubleDamage {
                return DOUBLE_DAMAGE_MULTIPLIER;
            }
        }
        1.0
    }

    /// Check if a specific buff is active.
    pub fn has_buff(&self, ability_type: AbilityType) -> bool {
        self.active_buffs
            .iter()
            .any(|b| b.ability_type == ability_type)
    }

    /// Reset: clear all buffs and reset all pickup respawn timers.
    pub fn reset(&mut self) {
        self.active_buffs.clear();
        for pickup in self.pickups.iter_mut() {
            pickup.respawn_timer = 0.0;
        }
    }
}

/// Simple deterministic hash for pickup placement.
fn simple_hash(seed: u64, index: u64) -> u64 {
    let mut h = seed.wrapping_mul(6364136223846793005).wrapping_add(index);
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51afd7ed558ccd);
    h ^= h >> 33;
    h = h.wrapping_mul(0xc4ceb9fe1a85ec53);
    h ^= h >> 33;
    h
}

fn distance_sq(a: (f32, f32, f32), b: (f32, f32, f32)) -> f32 {
    let dx = a.0 - b.0;
    let dy = a.1 - b.1;
    let dz = a.2 - b.2;
    dx * dx + dy * dy + dz * dz
}
