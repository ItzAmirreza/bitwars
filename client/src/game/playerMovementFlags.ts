export const PLAYER_MOVEMENT_FLAG_SPRINTING = 1 << 0;
export const PLAYER_MOVEMENT_FLAG_CROUCHING = 1 << 1;
export const PLAYER_MOVEMENT_FLAG_SLIDING = 1 << 2;
export const PLAYER_MOVEMENT_FLAG_CLIMBING = 1 << 3;
export const PLAYER_MOVEMENT_FLAG_GROUNDED = 1 << 4;

export function buildPlayerMovementFlags(state: {
  sprinting: boolean;
  crouching: boolean;
  sliding: boolean;
  climbing: boolean;
  grounded: boolean;
}): number {
  let flags = 0;
  if (state.sprinting) flags |= PLAYER_MOVEMENT_FLAG_SPRINTING;
  if (state.crouching) flags |= PLAYER_MOVEMENT_FLAG_CROUCHING;
  if (state.sliding) flags |= PLAYER_MOVEMENT_FLAG_SLIDING;
  if (state.climbing) flags |= PLAYER_MOVEMENT_FLAG_CLIMBING;
  if (state.grounded) flags |= PLAYER_MOVEMENT_FLAG_GROUNDED;
  return flags;
}

export function hasPlayerMovementFlag(flags: unknown, flag: number): boolean {
  return (Number(flags ?? 0) & flag) !== 0;
}
