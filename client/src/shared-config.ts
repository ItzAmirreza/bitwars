/**
 * Typed accessors for the shared game constants JSON.
 * This is the single import point for all shared config on the client.
 */
import config from '../../shared/game-constants.json';

// ── Re-export entire sections ──
export const WORLD = config.world;
export const BLOCK_TYPES = config.blockTypes;
export const ENTITY_KINDS = config.entityKinds;
export const VEHICLE_TYPES = config.vehicleTypes;
export const PLAYER = config.player;
export const WEAPONS_CONFIG = config.weapons;
export const VEHICLE_WEAPONS_CONFIG = config.vehicleWeapons;
export const HELICOPTER = config.helicopter;
export const FIGHTER_JET = config.fighterJet;
export const ANTI_AIR = config.antiAir;
export const HOVER = config.hover;
export const GRENADE = config.grenade;
export const VEHICLE_BLOCK_COLLISION = config.vehicleBlockCollision;
export const COMBAT = config.combat;
export const MATCH = config.match;
export const WEATHER = config.weather;
export const ABILITIES = config.abilities;

// ── Block colors ──
// Stored in the shared config as hex strings keyed by block-type name.
// Derived here into the numeric (blockTypeIndex → 0xRRGGBB) map the renderer wants.
export const BLOCK_COLORS: Record<number, number> = Object.fromEntries(
  Object.entries(config.blockColors).map(([name, hex]) => [
    (config.blockTypes as Record<string, number>)[name],
    parseInt(hex.slice(1), 16),
  ]),
);

// ── Weather names (ordered by weather index) ──
export const WEATHER_NAMES = config.weather.map((w) => w.name);

// ── Vehicle physics ──
export const VEHICLE_TICK_INTERVAL_MS = config.vehicleTickIntervalMs;

// ── Convenience helpers ──
export const NUM_WEAPONS = config.weapons.length;
export const NUM_VEHICLE_WEAPONS = config.vehicleWeapons.length;

export function getWeaponConfig(index: number) {
  return config.weapons[index];
}

export function getVehicleWeaponConfig(index: number) {
  return config.vehicleWeapons[index];
}

// ── Type exports ──
export type WeaponConfig = (typeof config.weapons)[number];
export type VehicleWeaponConfig = (typeof config.vehicleWeapons)[number];
export type BlockTypeName = keyof typeof config.blockTypes;
