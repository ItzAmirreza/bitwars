// ── BitWars Server ──
// Modular SpacetimeDB game server.
//
// Architecture:
//   types       - Shared data types (Vec3, Rotation, etc.)
//   constants   - All game tuning parameters
//   tables      - All SpacetimeDB table definitions
//   worldgen    - Procedural world generation (biomes, structures, terrain)
//
//   weapons/    - Weapon registry + per-weapon definitions
//     mod.rs       - WeaponDef struct, registry, ammo accessors
//     rifle.rs     - Rifle stats
//     shotgun.rs   - Shotgun stats
//     rpg.rs       - RPG stats
//     machinegun.rs - Machine Gun stats
//     grenade_launcher.rs - Grenade Launcher stats
//     vehicle_minigun.rs  - Vehicle Minigun stats
//     vehicle_rockets.rs  - Vehicle Rockets stats
//
//   combat/     - Damage resolution + weapon fire reducers
//     damage.rs    - Shared hitscan/splash/kill resolution
//     fire.rs      - fire_weapon, reload_weapon reducers
//     projectile.rs - projectile_impact reducer
//     blocks.rs    - destroy_blocks_physics, sync_entity_transform
//
//   vehicles/   - Vehicle system with per-type physics
//     mod.rs       - tick_vehicles dispatcher
//     helicopter.rs - Helicopter physics simulation
//     interaction.rs - Mount/dismount/input reducers
//     weapons.rs   - Vehicle weapon fire/reload reducers
//     spawning.rs  - Vehicle spawn logic
//
//   helpers     - Shared utility functions (math, entity ops, state management)
//   chunks      - Chunk queries, block destruction, structural integrity
//   grenades    - Grenade physics simulation
//   player      - Player movement, respawn, loadout management
//   admin       - Admin chat commands
//   chat        - Chat system and command routing
//   lifecycle   - init, client_connected, client_disconnected
//   environment - Day/night cycle, weather transitions
//   cleanup     - Scheduled event cleanup, health regeneration
//   map         - Map reset, chunk requests

pub mod abilities;
pub mod admin;
pub mod chat;
pub mod chunks;
pub mod cleanup;
pub mod combat;
pub mod constants;
pub mod environment;
pub mod grenades;
pub mod helpers;
pub mod lifecycle;
pub mod map;
pub mod matchmaking;
pub mod player;
pub mod shared_config;
pub mod tables;
pub mod types;
pub mod vehicles;
pub mod weapons;
pub mod worldgen;
