import type { VoxelWorld } from './VoxelWorld';

// Player collision constants
export const PLAYER_HALF_WIDTH = 0.3;
export const STEP_HEIGHT = 0.6;
export const WALL_CLIMB_SPEED = 4.0;
const WALL_CHECK_DIST = 0.1;

/**
 * Check if a player AABB is against a wall on any cardinal side.
 */
export function isAgainstWall(
  world: VoxelWorld,
  cx: number,
  cz: number,
  footY: number,
  playerHeight: number,
): boolean {
  const checkDist = PLAYER_HALF_WIDTH + WALL_CHECK_DIST;

  for (let yOff = 0.2; yOff < playerHeight - 0.1; yOff += 0.5) {
    const by = Math.floor(footY + yOff);
    if (world.getBlock(Math.floor(cx + checkDist), by, Math.floor(cz)) !== 0) return true;
    if (world.getBlock(Math.floor(cx - checkDist), by, Math.floor(cz)) !== 0) return true;
    if (world.getBlock(Math.floor(cx), by, Math.floor(cz + checkDist)) !== 0) return true;
    if (world.getBlock(Math.floor(cx), by, Math.floor(cz - checkDist)) !== 0) return true;
  }
  return false;
}

/**
 * Horizontal collision: resolve movement against voxel blocks.
 * Returns { newX, newZ, collidedX, collidedZ }.
 */
export function moveWithCollision(
  world: VoxelWorld,
  posX: number,
  posZ: number,
  dx: number,
  dz: number,
  footY: number,
  playerHeight: number,
): { newX: number; newZ: number; collidedX: boolean; collidedZ: boolean } {
  const minBY = Math.floor(footY + STEP_HEIGHT);
  const maxBY = Math.floor(footY + playerHeight - 0.01);

  // Resolve X axis
  let newX = posX + dx;
  let collidedX = false;
  xLoop:
  for (let bx = Math.floor(newX - PLAYER_HALF_WIDTH); bx <= Math.floor(newX + PLAYER_HALF_WIDTH); bx++) {
    for (let by = minBY; by <= maxBY; by++) {
      for (let bz = Math.floor(posZ - PLAYER_HALF_WIDTH); bz <= Math.floor(posZ + PLAYER_HALF_WIDTH); bz++) {
        if (world.getBlock(bx, by, bz) !== 0) {
          collidedX = true;
          if (dx > 0) newX = bx - PLAYER_HALF_WIDTH - 0.001;
          else newX = bx + 1 + PLAYER_HALF_WIDTH + 0.001;
          break xLoop;
        }
      }
    }
  }

  // Resolve Z axis (using resolved X)
  let newZ = posZ + dz;
  let collidedZ = false;
  zLoop:
  for (let bx = Math.floor(newX - PLAYER_HALF_WIDTH); bx <= Math.floor(newX + PLAYER_HALF_WIDTH); bx++) {
    for (let by = minBY; by <= maxBY; by++) {
      for (let bz = Math.floor(newZ - PLAYER_HALF_WIDTH); bz <= Math.floor(newZ + PLAYER_HALF_WIDTH); bz++) {
        if (world.getBlock(bx, by, bz) !== 0) {
          collidedZ = true;
          if (dz > 0) newZ = bz - PLAYER_HALF_WIDTH - 0.001;
          else newZ = bz + 1 + PLAYER_HALF_WIDTH + 0.001;
          break zLoop;
        }
      }
    }
  }

  return { newX, newZ, collidedX, collidedZ };
}

/**
 * Ceiling collision: prevent jumping through blocks above.
 * Returns corrected camera Y and velocity Y, or null if no ceiling hit.
 */
export function checkCeiling(
  world: VoxelWorld,
  posX: number,
  posZ: number,
  velocityY: number,
  footY: number,
  playerHeight: number,
  currentEyeHeight: number,
): { cameraY: number; velocityY: number } | null {
  if (velocityY <= 0) return null;
  const headY = Math.floor(footY + playerHeight);

  const minBX = Math.floor(posX - PLAYER_HALF_WIDTH);
  const maxBX = Math.floor(posX + PLAYER_HALF_WIDTH);
  const minBZ = Math.floor(posZ - PLAYER_HALF_WIDTH);
  const maxBZ = Math.floor(posZ + PLAYER_HALF_WIDTH);

  for (let bx = minBX; bx <= maxBX; bx++) {
    for (let bz = minBZ; bz <= maxBZ; bz++) {
      if (world.getBlock(bx, headY, bz) !== 0) {
        return {
          cameraY: headY - playerHeight + currentEyeHeight - 0.001,
          velocityY: 0,
        };
      }
    }
  }
  return null;
}

/**
 * Get the ground height using multi-point sampling.
 */
export function getGroundLevel(
  world: VoxelWorld,
  posX: number,
  posZ: number,
  footY: number,
): number {
  const scanY = footY + STEP_HEIGHT + 1;
  const hw = PLAYER_HALF_WIDTH - 0.01;

  let maxGround = -Infinity;
  const points = [
    [posX, posZ],
    [posX - hw, posZ - hw],
    [posX + hw, posZ - hw],
    [posX - hw, posZ + hw],
    [posX + hw, posZ + hw],
  ];
  for (const [sx, sz] of points) {
    const top = world.getGroundHeightBelow(sx, scanY, sz);
    const h = top >= 0 ? top + 1 : 0;
    if (h > maxGround) maxGround = h;
  }
  return maxGround;
}

/**
 * Check if there's headroom to stand up.
 */
export function canStandUp(
  world: VoxelWorld,
  posX: number,
  posZ: number,
  footY: number,
  standHeight: number,
): boolean {
  const hw = PLAYER_HALF_WIDTH - 0.01;
  const headY = Math.floor(footY + standHeight);
  const points = [
    [posX, posZ],
    [posX - hw, posZ - hw],
    [posX + hw, posZ - hw],
    [posX - hw, posZ + hw],
    [posX + hw, posZ + hw],
  ];
  for (const [sx, sz] of points) {
    if (world.getBlock(Math.floor(sx), headY, Math.floor(sz)) !== 0) return false;
  }
  return true;
}
