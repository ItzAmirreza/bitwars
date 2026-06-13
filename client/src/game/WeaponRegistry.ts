/**
 * WeaponRegistry — The single source of truth for all weapon data on the client.
 *
 * Merges shared JSON stats (damage, fireRate, ammo, etc.) with client-only
 * rendering properties (projectileConfig, SVG component references, HUD colors).
 */
import {
  WEAPONS_CONFIG,
  VEHICLE_WEAPONS_CONFIG,
  NUM_WEAPONS,
  NUM_VEHICLE_WEAPONS,
} from '../shared-config';
import type { WeaponConfig, VehicleWeaponConfig } from '../shared-config';

// ── Client-only projectile visual config ──

export interface ProjectileConfig {
  speed: number;           // units/sec (Infinity = hitscan)
  gravity: number;         // downward acceleration (0 = no drop)
  size: number;            // visual radius of projectile mesh
  trailLength: number;     // trail particle spacing (0 = no trail)
  trailColor: number;      // trail color hex
  lightIntensity: number;  // point light intensity (0 = none)
  lightColor: number;      // point light color hex
  lightRange: number;      // point light range
  lifetime: number;        // max seconds before despawn
}

// ── Weapon definition: shared stats + client-only rendering data ──

export interface WeaponDefinition {
  // From shared JSON
  index: number;
  name: string;
  damage: number;
  radius: number;
  fireRate: number;
  maxAmmo: number;
  maxRange: number;
  delivery: string;
  color: string;
  recoil: number;

  // Client-only: HUD display
  hudName: string;           // Uppercase display name for HUD
  hudType: 'HITSCAN' | 'EXPLOSIVE';
  hudColor: string;          // CSS var color for HUD text
  hudRawColor: string;       // Raw hex color for HUD borders/glows
  description: string;       // Short description for loadout overlay

  // Client-only: projectile visual config
  projectile: ProjectileConfig;
}

// ── Vehicle weapon definition ──

export interface VehicleWeaponDefinition {
  index: number;
  name: string;
  damage: number;
  radius: number;
  fireRate: number;
  maxAmmo: number;
  maxRange: number;
  projectileSpeed: number;
  gravity: number;
  delivery: string;
  color: string;
  reloadTime: number;

  // Client-only rendering
  hudType: 'HITSCAN' | 'EXPLOSIVE';
  spread: { x: number; y: number };
}

// ── HUD type colors ──

const TYPE_COLORS = {
  HITSCAN:   { hudColor: 'var(--c-cyan)', hudRawColor: '#66e0ff' },
  EXPLOSIVE: { hudColor: 'var(--c-amber)', hudRawColor: '#ff9800' },
} as const;

// ── Client-only projectile configs (purely visual — not gameplay) ──

const HITSCAN_PROJECTILE: ProjectileConfig = {
  speed: Infinity, gravity: 0, size: 0, trailLength: 0,
  trailColor: 0, lightIntensity: 0, lightColor: 0, lightRange: 0, lifetime: 0,
};

const CLIENT_PROJECTILE_CONFIGS: Record<number, ProjectileConfig> = {
  // RPG (index 2)
  2: {
    speed: 120, gravity: 2, size: 0.2, trailLength: 0.55,
    trailColor: 0xff6600, lightIntensity: 3.0, lightColor: 0xff4400, lightRange: 8, lifetime: 5,
  },
  // Grenade Launcher (index 4)
  4: {
    speed: 48, gravity: 8, size: 0.24, trailLength: 0.4,
    trailColor: 0x8dff66, lightIntensity: 2.8, lightColor: 0x9dff44, lightRange: 9, lifetime: 5,
  },
  // Sniper (index 5) — fast bullet, bright purple tracer, no gravity
  5: {
    speed: 280, gravity: 0, size: 0.07, trailLength: 0.32,
    trailColor: 0xd060ff, lightIntensity: 2.5, lightColor: 0xe040ff, lightRange: 6, lifetime: 3,
  },
};

// ── Client-only recoil feel profiles ──
// Recoil is purely a client-side feel parameter (the server never simulates it),
// so per-weapon recoil patterns live here alongside the other client-only tuning
// (projectile configs, vehicle spreads). The shared JSON `recoil` scalar is kept
// separately for the cosmetic first-person gun-model kick (WeaponModel.triggerRecoil).
export interface RecoilProfile {
  vertical: number;       // upward pitch kick per shot (radians)
  horizontal: number;     // max abs horizontal yaw kick per shot (radians, random sign)
  recovery: number;       // exponential recovery rate back to aim (per second)
  bloom: number;          // crosshair spread added per shot
  bloomMax: number;       // ceiling for accumulated fire bloom (0..1)
  bloomRecovery: number;  // bloom recovery rate (per second)
}

const DEFAULT_RECOIL: RecoilProfile = {
  vertical: 0.02, horizontal: 0.006, recovery: 12, bloom: 0.08, bloomMax: 0.5, bloomRecovery: 6,
};

const RECOIL_PROFILES: Record<number, RecoilProfile> = {
  // Rifle — crisp upward tick, tight horizontal, fast settle. Controllable.
  0: { vertical: 0.013, horizontal: 0.004, recovery: 14, bloom: 0.06, bloomMax: 0.45, bloomRecovery: 7 },
  // Shotgun — heavy single punch, slow settle.
  1: { vertical: 0.05, horizontal: 0.012, recovery: 8, bloom: 0.3, bloomMax: 0.6, bloomRecovery: 4 },
  // RPG — moderate kick (most weight comes from gun model + shake).
  2: { vertical: 0.04, horizontal: 0.008, recovery: 9, bloom: 0.2, bloomMax: 0.4, bloomRecovery: 4 },
  // Machine Gun — light per-shot kick that accumulates into a climb over a burst.
  3: { vertical: 0.009, horizontal: 0.006, recovery: 7, bloom: 0.05, bloomMax: 0.75, bloomRecovery: 5 },
  // Grenade Launcher — moderate kick.
  4: { vertical: 0.045, horizontal: 0.008, recovery: 9, bloom: 0.2, bloomMax: 0.4, bloomRecovery: 4 },
  // Sniper — big vertical kick, slow resettle (rewards re-aiming between shots).
  5: { vertical: 0.07, horizontal: 0.005, recovery: 6, bloom: 0.4, bloomMax: 0.5, bloomRecovery: 3 },
};

export function getRecoilProfile(index: number): RecoilProfile {
  return RECOIL_PROFILES[index] ?? DEFAULT_RECOIL;
}

// ── Client-only HUD descriptions ──

const WEAPON_DESCRIPTIONS: Record<number, string> = {
  0: 'Versatile assault rifle. Reliable at any range.',
  1: '7-pellet spread. Devastating up close, weak at range.',
  2: 'Explosive rocket. Destroys terrain and players.',
  3: 'Rapid fire suppression. Best sustained DPS.',
  4: 'Arcing grenades. Largest blast radius.',
  5: 'Bolt-action sniper. Visible tracer, extreme range.',
};

// ── Build weapon definitions by merging shared + client data ──

function buildWeaponDefinition(cfg: WeaponConfig): WeaponDefinition {
  const isExplosive = cfg.radius > 0;
  const typeKey = isExplosive ? 'EXPLOSIVE' : 'HITSCAN';
  const colors = TYPE_COLORS[typeKey];
  const projectile = CLIENT_PROJECTILE_CONFIGS[cfg.index] ?? HITSCAN_PROJECTILE;

  return {
    index: cfg.index,
    name: cfg.name,
    damage: cfg.damage,
    radius: cfg.radius,
    fireRate: cfg.fireRate,
    maxAmmo: cfg.maxAmmo,
    maxRange: cfg.maxRange,
    delivery: cfg.delivery,
    color: cfg.color,
    recoil: cfg.recoil,

    hudName: cfg.name.toUpperCase(),
    hudType: typeKey,
    hudColor: colors.hudColor,
    hudRawColor: colors.hudRawColor,
    description: WEAPON_DESCRIPTIONS[cfg.index] ?? '',

    projectile,
  };
}

function buildVehicleWeaponDefinition(cfg: VehicleWeaponConfig): VehicleWeaponDefinition {
  const isExplosive = cfg.radius > 0;
  const spreads: Record<number, { x: number; y: number }> = {
    0: { x: 0.035, y: 0.02 },  // Minigun
    1: { x: 0, y: 0 },          // Rockets
    2: { x: 0, y: 0 },          // Kinetic Penetrator
    3: { x: 0, y: 0 },          // Carpet Bomb
    4: { x: 0.03, y: 0.02 },   // CRAM
    5: { x: 0, y: 0 },          // SAM Missile
    6: { x: 0, y: 0 },          // Air Missile
  };

  return {
    index: cfg.index,
    name: cfg.name,
    damage: cfg.damage,
    radius: cfg.radius,
    fireRate: cfg.fireRate,
    maxAmmo: cfg.maxAmmo,
    maxRange: cfg.maxRange,
    projectileSpeed: cfg.projectileSpeed,
    gravity: cfg.gravity,
    delivery: cfg.delivery,
    color: cfg.color,
    reloadTime: cfg.reloadTime,

    hudType: isExplosive ? 'EXPLOSIVE' : 'HITSCAN',
    spread: spreads[cfg.index] ?? { x: 0, y: 0 },
  };
}

// ── Exported registry arrays ──

export const WEAPON_DEFINITIONS: WeaponDefinition[] = WEAPONS_CONFIG.map(buildWeaponDefinition);
export const VEHICLE_WEAPON_DEFINITIONS: VehicleWeaponDefinition[] = VEHICLE_WEAPONS_CONFIG.map(buildVehicleWeaponDefinition);

// ── Exported accessors ──

export { NUM_WEAPONS, NUM_VEHICLE_WEAPONS };

export const WEAPON_NAMES: string[] = WEAPON_DEFINITIONS.map((w) => w.name);
export const WEAPON_INDEXES: readonly number[] = WEAPON_DEFINITIONS.map((w) => w.index);

export function getWeapon(index: number): WeaponDefinition {
  return WEAPON_DEFINITIONS[index];
}

export function getVehicleWeapon(index: number): VehicleWeaponDefinition {
  return VEHICLE_WEAPON_DEFINITIONS[index];
}

/** HUD data for weapon slots / loadout overlay */
export function getWeaponHudData(index: number) {
  const w = WEAPON_DEFINITIONS[index];
  return {
    name: w.hudName,
    type: w.hudType,
    color: w.hudColor,
    rawColor: w.hudRawColor,
    desc: w.description,
    damage: w.damage,
    fireRate: w.fireRate,
    range: w.maxRange,
    ammo: w.maxAmmo,
  };
}

/** HUD data for vehicle weapon display */
export function getVehicleWeaponHudData(index: number) {
  const vw = VEHICLE_WEAPON_DEFINITIONS[index];
  return {
    name: vw.name,
    type: vw.hudType,
    color: vw.color,
    maxAmmo: vw.maxAmmo,
    fireRate: vw.fireRate,
    damage: vw.damage,
  };
}
