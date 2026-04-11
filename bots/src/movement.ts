import { PLAYER, WORLD } from '../../client/src/shared-config.ts';
import type { BotVec3, WorldSnapshot } from './world.ts';

const SPEED = 12.0;
const SPRINT_SPEED = 18.0;
const JUMP_FORCE = 9.5;
const GRAVITY = -40.0;
const GRAVITY_ASCENDING = -22.0;
const TERMINAL_VELOCITY = -35.0;
const GROUND_ACCEL = 65.0;
const GROUND_FRICTION = 45.0;
const AIR_ACCEL = 18.0;
const STAND_HEIGHT = PLAYER.eyeHeight;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER_TIME = 0.1;
const GROUND_REDUCTION_RATE = 15.0;
const AIR_REDUCTION_RATE = 5.0;
const PLAYER_HALF_WIDTH = 0.3;
const STEP_HEIGHT = 0.6;
const WALL_CLIMB_SPEED = 4.0;
const WALL_CHECK_DIST = 0.1;

export type MovementSnapshot = {
  pos: BotVec3;
  vel: BotVec3;
  grounded?: boolean;
  climbing?: boolean;
  sprinting?: boolean;
};

export type MovementInput = {
  wishX: number;
  wishZ: number;
  jump: boolean;
  sprint: boolean;
};

export type MovementStepResult = {
  pos: BotVec3;
  vel: BotVec3;
  grounded: boolean;
  climbing: boolean;
  sprinting: boolean;
  collidedX: boolean;
  collidedZ: boolean;
};

export class BotMovementState {
  pos: BotVec3 = { x: 0, y: 0, z: 0 };
  hVelX = 0;
  hVelZ = 0;
  velY = 0;
  onGround = false;
  isJumping = false;
  isSprinting = false;
  isClimbing = false;
  private coyoteTimer = 0;
  private jumpBuffered = false;
  private jumpBufferTimer = 0;

  static fromSnapshot(snapshot: MovementSnapshot): BotMovementState {
    const state = new BotMovementState();
    state.syncHard(snapshot);
    return state;
  }

  clone(): BotMovementState {
    const copy = new BotMovementState();
    copy.pos = { ...this.pos };
    copy.hVelX = this.hVelX;
    copy.hVelZ = this.hVelZ;
    copy.velY = this.velY;
    copy.onGround = this.onGround;
    copy.isJumping = this.isJumping;
    copy.isSprinting = this.isSprinting;
    copy.isClimbing = this.isClimbing;
    copy.coyoteTimer = this.coyoteTimer;
    copy.jumpBuffered = this.jumpBuffered;
    copy.jumpBufferTimer = this.jumpBufferTimer;
    return copy;
  }

  syncHard(snapshot: MovementSnapshot): void {
    this.pos = { ...snapshot.pos };
    this.hVelX = snapshot.vel.x;
    this.hVelZ = snapshot.vel.z;
    this.velY = snapshot.vel.y;
    this.onGround = snapshot.grounded ?? false;
    this.isJumping = !this.onGround && this.velY > 0.1;
    this.isSprinting = snapshot.sprinting ?? false;
    this.isClimbing = snapshot.climbing ?? false;
    this.coyoteTimer = this.onGround ? COYOTE_TIME : 0;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
  }

  nudgeToward(snapshot: MovementSnapshot, positionAlpha: number, velocityAlpha: number): void {
    const pa = clamp(positionAlpha, 0, 1);
    const va = clamp(velocityAlpha, 0, 1);
    this.pos.x += (snapshot.pos.x - this.pos.x) * pa;
    this.pos.y += (snapshot.pos.y - this.pos.y) * pa;
    this.pos.z += (snapshot.pos.z - this.pos.z) * pa;
    this.hVelX += (snapshot.vel.x - this.hVelX) * va;
    this.hVelZ += (snapshot.vel.z - this.hVelZ) * va;
    this.velY += (snapshot.vel.y - this.velY) * va;
    if (snapshot.grounded !== undefined) {
      this.onGround = snapshot.grounded;
      if (snapshot.grounded && this.velY < 0) {
        this.velY = 0;
      }
    }
    if (snapshot.climbing !== undefined) {
      this.isClimbing = snapshot.climbing;
    }
    if (snapshot.sprinting !== undefined) {
      this.isSprinting = snapshot.sprinting;
    }
  }

  velocity(): BotVec3 {
    return { x: this.hVelX, y: this.velY, z: this.hVelZ };
  }

  setPosition(pos: BotVec3): void {
    this.pos = { ...pos };
    this.hVelX = 0;
    this.hVelZ = 0;
    this.velY = 0;
    this.onGround = true;
    this.isJumping = false;
    this.isClimbing = false;
    this.coyoteTimer = COYOTE_TIME;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
  }

  step(delta: number, input: MovementInput, world: WorldSnapshot): MovementStepResult {
    const wishLen = Math.sqrt(input.wishX * input.wishX + input.wishZ * input.wishZ);
    const hasInput = wishLen > 0.001;
    this.isSprinting = input.sprint && hasInput;

    let targetSpeed = this.isSprinting ? SPRINT_SPEED : SPEED;

    if (hasInput) {
      const wishX = input.wishX / wishLen;
      const wishZ = input.wishZ / wishLen;
      const accel = this.onGround ? GROUND_ACCEL : AIR_ACCEL;
      const wishSpeedX = wishX * targetSpeed;
      const wishSpeedZ = wishZ * targetSpeed;
      const diffX = wishSpeedX - this.hVelX;
      const diffZ = wishSpeedZ - this.hVelZ;
      const diffLen = Math.sqrt(diffX * diffX + diffZ * diffZ);
      if (diffLen > 0) {
        const appliedAccel = Math.min(accel * delta, diffLen);
        this.hVelX += (diffX / diffLen) * appliedAccel;
        this.hVelZ += (diffZ / diffLen) * appliedAccel;
      }
    } else if (this.onGround) {
      const curSpeed = Math.sqrt(this.hVelX * this.hVelX + this.hVelZ * this.hVelZ);
      if (curSpeed > 0.1) {
        const drop = GROUND_FRICTION * delta;
        const factor = Math.max(0, curSpeed - drop) / curSpeed;
        this.hVelX *= factor;
        this.hVelZ *= factor;
      } else {
        this.hVelX = 0;
        this.hVelZ = 0;
      }
    }

    const horizontalSpeed = Math.sqrt(this.hVelX * this.hVelX + this.hVelZ * this.hVelZ);
    const maxSpeed = targetSpeed * 1.1;
    if (horizontalSpeed > maxSpeed) {
      const overSpeed = horizontalSpeed - maxSpeed;
      const reductionRate = this.onGround ? GROUND_REDUCTION_RATE : AIR_REDUCTION_RATE;
      const reduction = Math.min(overSpeed, reductionRate * delta);
      const scale = (horizontalSpeed - reduction) / horizontalSpeed;
      this.hVelX *= scale;
      this.hVelZ *= scale;
    }

    const footY = this.pos.y - STAND_HEIGHT;
    const collision = moveWithCollision(
      world,
      this.pos.x,
      this.pos.z,
      this.hVelX * delta,
      this.hVelZ * delta,
      footY,
      STAND_HEIGHT,
    );
    this.pos.x = collision.newX;
    this.pos.z = collision.newZ;
    if (collision.collidedX) this.hVelX = 0;
    if (collision.collidedZ) this.hVelZ = 0;

    const grav = this.velY > 0 ? GRAVITY_ASCENDING : GRAVITY;
    this.velY = Math.max(TERMINAL_VELOCITY, this.velY + grav * delta);
    this.pos.y += this.velY * delta;

    const ceiling = checkCeiling(
      world,
      this.pos.x,
      this.pos.z,
      this.velY,
      this.pos.y - STAND_HEIGHT,
      STAND_HEIGHT,
      STAND_HEIGHT,
    );
    if (ceiling) {
      this.pos.y = ceiling.cameraY;
      this.velY = ceiling.velocityY;
    }

    if (
      !this.onGround &&
      input.jump &&
      isAgainstWall(world, this.pos.x, this.pos.z, this.pos.y - STAND_HEIGHT, STAND_HEIGHT)
    ) {
      this.isClimbing = true;
      this.velY = WALL_CLIMB_SPEED;
      this.hVelX *= 0.9;
      this.hVelZ *= 0.9;
    } else {
      this.isClimbing = false;
    }

    if (this.isClimbing) {
      const mantleFootY = this.pos.y - STAND_HEIGHT;
      const headBlockY = Math.floor(mantleFootY + STAND_HEIGHT);
      const footBlockY = Math.floor(mantleFootY);
      const px = Math.floor(this.pos.x);
      const pz = Math.floor(this.pos.z);
      const headClear = world.getBlock(px, headBlockY, pz) === 0;
      const feetAtBlock = world.getBlock(px, footBlockY, pz) !== 0;
      if (headClear && feetAtBlock) {
        this.pos.y = footBlockY + 1 + STAND_HEIGHT;
        this.velY = 1;
        this.isClimbing = false;
        this.onGround = true;
      }
    }

    if (this.onGround) {
      this.coyoteTimer = COYOTE_TIME;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
    }

    if (this.jumpBuffered) {
      this.jumpBufferTimer -= delta;
      if (this.jumpBufferTimer <= 0) {
        this.jumpBuffered = false;
      }
    }

    if (input.jump && !this.isClimbing) {
      if (this.onGround || this.coyoteTimer > 0) {
        this.executeJump();
      } else if (!this.jumpBuffered) {
        this.jumpBuffered = true;
        this.jumpBufferTimer = JUMP_BUFFER_TIME;
      }
    }

    const groundHeight = getGroundLevel(world, this.pos.x, this.pos.z, this.pos.y - STAND_HEIGHT) + STAND_HEIGHT;
    const wasOnGround = this.onGround;
    if (this.pos.y < groundHeight) {
      this.pos.y = groundHeight;
      this.velY = 0;
      this.onGround = true;
      this.isJumping = false;
      if (input.jump || this.jumpBuffered) {
        this.executeJump();
      }
    } else if (this.pos.y > groundHeight + 0.2) {
      this.onGround = false;
      if (wasOnGround && !this.isJumping) {
        this.coyoteTimer = COYOTE_TIME;
      }
    }

    this.pos.x = clamp(this.pos.x, 0.5, WORLD.sizeX - 0.5);
    this.pos.y = clamp(this.pos.y, -5, 95);
    this.pos.z = clamp(this.pos.z, 0.5, WORLD.sizeZ - 0.5);

    return {
      pos: { ...this.pos },
      vel: this.velocity(),
      grounded: this.onGround,
      climbing: this.isClimbing,
      sprinting: this.isSprinting,
      collidedX: collision.collidedX,
      collidedZ: collision.collidedZ,
    };
  }

  private executeJump(): void {
    this.velY = JUMP_FORCE;
    this.onGround = false;
    this.isJumping = true;
    this.coyoteTimer = 0;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function isAgainstWall(
  world: WorldSnapshot,
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

function moveWithCollision(
  world: WorldSnapshot,
  posX: number,
  posZ: number,
  dx: number,
  dz: number,
  footY: number,
  playerHeight: number,
): { newX: number; newZ: number; collidedX: boolean; collidedZ: boolean } {
  const minBY = Math.floor(footY + STEP_HEIGHT);
  const maxBY = Math.floor(footY + playerHeight - 0.01);

  let newX = posX + dx;
  let collidedX = false;
  xLoop:
  for (let bx = Math.floor(newX - PLAYER_HALF_WIDTH); bx <= Math.floor(newX + PLAYER_HALF_WIDTH); bx++) {
    for (let by = minBY; by <= maxBY; by++) {
      for (let bz = Math.floor(posZ - PLAYER_HALF_WIDTH); bz <= Math.floor(posZ + PLAYER_HALF_WIDTH); bz++) {
        if (world.getBlock(bx, by, bz) !== 0) {
          collidedX = true;
          newX = dx > 0 ? bx - PLAYER_HALF_WIDTH - 0.001 : bx + 1 + PLAYER_HALF_WIDTH + 0.001;
          break xLoop;
        }
      }
    }
  }

  let newZ = posZ + dz;
  let collidedZ = false;
  zLoop:
  for (let bx = Math.floor(newX - PLAYER_HALF_WIDTH); bx <= Math.floor(newX + PLAYER_HALF_WIDTH); bx++) {
    for (let by = minBY; by <= maxBY; by++) {
      for (let bz = Math.floor(newZ - PLAYER_HALF_WIDTH); bz <= Math.floor(newZ + PLAYER_HALF_WIDTH); bz++) {
        if (world.getBlock(bx, by, bz) !== 0) {
          collidedZ = true;
          newZ = dz > 0 ? bz - PLAYER_HALF_WIDTH - 0.001 : bz + 1 + PLAYER_HALF_WIDTH + 0.001;
          break zLoop;
        }
      }
    }
  }

  return { newX, newZ, collidedX, collidedZ };
}

function checkCeiling(
  world: WorldSnapshot,
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

function getGroundLevel(world: WorldSnapshot, posX: number, posZ: number, footY: number): number {
  const scanY = footY + STEP_HEIGHT + 1;
  const hw = PLAYER_HALF_WIDTH - 0.01;
  let maxGround = -Infinity;
  const points = [
    [posX, posZ],
    [posX - hw, posZ - hw],
    [posX + hw, posZ - hw],
    [posX - hw, posZ + hw],
    [posX + hw, posZ + hw],
  ] as const;
  for (const [sx, sz] of points) {
    const top = world.getGroundHeightBelow(sx, scanY, sz);
    const height = top >= 0 ? top + 1 : 0;
    if (height > maxGround) {
      maxGround = height;
    }
  }
  return maxGround;
}
