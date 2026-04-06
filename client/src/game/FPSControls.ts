import * as THREE from 'three';
import type { VoxelWorld } from './VoxelWorld';
import {
  WALL_CLIMB_SPEED,
  isAgainstWall,
  moveWithCollision,
  checkCeiling,
  getGroundLevel,
  canStandUp,
} from './VoxelCollision';

export class FPSControls {
  camera: THREE.PerspectiveCamera;
  velocity: THREE.Vector3 = new THREE.Vector3();
  direction: THREE.Vector3 = new THREE.Vector3();
  euler: THREE.Euler = new THREE.Euler(0, 0, 0, 'YXZ');

  moveForward = false;
  moveBackward = false;
  moveLeft = false;
  moveRight = false;
  qPressed = false;
  ePressed = false;
  isJumping = false;
  onGround = false;

  // Input gating (disabled during chat)
  inputEnabled = true;
  // Fly mode (admin)
  flyMode = false;

  // Public state for other systems
  isSprinting = false;
  isCrouching = false;
  isSliding = false;
  isClimbing = false;
  headBobX = 0;
  headBobY = 0;
  stepTriggered = false;
  horizontalSpeed = 0;

  // Landing (public for Engine)
  justLanded = false;
  landingIntensity = 0; // 0-1

  // Jump (public for Engine)
  justJumped = false;

  // Camera effects (public for Engine)
  cameraTiltZ = 0;
  sprintFovOffset = 0;
  strafeInput = 0; // smoothed -1 to +1

  // Tuning
  speed = 12;
  sprintSpeed = 18;
  crouchSpeed = 5;
  jumpForce = 9.5;
  gravity = -40;
  gravityAscending = -22;
  sensitivity = 0.002;
  sensitivityScale = 1;
  locked = false;
  speedMultiplier = 1.0;

  // Enhanced gravity feel
  private readonly terminalVelocity = -35;

  // Acceleration-based movement
  private groundAccel = 65;
  private groundFriction = 45;
  private airAccel = 18;
  private hVelX = 0;
  private hVelZ = 0;

  // Sprint/crouch keys
  private shiftDown = false;
  private ctrlDown = false;
  private spaceHeld = false;

  // Sprint toggle
  private sprintToggleActive = false;
  private sprintToggleSetting = false;

  // Crouch interpolation
  private currentEyeHeight = 1.7;
  private targetEyeHeight = 1.7;
  private readonly standHeight = 1.7;
  private readonly crouchHeight = 1.0;

  // Coyote time
  private coyoteTimer = 0;
  private readonly coyoteTime = 0.1;

  // Jump buffer
  private jumpBuffered = false;
  private jumpBufferTimer = 0;
  private readonly jumpBufferTime = 0.1;

  // Slide
  private slideTimer = 0;
  private slideSpeed = 0;
  private slideDirX = 0;
  private slideDirZ = 0;
  private readonly slideDuration = 0.75;
  private readonly slideMinSpeed = 10;
  private readonly slideInitialSpeed = 22;

  // Landing impact
  private landingDip = 0;

  // Strafe tracking
  private rawStrafeInput = 0;

  // Head bob
  private bobTime = 0;
  private lastBobY = 0;

  // World bounds
  private minX: number;
  private maxX: number;
  private minZ: number;
  private maxZ: number;
  private domElement: HTMLElement;
  private perfSandboxExclusive = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    worldSizeX = 32,
    worldSizeZ = 32,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.minX = 0.5;
    this.maxX = worldSizeX - 0.5;
    this.minZ = 0.5;
    this.maxZ = worldSizeZ - 0.5;

    domElement.addEventListener('click', () => {
      if (this.inputEnabled) this.lock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === domElement;
    });
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  lock(): void { this.domElement.requestPointerLock(); }
  unlock(): void { document.exitPointerLock(); }

  /** Apply an external impulse (e.g. explosion knockback) */
  applyImpulse(x: number, y: number, z: number): void {
    this.hVelX += x;
    this.velocity.y += y;
    this.hVelZ += z;
    // Lift off ground so gravity takes over
    if (y > 0) {
      this.onGround = false;
      this.isJumping = true;
      this.coyoteTimer = 0;
    }
  }

  /** Reset all velocity (used after teleport) */
  resetVelocity(): void {
    this.hVelX = 0;
    this.hVelZ = 0;
    this.velocity.y = 0;
    this.onGround = false;
  }

  /** Reset all movement mode state (used on map reset) */
  resetMovementState(): void {
    this.hVelX = 0;
    this.hVelZ = 0;
    this.velocity.y = 0;
    this.onGround = false;
    this.isSprinting = false;
    this.isCrouching = false;
    this.isSliding = false;
    this.isClimbing = false;
    this.isJumping = false;
    this.slideTimer = 0;
    this.slideSpeed = 0;
    this.slideDirX = 0;
    this.slideDirZ = 0;
    this.landingDip = 0;
    this.justLanded = false;
    this.justJumped = false;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.currentEyeHeight = this.standHeight;
    this.targetEyeHeight = this.standHeight;
    this.headBobX = 0;
    this.headBobY = 0;
    this.bobTime = 0;
    this.horizontalSpeed = 0;
    this.cameraTiltZ = 0;
    this.sprintFovOffset = 0;
    this.strafeInput = 0;
    this.rawStrafeInput = 0;
    this.sprintToggleActive = false;
  }

  /** Get current velocity vector for network sync */
  getVelocity(): { x: number; y: number; z: number } {
    return { x: this.hVelX, y: this.velocity.y, z: this.hVelZ };
  }

  setSprintToggle(enabled: boolean): void {
    this.sprintToggleSetting = enabled;
    if (!enabled) this.sprintToggleActive = false;
  }

  setPerfSandboxExclusive(enabled: boolean): void {
    this.perfSandboxExclusive = enabled;
    if (enabled) {
      this.releaseAllInput();
    }
  }

  setSandboxSprint(held: boolean): void {
    if (this.sprintToggleSetting) {
      this.sprintToggleActive = held;
    } else {
      this.shiftDown = held;
    }
  }

  get shiftHeld(): boolean {
    return this.shiftDown;
  }

  get spacePressed(): boolean {
    return this.spaceHeld;
  }

  get ctrlHeld(): boolean {
    return this.ctrlDown;
  }

  releaseAllInput(): void {
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.qPressed = false;
    this.ePressed = false;
    this.shiftDown = false;
    this.ctrlDown = false;
    this.spaceHeld = false;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
    this.direction.set(0, 0, 0);
    this.rawStrafeInput = 0;
    this.strafeInput = 0;
  }

  private onMouseMove = (event: MouseEvent): void => {
    if (this.perfSandboxExclusive) return;
    if (!this.locked) return;
    this.euler.setFromQuaternion(this.camera.quaternion);
    const sens = this.sensitivity * this.sensitivityScale;
    this.euler.y -= event.movementX * sens;
    this.euler.x -= event.movementY * sens;
    this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  };

  private executeJump(): void {
    this.velocity.y = this.jumpForce;
    this.onGround = false;
    this.isJumping = true;
    this.justJumped = true;
    this.coyoteTimer = 0;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
    // End slide but preserve momentum
    if (this.isSliding) {
      this.isSliding = false;
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.perfSandboxExclusive) return;
    if (!this.inputEnabled) return;
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = true; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = true; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = true; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = true; break;
      case 'KeyQ': this.qPressed = true; break;
      case 'KeyE': this.ePressed = true; break;
      case 'ShiftLeft': case 'ShiftRight':
        if (this.sprintToggleSetting) {
          this.sprintToggleActive = !this.sprintToggleActive;
        } else {
          this.shiftDown = true;
        }
        break;
      case 'ControlLeft': case 'ControlRight':
        event.preventDefault();
        this.ctrlDown = true;
        // Slide activation: on ground, moving fast, not already sliding
        if (this.onGround && !this.isSliding && this.horizontalSpeed >= this.slideMinSpeed) {
          this.isSliding = true;
          this.slideTimer = this.slideDuration;
          this.slideSpeed = Math.max(this.horizontalSpeed, this.slideInitialSpeed);
          const len = Math.sqrt(this.hVelX * this.hVelX + this.hVelZ * this.hVelZ);
          if (len > 0.1) {
            this.slideDirX = this.hVelX / len;
            this.slideDirZ = this.hVelZ / len;
          }
        }
        break;
      case 'Space':
        this.spaceHeld = true;
        if (this.onGround || this.coyoteTimer > 0 || this.isSliding) {
          this.executeJump();
        } else {
          // Buffer the jump for when we land
          this.jumpBuffered = true;
          this.jumpBufferTimer = this.jumpBufferTime;
        }
        break;
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (this.perfSandboxExclusive) return;
    if (!this.inputEnabled) return;
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = false; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = false; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = false; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = false; break;
      case 'KeyQ': this.qPressed = false; break;
      case 'KeyE': this.ePressed = false; break;
      case 'ShiftLeft': case 'ShiftRight':
        if (!this.sprintToggleSetting) this.shiftDown = false;
        break;
      case 'ControlLeft': case 'ControlRight': this.ctrlDown = false; break;
      case 'Space': this.spaceHeld = false; break;
    }
  };



  private updateFly(delta: number): void {
    const flySpeed = 20;

    // Horizontal input
    this.direction.set(0, 0, 0);
    if (this.moveForward) this.direction.z -= 1;
    if (this.moveBackward) this.direction.z += 1;
    if (this.moveLeft) this.direction.x -= 1;
    if (this.moveRight) this.direction.x += 1;
    this.direction.normalize();

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0; right.normalize();

    const move = new THREE.Vector3();
    move.addScaledVector(forward, -this.direction.z);
    move.addScaledVector(right, this.direction.x);

    // Vertical: Space = up, Shift = down
    if (this.spaceHeld) move.y += 1;
    if (this.shiftDown) move.y -= 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(flySpeed * delta);
      this.camera.position.add(move);
    }

    // Reset physics state
    this.velocity.y = 0;
    this.hVelX = 0;
    this.hVelZ = 0;
    this.onGround = false;
    this.isSprinting = false;
    this.isCrouching = false;
    this.isSliding = false;
    this.isClimbing = false;
    this.justLanded = false;
    this.justJumped = false;
    this.headBobX = 0;
    this.headBobY = 0;
    this.horizontalSpeed = 0;
    this.cameraTiltZ = 0;
    this.sprintFovOffset = 0;
  }

  update(delta: number, world: VoxelWorld): void {
    if (this.flyMode) {
      this.updateFly(delta);
      return;
    }

    // Capture pre-gravity vertical velocity for landing detection
    const prevVelY = this.velocity.y;

    // Sprint state (persists through jumps like Minecraft)
    const wantsSprint = this.sprintToggleSetting ? this.sprintToggleActive : this.shiftDown;
    this.isSprinting = wantsSprint && this.moveForward && !this.isCrouching && !this.isSliding;

    // Crouch with headroom check
    if (this.ctrlDown) {
      this.isCrouching = true;
    } else if (this.isCrouching) {
      // Only uncrouch if there's headroom
      if (canStandUp(world, this.camera.position.x, this.camera.position.z, this.camera.position.y - this.currentEyeHeight, this.standHeight)) {
        this.isCrouching = false;
      }
    }

    // Auto-cancel sprint toggle if player stops or crouches
    if (this.sprintToggleSetting && this.sprintToggleActive && (!this.moveForward || this.isCrouching)) {
      this.sprintToggleActive = false;
    }

    // Target speed
    let targetSpeed = this.speed;
    if (this.isSprinting) targetSpeed = this.sprintSpeed;
    else if (this.isCrouching && !this.isSliding) targetSpeed = this.crouchSpeed;
    targetSpeed *= this.speedMultiplier;

    // Eye height interpolation
    this.targetEyeHeight = this.isCrouching ? this.crouchHeight : this.standHeight;
    const heightLerp = 1 - Math.pow(0.00001, delta);
    this.currentEyeHeight += (this.targetEyeHeight - this.currentEyeHeight) * heightLerp;

    // Slide update
    if (this.isSliding) {
      this.slideTimer -= delta;
      const slideProgress = 1 - (this.slideTimer / this.slideDuration);
      const slideDecay = 1 - slideProgress * slideProgress; // quadratic ease-out
      const currentSlideSpeed = this.slideSpeed * slideDecay;

      // Override horizontal velocity with slide direction
      this.hVelX = this.slideDirX * currentSlideSpeed;
      this.hVelZ = this.slideDirZ * currentSlideSpeed;

      // End conditions
      if (this.slideTimer <= 0 || !this.ctrlDown) {
        this.isSliding = false;
      }

      // Prevent speed clamping from killing the slide
      targetSpeed = Math.max(targetSpeed, currentSlideSpeed);
    }

    // Input direction (skip during slide — slide controls its own velocity)
    if (!this.isSliding) {
      this.direction.set(0, 0, 0);
      if (this.moveForward) this.direction.z -= 1;
      if (this.moveBackward) this.direction.z += 1;
      if (this.moveLeft) this.direction.x -= 1;
      if (this.moveRight) this.direction.x += 1;
      this.direction.normalize();

      // World-space movement vectors
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      forward.y = 0; forward.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      right.y = 0; right.normalize();

      // Desired movement direction in world space
      const wishDir = new THREE.Vector3();
      wishDir.addScaledVector(forward, -this.direction.z);
      wishDir.addScaledVector(right, this.direction.x);
      const hasInput = wishDir.lengthSq() > 0.001;
      if (hasInput) wishDir.normalize();

      // Acceleration-based horizontal movement
      const accel = this.onGround ? this.groundAccel : this.airAccel;
      const friction = this.onGround ? this.groundFriction : 2;

      if (hasInput) {
        const wishX = wishDir.x * targetSpeed;
        const wishZ = wishDir.z * targetSpeed;
        const diffX = wishX - this.hVelX;
        const diffZ = wishZ - this.hVelZ;
        const accelAmount = accel * delta;
        const diffLen = Math.sqrt(diffX * diffX + diffZ * diffZ);
        if (diffLen > 0) {
          const appliedAccel = Math.min(accelAmount, diffLen);
          this.hVelX += (diffX / diffLen) * appliedAccel;
          this.hVelZ += (diffZ / diffLen) * appliedAccel;
        }
      } else if (this.onGround) {
        const curSpeed = Math.sqrt(this.hVelX * this.hVelX + this.hVelZ * this.hVelZ);
        if (curSpeed > 0.1) {
          const drop = friction * delta;
          const factor = Math.max(0, curSpeed - drop) / curSpeed;
          this.hVelX *= factor;
          this.hVelZ *= factor;
        } else {
          this.hVelX = 0;
          this.hVelZ = 0;
        }
      }
    }

    // Soft speed clamping (gradual deceleration instead of hard cap)
    this.horizontalSpeed = Math.sqrt(this.hVelX * this.hVelX + this.hVelZ * this.hVelZ);
    const maxSpeed = this.isSliding ? this.slideSpeed : targetSpeed * 1.1;
    if (this.horizontalSpeed > maxSpeed) {
      const overSpeed = this.horizontalSpeed - maxSpeed;
      const reductionRate = this.onGround ? 15 : 5;
      const reduction = Math.min(overSpeed, reductionRate * delta);
      const scale = (this.horizontalSpeed - reduction) / this.horizontalSpeed;
      this.hVelX *= scale;
      this.hVelZ *= scale;
      this.horizontalSpeed = Math.sqrt(this.hVelX * this.hVelX + this.hVelZ * this.hVelZ);
    }

    // Apply horizontal velocity with collision detection
    {
      const footY = this.camera.position.y - this.currentEyeHeight;
      const playerHeight = this.isCrouching ? this.crouchHeight : this.standHeight;
      const result = moveWithCollision(world, this.camera.position.x, this.camera.position.z, this.hVelX * delta, this.hVelZ * delta, footY, playerHeight);
      this.camera.position.x = result.newX;
      this.camera.position.z = result.newZ;
      if (result.collidedX) this.hVelX = 0;
      if (result.collidedZ) this.hVelZ = 0;
    }

    // Variable gravity + terminal velocity
    const grav = this.velocity.y > 0 ? this.gravityAscending : this.gravity;
    this.velocity.y += grav * delta;
    if (this.velocity.y < this.terminalVelocity) {
      this.velocity.y = this.terminalVelocity;
    }
    this.camera.position.y += this.velocity.y * delta;

    // Ceiling collision
    {
      const footY = this.camera.position.y - this.currentEyeHeight;
      const playerHeight = this.isCrouching ? this.crouchHeight : this.standHeight;
      const ceiling = checkCeiling(world, this.camera.position.x, this.camera.position.z, this.velocity.y, footY, playerHeight, this.currentEyeHeight);
      if (ceiling) {
        this.camera.position.y = ceiling.cameraY;
        this.velocity.y = ceiling.velocityY;
      }
    }

    // Wall climbing: hold space while airborne and against a wall
    if (!this.onGround && this.spaceHeld && isAgainstWall(world, this.camera.position.x, this.camera.position.z, this.camera.position.y - this.currentEyeHeight, this.isCrouching ? this.crouchHeight : this.standHeight)) {
      this.isClimbing = true;
      this.velocity.y = WALL_CLIMB_SPEED;
      // Wall friction on horizontal movement
      this.hVelX *= 0.9;
      this.hVelZ *= 0.9;
    } else {
      this.isClimbing = false;
    }

    // Mantle: when climbing and head clears the wall top, boost onto the ledge
    if (this.isClimbing) {
      const footY = this.camera.position.y - this.currentEyeHeight;
      const playerHeight = this.isCrouching ? this.crouchHeight : this.standHeight;
      const headBlockY = Math.floor(footY + playerHeight);
      const footBlockY = Math.floor(footY);

      // Check if head is clear but feet are at block level (at the top of the wall)
      const headClear = world.getBlock(
        Math.floor(this.camera.position.x), headBlockY, Math.floor(this.camera.position.z)
      ) === 0;
      const feetAtBlock = world.getBlock(
        Math.floor(this.camera.position.x), footBlockY, Math.floor(this.camera.position.z)
      ) !== 0;

      if (headClear && feetAtBlock) {
        // Mantle: place player on top of the block
        this.camera.position.y = footBlockY + 1 + this.currentEyeHeight;
        this.velocity.y = 1;
        this.isClimbing = false;
        this.onGround = true;
      }
    }

    // Coyote time
    if (this.onGround) {
      this.coyoteTimer = this.coyoteTime;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
    }

    // Jump buffer countdown
    if (this.jumpBuffered) {
      this.jumpBufferTimer -= delta;
      if (this.jumpBufferTimer <= 0) {
        this.jumpBuffered = false;
      }
    }

    // Ground collision (Y-aware)
    const groundHeight = getGroundLevel(world, this.camera.position.x, this.camera.position.z, this.camera.position.y - this.currentEyeHeight) + this.currentEyeHeight;
    const wasOnGround = this.onGround;

    this.justLanded = false;
    if (this.camera.position.y < groundHeight) {
      this.camera.position.y = groundHeight;

      // Landing detection
      if (!wasOnGround && prevVelY < -2) {
        this.justLanded = true;
        this.landingIntensity = Math.min(1, Math.max(0, (-prevVelY - 2) / 18));

        // Camera dip — visual impact only, no speed penalty
        this.landingDip = this.landingIntensity * 0.25;

        // Dampen head bob on landing
        this.bobTime = 0;
      }

      this.velocity.y = 0;
      this.onGround = true;
      this.isJumping = false;

      // Auto-jump if space held or jump buffered (Minecraft style)
      if (this.spaceHeld || this.jumpBuffered) {
        // Cancel landing dip so it doesn't pull us back into ground next frame
        this.landingDip = 0;
        this.executeJump();
      }
    } else if (this.camera.position.y > groundHeight + 0.2) {
      this.onGround = false;
      if (wasOnGround && !this.isJumping) {
        this.coyoteTimer = this.coyoteTime;
      }
      // End slide if we fall off an edge
      if (this.isSliding) {
        this.isSliding = false;
      }
    }

    // Landing dip recovery (slower = more weight)
    if (this.landingDip > 0.001) {
      this.landingDip *= Math.max(0, 1 - delta * 6);
      this.camera.position.y -= this.landingDip;
    } else {
      this.landingDip = 0;
    }

    // World bounds
    this.camera.position.x = Math.max(this.minX, Math.min(this.maxX, this.camera.position.x));
    this.camera.position.y = Math.max(-5, Math.min(95, this.camera.position.y));
    this.camera.position.z = Math.max(this.minZ, Math.min(this.maxZ, this.camera.position.z));

    // Head bob
    this.stepTriggered = false;
    const landingBobDampen = this.landingDip > 0.01 ? 0.2 : 1;

    if (this.onGround && this.horizontalSpeed > 1 && !this.isSliding) {
      const bobFreq = this.isSprinting ? 14 : this.isCrouching ? 6 : 10;
      const bobAmpY = (this.isSprinting ? 0.04 : this.isCrouching ? 0.015 : 0.028) * landingBobDampen;
      const bobAmpX = (this.isSprinting ? 0.02 : this.isCrouching ? 0.008 : 0.014) * landingBobDampen;
      const speedFactor = Math.min(1, this.horizontalSpeed / targetSpeed);

      this.bobTime += delta * bobFreq * speedFactor;
      // Simple single sine wave (Minecraft-style)
      this.headBobY = Math.sin(this.bobTime) * bobAmpY * speedFactor;
      this.headBobX = Math.cos(this.bobTime * 0.5) * bobAmpX * speedFactor;

      // Step trigger
      if (this.lastBobY >= 0 && this.headBobY < 0) {
        this.stepTriggered = true;
      }
      this.lastBobY = this.headBobY;
    } else if (this.isSliding) {
      // Subtle slide vibration
      this.bobTime += delta * 15;
      this.headBobY = Math.sin(this.bobTime * 3) * 0.008;
      this.headBobX = 0;
      this.lastBobY = this.headBobY;
    } else {
      // Idle breathing sway
      this.bobTime += delta * 1.5;
      this.headBobY = Math.sin(this.bobTime) * 0.004;
      this.headBobX = Math.cos(this.bobTime * 0.7) * 0.002;
      this.lastBobY = this.headBobY;
    }

    // Strafe input + camera tilt
    this.rawStrafeInput = 0;
    if (this.moveLeft) this.rawStrafeInput -= 1;
    if (this.moveRight) this.rawStrafeInput += 1;

    const tiltLerpSpeed = 1 - Math.pow(0.00001, delta);
    this.strafeInput += (this.rawStrafeInput - this.strafeInput) * tiltLerpSpeed;

    const maxTilt = 0.026; // ~1.5 degrees
    this.cameraTiltZ = -this.strafeInput * maxTilt;
    if (this.isSprinting) this.cameraTiltZ *= 1.4;

    // Sprint FOV offset
    const targetFovOffset = this.isSprinting ? 6 : this.isSliding ? 8 : 0;
    const fovLerpSpeed = 1 - Math.pow(0.0001, delta);
    this.sprintFovOffset += (targetFovOffset - this.sprintFovOffset) * fovLerpSpeed;
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
  }
}
