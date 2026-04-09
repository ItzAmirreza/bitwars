//! Weapon system for bot training simulation.
//!
//! Uses the default infantry loadout from shared/game-constants.json:
//! rifle, shotgun, and RPG.
//! Includes fire rate enforcement, ammo tracking, and projectile physics.

use super::world::EnvTerrain;
use crate::worldgen;

// ── Number of weapons available to the bot ──
pub const NUM_WEAPONS: usize = 3;

// ── Delivery types ──
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Delivery {
    Hitscan,
    Projectile,
}

// ── Weapon definition (matches game-constants.json) ──
#[derive(Clone, Debug)]
#[allow(dead_code)] // All fields match game-constants.json — not all used in current training task
pub struct WeaponDef {
    pub index: u8,
    pub name: &'static str,
    pub damage: u16,
    pub radius: f32,
    pub fire_rate: f32,
    pub max_ammo: u16,
    pub max_range: f32,
    pub projectile_speed: f32,
    pub delivery: Delivery,
    /// Number of pellets (shotgun only)
    pub pellets: u8,
    /// Spread angle (shotgun only)
    pub spread: f32,
    /// Close-range damage threshold (sniper only)
    pub close_range_threshold: f32,
    /// Close-range damage multiplier (sniper only)
    pub close_range_damage_mult: f32,
}

/// All weapons available to the bot, indexed 0..2.
pub const WEAPONS: [WeaponDef; NUM_WEAPONS] = [
    // 0: Rifle
    WeaponDef {
        index: 0,
        name: "Rifle",
        damage: 22,
        radius: 0.0,
        fire_rate: 5.0,
        max_ammo: 90,
        max_range: 80.0,
        projectile_speed: 0.0,
        delivery: Delivery::Hitscan,
        pellets: 1,
        spread: 0.0,
        close_range_threshold: 0.0,
        close_range_damage_mult: 1.0,
    },
    // 1: Shotgun
    WeaponDef {
        index: 1,
        name: "Shotgun",
        damage: 15,
        radius: 0.0,
        fire_rate: 1.2,
        max_ammo: 8,
        max_range: 25.0,
        projectile_speed: 0.0,
        delivery: Delivery::Hitscan,
        pellets: 7,
        spread: 0.1,
        close_range_threshold: 0.0,
        close_range_damage_mult: 1.0,
    },
    // 2: RPG
    WeaponDef {
        index: 2,
        name: "RPG",
        damage: 70,
        radius: 3.5,
        fire_rate: 1.0,
        max_ammo: 12,
        max_range: 80.0,
        projectile_speed: 120.0,
        delivery: Delivery::Projectile,
        pellets: 1,
        spread: 0.0,
        close_range_threshold: 0.0,
        close_range_damage_mult: 1.0,
    },
];

// ── Fire rate tolerance (150ms = 0.15s, matching server's 150000us) ──
const FIRE_RATE_TOLERANCE: f32 = 0.15;

// ── Weapon State ──

/// Per-player weapon state: current weapon, ammo, and fire cooldowns.
#[derive(Clone, Debug)]
pub struct WeaponState {
    pub current_weapon: usize,
    pub ammo: [u16; NUM_WEAPONS],
    pub last_fire_times: [f32; NUM_WEAPONS],
    /// Simulation clock (seconds)
    pub sim_time: f32,
}

impl WeaponState {
    pub fn new() -> Self {
        let mut ammo = [0u16; NUM_WEAPONS];
        for i in 0..NUM_WEAPONS {
            ammo[i] = WEAPONS[i].max_ammo;
        }
        WeaponState {
            current_weapon: 0,
            ammo,
            last_fire_times: [f32::NEG_INFINITY; NUM_WEAPONS],
            sim_time: 0.0,
        }
    }

    /// Check if a specific weapon can fire (has ammo and cooldown elapsed).
    pub fn can_fire(&self, weapon_idx: usize) -> bool {
        if weapon_idx >= NUM_WEAPONS {
            return false;
        }
        if self.ammo[weapon_idx] == 0 {
            return false;
        }
        let def = &WEAPONS[weapon_idx];
        let cooldown = 1.0 / def.fire_rate;
        let elapsed = self.sim_time - self.last_fire_times[weapon_idx];
        elapsed >= cooldown - FIRE_RATE_TOLERANCE
    }

    /// Attempt to fire a specific weapon. Deducts ammo and records fire time.
    /// Returns true on success.
    pub fn fire(&mut self, weapon_idx: usize) -> bool {
        if !self.can_fire(weapon_idx) {
            return false;
        }
        self.ammo[weapon_idx] -= 1;
        self.last_fire_times[weapon_idx] = self.sim_time;
        true
    }

    /// Instantly reload a weapon to max ammo (matches real game's instant infantry reload).
    pub fn reload(&mut self, weapon_idx: usize) {
        if weapon_idx < NUM_WEAPONS {
            self.ammo[weapon_idx] = WEAPONS[weapon_idx].max_ammo;
        }
    }

    /// Reset all ammo to max and clear cooldowns.
    pub fn reset(&mut self) {
        for i in 0..NUM_WEAPONS {
            self.ammo[i] = WEAPONS[i].max_ammo;
        }
        self.last_fire_times = [f32::NEG_INFINITY; NUM_WEAPONS];
        self.sim_time = 0.0;
        self.current_weapon = 0;
    }

    /// Switch to a weapon index (clamped to valid range).
    pub fn select_weapon(&mut self, idx: usize) {
        self.current_weapon = idx.min(NUM_WEAPONS - 1);
    }

    /// Tick the sim time forward.
    pub fn tick(&mut self, dt: f32) {
        self.sim_time += dt;
    }
}

// ── Projectile (RPG) ──

/// Gravity for client-side infantry projectiles.
/// From client WeaponRegistry: RPG gravity = 2.0.
const RPG_GRAVITY: f32 = 2.0;

fn projectile_gravity(weapon_idx: usize) -> f32 {
    match weapon_idx {
        2 => RPG_GRAVITY, // RPG
        _ => 0.0,
    }
}

#[derive(Clone, Debug)]
pub struct Projectile {
    pub pos_x: f32,
    pub pos_y: f32,
    pub pos_z: f32,
    pub vel_x: f32,
    pub vel_y: f32,
    pub vel_z: f32,
    pub weapon_idx: usize,
    pub time_alive: f32,
}

impl Projectile {
    pub fn new(
        pos_x: f32,
        pos_y: f32,
        pos_z: f32,
        dir_x: f32,
        dir_y: f32,
        dir_z: f32,
        weapon_idx: usize,
    ) -> Self {
        let def = &WEAPONS[weapon_idx];
        let speed = def.projectile_speed;
        // Normalize direction
        let len = (dir_x * dir_x + dir_y * dir_y + dir_z * dir_z).sqrt();
        let (nx, ny, nz) = if len > 0.001 {
            (dir_x / len, dir_y / len, dir_z / len)
        } else {
            (0.0, 0.0, -1.0)
        };
        Projectile {
            pos_x,
            pos_y,
            pos_z,
            vel_x: nx * speed,
            vel_y: ny * speed,
            vel_z: nz * speed,
            weapon_idx,
            time_alive: 0.0,
        }
    }

    /// Tick the projectile forward. Returns true if it should be removed
    /// (hit terrain or exceeded lifetime/range).
    pub fn tick(&mut self, dt: f32, world: &EnvTerrain) -> bool {
        let gravity = projectile_gravity(self.weapon_idx);

        // Apply gravity
        self.vel_y -= gravity * dt;

        // Match the client projectile manager's per-frame tunneling prevention by
        // subdividing large projectile steps into 1-block segments.
        let speed =
            (self.vel_x * self.vel_x + self.vel_y * self.vel_y + self.vel_z * self.vel_z).sqrt();
        let step_dist = speed * dt;
        let sub_steps = step_dist.ceil().max(1.0) as u32;
        let sub_dist = step_dist / sub_steps as f32;
        let (dir_x, dir_y, dir_z) = if speed > 1e-5 {
            (self.vel_x / speed, self.vel_y / speed, self.vel_z / speed)
        } else {
            (0.0, 0.0, 0.0)
        };

        for _ in 0..sub_steps {
            self.pos_x += dir_x * sub_dist;
            self.pos_y += dir_y * sub_dist;
            self.pos_z += dir_z * sub_dist;

            let bx = self.pos_x.floor() as i32;
            let by = self.pos_y.floor() as i32;
            let bz = self.pos_z.floor() as i32;
            if world.get_block(bx, by, bz) != worldgen::AIR {
                return true;
            }
        }

        self.time_alive += dt;

        // Check lifetime (5 seconds max for all projectiles)
        if self.time_alive > 5.0 {
            return true;
        }

        // Check world bounds
        if self.pos_x < 0.0
            || self.pos_x >= worldgen::WORLD_SIZE_X as f32
            || self.pos_z < 0.0
            || self.pos_z >= worldgen::WORLD_SIZE_Z as f32
            || self.pos_y < -10.0
            || self.pos_y > worldgen::WORLD_SIZE_Y as f32 + 20.0
        {
            return true;
        }

        false
    }

    /// Get the impact position (current position).
    pub fn impact_pos(&self) -> (f32, f32, f32) {
        (self.pos_x, self.pos_y, self.pos_z)
    }
}
