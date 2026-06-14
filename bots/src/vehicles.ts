/**
 * Reactive vehicle controllers for bots.
 *
 * Each controller maps the live vehicle transform + a target/goal into the
 * 4-axis vehicle input (forward/strafe/lift/yaw, all [-1,1]) plus a firing
 * decision (which weapon slot + the unit aim direction to pass to
 * fireVehicleWeapon). Pure functions — bot.ts owns state, reducer calls, and
 * target selection. See memory: vehicle-system-map.
 *
 * Control-axis meaning (from server/spacetimedb/src/vehicles/*.rs):
 *   Helicopter: forward=cruise, strafe=sideways, lift=up/down, yaw=turn
 *   FighterJet: forward=throttle/brake, lift=pitch(nose), yaw=turn, strafe=roll(visual)
 *   AntiAir:    yaw=turret yaw, lift=turret pitch, forward/strafe ignored (stationary)
 *   APC:        forward=drive, yaw=steer, strafe/lift ignored
 */

import type { BotVec3 } from './world.ts';

export const VEHICLE_TYPE = {
  HELICOPTER: 0,
  FIGHTER_JET: 1,
  ANTI_AIR: 2,
  APC: 3,
} as const;

// ── Control-axis sign conventions ───────────────────────────────────────────
// These map "intent" (turn left, climb, pitch up) to input sign. They are
// UNVERIFIED until live-tested — if a vehicle turns/climbs the wrong way in the
// real game, flip the corresponding constant here (single source of truth).
const YAW_SIGN = 1; // +yaw input increases entity yaw (turns toward higher yaw)
const HELI_LIFT_SIGN = 1; // +lift = ascend
const JET_PITCH_SIGN = 1; // +lift = nose up (climb)

// ── Tuning ──
const HELI_STANDOFF = 38; // preferred horizontal range to target (m)
const HELI_HEIGHT_ABOVE = 18; // hover this far above the target
const HELI_MAX_FIRE_RANGE = 92;
const JET_THROTTLE = 0.92; // keep well above stall (40)
const JET_CRUISE_ALT = 56; // hold this altitude when airborne (above most structures)

export interface VehicleControl {
  forward: number;
  strafe: number;
  lift: number;
  yaw: number;
  boosting: boolean;
  fire: boolean;
  weaponSlot: number; // slot that must be selected to fire
  aimDir: BotVec3 | null; // unit direction for fireVehicleWeapon
}

export interface VehicleControlInput {
  type: number;
  pos: BotVec3; // vehicle entity position
  vel: BotVec3;
  yaw: number; // vehicle entity yaw
  pitch: number; // vehicle entity pitch
  /** Aim/goal point (caller should lead-adjust for moving targets). */
  target: BotVec3 | null;
  targetIsAir: boolean;
  hasTarget: boolean;
  ammoPrimary: number;
  ammoSecondary: number;
  ammoTertiary: number;
  dt: number;
}

const ZERO: VehicleControl = {
  forward: 0,
  strafe: 0,
  lift: 0,
  yaw: 0,
  boosting: false,
  fire: false,
  weaponSlot: 0,
  aimDir: null,
};

export function computeVehicleControl(inp: VehicleControlInput): VehicleControl {
  switch (inp.type) {
    case VEHICLE_TYPE.ANTI_AIR:
      return antiAirControl(inp);
    case VEHICLE_TYPE.HELICOPTER:
      return helicopterControl(inp);
    case VEHICLE_TYPE.FIGHTER_JET:
      return jetControl(inp);
    case VEHICLE_TYPE.APC:
      return apcControl(inp);
    default:
      return { ...ZERO };
  }
}

// ── Anti-Air: stationary turret aimed by pilot LOOK; CRAM fires in aimDir ──
// The AA physics ignores movement input (forward/strafe/lift/yaw); the turret
// tracks the pilot's look and the weapon fires in the direction we pass to
// fireVehicleWeapon. So we emit zero movement, point aimDir at the target, and
// fire whenever the target is within CRAM range.
function antiAirControl(inp: VehicleControlInput): VehicleControl {
  if (!inp.hasTarget || !inp.target) return { ...ZERO };
  const dx = inp.target.x - inp.pos.x;
  const dy = inp.target.y - inp.pos.y;
  const dz = inp.target.z - inp.pos.z;
  const dist = Math.hypot(dx, dy, dz);
  return {
    forward: 0,
    strafe: 0,
    lift: 0,
    yaw: 0,
    boosting: false,
    fire: dist < 125, // CRAM range ~130
    weaponSlot: 0,
    aimDir: norm3(dx, dy, dz),
  };
}

// ── Helicopter: hold standoff above target, strafe-juke, minigun/rockets ──
function helicopterControl(inp: VehicleControlInput): VehicleControl {
  if (!inp.hasTarget || !inp.target) {
    // Idle hover at a safe altitude.
    return { ...ZERO, lift: HELI_LIFT_SIGN * clamp((28 - inp.pos.y) * 0.1, -1, 1) };
  }
  const dx = inp.target.x - inp.pos.x;
  const dy = inp.target.y - inp.pos.y;
  const dz = inp.target.z - inp.pos.z;
  const horiz = Math.hypot(dx, dz) || 0.001;
  const yawErr = wrapAngle(faceYaw(dx, dz) - inp.yaw);
  const yaw = YAW_SIGN * clamp(yawErr * 1.8, -1, 1);

  // Approach to standoff range; only drive forward when roughly facing target.
  const rangeErr = horiz - HELI_STANDOFF;
  const forward = clamp(rangeErr * 0.05, -1, 1) * (Math.abs(yawErr) < 1.2 ? 1 : 0.25);

  // Hover above so the chopper looks down on the target.
  const desiredY = inp.target.y + HELI_HEIGHT_ABOVE;
  const lift = HELI_LIFT_SIGN * clamp((desiredY - inp.pos.y) * 0.12, -1, 1);

  const aimed = Math.abs(yawErr) < 0.5;
  const useRockets = inp.targetIsAir && inp.ammoSecondary > 0;
  return {
    forward,
    strafe: 0,
    lift,
    yaw,
    boosting: false,
    fire: aimed && horiz < HELI_MAX_FIRE_RANGE,
    weaponSlot: useRockets ? 1 : 0,
    aimDir: norm3(dx, dy, dz),
  };
}

// ── Fighter Jet: takeoff roll → climb → high-speed attack passes (bombs/missiles) ──
function jetControl(inp: VehicleControlInput): VehicleControl {
  const alt = inp.pos.y;

  // Takeoff roll: below ~26m fly STRAIGHT at full throttle with a gentle nose-up
  // (no turning, so it stays on the runway instead of veering into structures).
  if (alt < 26) {
    return {
      forward: 1,
      strafe: 0,
      lift: JET_PITCH_SIGN * 0.5,
      yaw: 0,
      boosting: false,
      fire: false,
      weaponSlot: inp.targetIsAir ? 2 : 1,
      aimDir: null,
    };
  }

  // Airborne: keep speed up (above stall 40), hold altitude, maneuver to attack.
  const forward = JET_THROTTLE;
  let desiredY = JET_CRUISE_ALT;
  let yaw = 0;
  let fire = false;
  let weaponSlot = 1;
  let aimDir: BotVec3 | null = null;

  if (inp.hasTarget && inp.target) {
    const dx = inp.target.x - inp.pos.x;
    const dy = inp.target.y - inp.pos.y;
    const dz = inp.target.z - inp.pos.z;
    const horiz = Math.hypot(dx, dz) || 0.001;
    const yawErr = wrapAngle(faceYaw(dx, dz) - inp.yaw);
    yaw = YAW_SIGN * clamp(yawErr * 1.3, -1, 1);
    aimDir = norm3(dx, dy, dz);

    if (inp.targetIsAir && inp.ammoTertiary > 0) {
      weaponSlot = 2; // air missile
      desiredY = Math.max(JET_CRUISE_ALT - 8, inp.target.y + 6);
      fire = Math.abs(yawErr) < 0.4 && horiz < 130;
    } else {
      weaponSlot = 1; // carpet bomb — bombs fall down+forward (~10m lead), so
      // release a string only when aligned and close. Fly a bit higher than the
      // first pass for survivability (less ground fire / terrain risk).
      desiredY = Math.max(38, inp.target.y + 28);
      fire = Math.abs(yawErr) < 0.4 && horiz < 26 && horiz > 2 && alt > inp.target.y + 12;
    }
  }

  const lift = JET_PITCH_SIGN * clamp((desiredY - alt) * 0.045, -0.7, 0.9);
  return { forward, strafe: 0, lift, yaw, boosting: false, fire, weaponSlot, aimDir };
}

// ── APC: ground transport — drive/steer toward goal (no weapons) ──
function apcControl(inp: VehicleControlInput): VehicleControl {
  if (!inp.target) return { ...ZERO };
  const dx = inp.target.x - inp.pos.x;
  const dz = inp.target.z - inp.pos.z;
  const yawErr = wrapAngle(faceYaw(dx, dz) - inp.yaw);
  return {
    forward: Math.abs(yawErr) < 1.0 ? 1 : 0.3,
    strafe: 0,
    lift: 0,
    yaw: YAW_SIGN * clamp(yawErr * 1.5, -1, 1),
    boosting: false,
    fire: false,
    weaponSlot: 0,
    aimDir: null,
  };
}

// ── math ──
function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  return (((a + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
}
function faceYaw(dx: number, dz: number): number {
  // Matches the game's yaw convention: forward = (-sin(yaw), -cos(yaw)).
  return Math.atan2(-dx, -dz);
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function norm3(x: number, y: number, z: number): BotVec3 {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}
