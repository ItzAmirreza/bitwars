//! Weapon system for bot training simulation.
//!
//! Weapon definitions match shared/game-constants.json exactly.
//! Includes fire rate enforcement, ammo tracking, projectile physics,
//! and grenade physics (ported from server/grenades.rs).

use super::world::EnvTerrain;
use crate::worldgen;

// ── Number of weapons ──
pub const NUM_WEAPONS: usize = 6;

// ── Delivery types ──
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Delivery {
    Hitscan,
    Projectile,
    ServerProjectile, // grenades -- server-authoritative
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

/// All weapons from game-constants.json, indexed by weapon index.
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
    // 3: Machine Gun
    WeaponDef {
        index: 3,
        name: "Machine Gun",
        damage: 11,
        radius: 0.0,
        fire_rate: 13.0,
        max_ammo: 200,
        max_range: 90.0,
        projectile_speed: 0.0,
        delivery: Delivery::Hitscan,
        pellets: 1,
        spread: 0.0,
        close_range_threshold: 0.0,
        close_range_damage_mult: 1.0,
    },
    // 4: Grenade Launcher
    WeaponDef {
        index: 4,
        name: "Grenade Launcher",
        damage: 75,
        radius: 4.8,
        fire_rate: 1.4,
        max_ammo: 14,
        max_range: 85.0,
        projectile_speed: 48.0,
        delivery: Delivery::ServerProjectile,
        pellets: 1,
        spread: 0.0,
        close_range_threshold: 0.0,
        close_range_damage_mult: 1.0,
    },
    // 5: Sniper
    WeaponDef {
        index: 5,
        name: "Sniper",
        damage: 85,
        radius: 0.0,
        fire_rate: 0.7,
        max_ammo: 5,
        max_range: 200.0,
        projectile_speed: 280.0,
        delivery: Delivery::Projectile,
        pellets: 1,
        spread: 0.0,
        close_range_threshold: 30.0,
        close_range_damage_mult: 0.35,
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

// ── Projectile (RPG / Sniper) ──

/// Gravity for client-side infantry projectiles.
/// From client WeaponRegistry: RPG gravity = 2.0, Sniper gravity = 0.0.
const RPG_GRAVITY: f32 = 2.0;
const SNIPER_GRAVITY: f32 = 0.0;

fn projectile_gravity(weapon_idx: usize) -> f32 {
    match weapon_idx {
        2 => RPG_GRAVITY,
        5 => SNIPER_GRAVITY,
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

        // Move
        self.pos_x += self.vel_x * dt;
        self.pos_y += self.vel_y * dt;
        self.pos_z += self.vel_z * dt;

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

        // Check terrain collision
        let bx = self.pos_x.floor() as i32;
        let by = self.pos_y.floor() as i32;
        let bz = self.pos_z.floor() as i32;
        if world.get_block(bx, by, bz) != worldgen::AIR {
            return true;
        }

        false
    }

    /// Get the impact position (current position).
    pub fn impact_pos(&self) -> (f32, f32, f32) {
        (self.pos_x, self.pos_y, self.pos_z)
    }
}

// ── Grenade Physics (exact port from server/grenades.rs) ──

// Constants from game-constants.json grenade section
const GRENADE_GRAVITY: f32 = 18.0;
const GRENADE_BOUNCE_RESTITUTION: f32 = 0.45;
const GRENADE_BOUNCE_FRICTION: f32 = 0.7;
const GRENADE_GROUND_FRICTION: f32 = 0.96;
const GRENADE_MIN_BOUNCE_VEL: f32 = 1.5;
const GRENADE_RADIUS: f32 = 0.19;
const GRENADE_FUSE_MS: u32 = 5000;
const GRENADE_TICK_INTERVAL_MS: u32 = 33;
/// Weapon index for grenades (from game-constants.json)
pub const GRENADE_WEAPON_INDEX: usize = 4;

#[derive(Clone, Debug)]
pub struct Grenade {
    #[allow(dead_code)]
    pub id: u64,
    pub pos_x: f32,
    pub pos_y: f32,
    pub pos_z: f32,
    pub vel_x: f32,
    pub vel_y: f32,
    pub vel_z: f32,
    pub fuse_remaining_ms: u32,
}

impl Grenade {
    pub fn new(
        id: u64,
        pos_x: f32,
        pos_y: f32,
        pos_z: f32,
        vel_x: f32,
        vel_y: f32,
        vel_z: f32,
    ) -> Self {
        Grenade {
            id,
            pos_x,
            pos_y,
            pos_z,
            vel_x,
            vel_y,
            vel_z,
            fuse_remaining_ms: GRENADE_FUSE_MS,
        }
    }
}

/// Grenade system: manages active grenades and ticks their physics.
#[derive(Clone, Debug)]
pub struct GrenadeSystem {
    pub grenades: Vec<Grenade>,
    next_id: u64,
    /// Accumulator for fixed-timestep ticks
    accumulator_ms: f32,
}

impl GrenadeSystem {
    pub fn new() -> Self {
        GrenadeSystem {
            grenades: Vec::new(),
            next_id: 1,
            accumulator_ms: 0.0,
        }
    }

    /// Spawn a new grenade.
    pub fn spawn(
        &mut self,
        pos_x: f32,
        pos_y: f32,
        pos_z: f32,
        vel_x: f32,
        vel_y: f32,
        vel_z: f32,
    ) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.grenades
            .push(Grenade::new(id, pos_x, pos_y, pos_z, vel_x, vel_y, vel_z));
        id
    }

    /// Tick all grenades. Uses fixed 33ms timestep (matching server).
    /// Returns positions of exploded grenades.
    pub fn tick(&mut self, dt: f32, world: &EnvTerrain) -> Vec<(f32, f32, f32)> {
        let mut explosions = Vec::new();
        self.accumulator_ms += dt * 1000.0;

        while self.accumulator_ms >= GRENADE_TICK_INTERVAL_MS as f32 {
            self.accumulator_ms -= GRENADE_TICK_INTERVAL_MS as f32;
            let tick_explosions = self.tick_once(world);
            explosions.extend(tick_explosions);
        }

        explosions
    }

    /// Single fixed-timestep grenade tick (33ms), matching server/grenades.rs exactly.
    fn tick_once(&mut self, world: &EnvTerrain) -> Vec<(f32, f32, f32)> {
        let mut explosions = Vec::new();
        let dt = GRENADE_TICK_INTERVAL_MS as f32 / 1000.0;
        let tick_ms = GRENADE_TICK_INTERVAL_MS;

        let mut i = 0;
        while i < self.grenades.len() {
            let g = &mut self.grenades[i];

            // Check fuse
            if g.fuse_remaining_ms <= tick_ms {
                explosions.push((g.pos_x, g.pos_y, g.pos_z));
                self.grenades.swap_remove(i);
                continue;
            }
            g.fuse_remaining_ms -= tick_ms;

            // Gravity
            g.vel_y -= GRENADE_GRAVITY * dt;

            let mut new_x = g.pos_x + g.vel_x * dt;
            let mut new_y = g.pos_y + g.vel_y * dt;
            let mut new_z = g.pos_z + g.vel_z * dt;

            let bx = new_x.floor() as i32;
            let bz = new_z.floor() as i32;

            // Y collision
            let block_below_y = (new_y - GRENADE_RADIUS).floor() as i32;
            let block_above_y = (new_y + GRENADE_RADIUS).ceil() as i32;
            let block_below = world.get_block(bx, block_below_y, bz);
            let block_above = world.get_block(bx, block_above_y, bz);

            if block_below != worldgen::AIR && g.vel_y < 0.0 {
                new_y = (new_y - GRENADE_RADIUS).floor() as f32 + 1.0 + GRENADE_RADIUS;
                if g.vel_y.abs() < GRENADE_MIN_BOUNCE_VEL {
                    g.vel_y = 0.0;
                    g.vel_x *= GRENADE_GROUND_FRICTION;
                    g.vel_z *= GRENADE_GROUND_FRICTION;
                } else {
                    g.vel_y = -g.vel_y * GRENADE_BOUNCE_RESTITUTION;
                    g.vel_x *= GRENADE_BOUNCE_FRICTION;
                    g.vel_z *= GRENADE_BOUNCE_FRICTION;
                }
            } else if block_above != worldgen::AIR && g.vel_y > 0.0 {
                new_y = (new_y + GRENADE_RADIUS).ceil() as f32 - GRENADE_RADIUS;
                g.vel_y = -g.vel_y * GRENADE_BOUNCE_RESTITUTION;
            }

            // X collision
            let check_x_neg_x = (new_x - GRENADE_RADIUS).floor() as i32;
            let check_x_pos_x = (new_x + GRENADE_RADIUS).ceil() as i32;
            let by_floor = new_y.floor() as i32;

            let block_x_neg = world.get_block(check_x_neg_x, by_floor, bz);
            let block_x_pos = world.get_block(check_x_pos_x, by_floor, bz);

            if block_x_neg != worldgen::AIR && g.vel_x < 0.0 {
                new_x = (new_x - GRENADE_RADIUS).floor() as f32 + 1.0 + GRENADE_RADIUS;
                g.vel_x = -g.vel_x * GRENADE_BOUNCE_RESTITUTION;
                g.vel_z *= GRENADE_BOUNCE_FRICTION;
            } else if block_x_pos != worldgen::AIR && g.vel_x > 0.0 {
                new_x = (new_x + GRENADE_RADIUS).ceil() as f32 - GRENADE_RADIUS;
                g.vel_x = -g.vel_x * GRENADE_BOUNCE_RESTITUTION;
                g.vel_z *= GRENADE_BOUNCE_FRICTION;
            }

            // Z collision
            let check_z_neg_z = (new_z - GRENADE_RADIUS).floor() as i32;
            let check_z_pos_z = (new_z + GRENADE_RADIUS).ceil() as i32;

            let block_z_neg = world.get_block(bx, by_floor, check_z_neg_z);
            let block_z_pos = world.get_block(bx, by_floor, check_z_pos_z);

            if block_z_neg != worldgen::AIR && g.vel_z < 0.0 {
                new_z = (new_z - GRENADE_RADIUS).floor() as f32 + 1.0 + GRENADE_RADIUS;
                g.vel_z = -g.vel_z * GRENADE_BOUNCE_RESTITUTION;
                g.vel_x *= GRENADE_BOUNCE_FRICTION;
            } else if block_z_pos != worldgen::AIR && g.vel_z > 0.0 {
                new_z = (new_z + GRENADE_RADIUS).ceil() as f32 - GRENADE_RADIUS;
                g.vel_z = -g.vel_z * GRENADE_BOUNCE_RESTITUTION;
                g.vel_x *= GRENADE_BOUNCE_FRICTION;
            }

            // World bounds
            new_x = new_x.clamp(0.5, worldgen::WORLD_SIZE_X as f32 - 0.5);
            new_z = new_z.clamp(0.5, worldgen::WORLD_SIZE_Z as f32 - 0.5);

            if new_y < -5.0 {
                explosions.push((g.pos_x, g.pos_y, g.pos_z));
                self.grenades.swap_remove(i);
                continue;
            }

            if new_y > worldgen::WORLD_SIZE_Y as f32 + 20.0 {
                new_y = worldgen::WORLD_SIZE_Y as f32 + 20.0;
                if g.vel_y > 0.0 {
                    g.vel_y = -g.vel_y * GRENADE_BOUNCE_RESTITUTION;
                }
            }

            // Stop very slow horizontal movement
            let speed_sq = g.vel_x * g.vel_x + g.vel_z * g.vel_z;
            if speed_sq < 0.01 {
                g.vel_x = 0.0;
                g.vel_z = 0.0;
            }

            g.pos_x = new_x;
            g.pos_y = new_y;
            g.pos_z = new_z;

            i += 1;
        }

        explosions
    }

    /// Clear all grenades.
    pub fn reset(&mut self) {
        self.grenades.clear();
        self.accumulator_ms = 0.0;
    }
}
