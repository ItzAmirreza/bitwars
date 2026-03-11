import * as THREE from 'three';

export class FPSControls {
  camera: THREE.PerspectiveCamera;
  velocity: THREE.Vector3 = new THREE.Vector3();
  direction: THREE.Vector3 = new THREE.Vector3();
  euler: THREE.Euler = new THREE.Euler(0, 0, 0, 'YXZ');

  moveForward = false;
  moveBackward = false;
  moveLeft = false;
  moveRight = false;
  isJumping = false;
  onGround = false;

  // Public state for other systems
  isSprinting = false;
  isCrouching = false;
  isSliding = false;
  headBobX = 0;
  headBobY = 0;
  stepTriggered = false;
  horizontalSpeed = 0;

  // Landing (public for Engine)
  justLanded = false;
  landingIntensity = 0; // 0-1

  // Camera effects (public for Engine)
  cameraTiltZ = 0;
  sprintFovOffset = 0;
  strafeInput = 0; // smoothed -1 to +1

  // Tuning
  speed = 12;
  sprintSpeed = 18;
  crouchSpeed = 5;
  jumpForce = 8;
  gravity = -25;
  gravityAscending = -18;
  sensitivity = 0.002;
  locked = false;

  // Acceleration-based movement
  private groundAccel = 65;
  private groundFriction = 45;
  private airAccel = 18;
  private hVelX = 0;
  private hVelZ = 0;

  // Sprint/crouch keys
  private shiftDown = false;
  private ctrlDown = false;

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
  private landingRecoveryTimer = 0;
  private landingRecoverySpeedMult = 1;

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

    domElement.addEventListener('click', () => this.lock());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === domElement;
    });
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  lock(): void { this.domElement.requestPointerLock(); }
  unlock(): void { document.exitPointerLock(); }

  setSprintToggle(enabled: boolean): void {
    this.sprintToggleSetting = enabled;
    if (!enabled) this.sprintToggleActive = false;
  }

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= event.movementX * this.sensitivity;
    this.euler.x -= event.movementY * this.sensitivity;
    this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  };

  private executeJump(): void {
    this.velocity.y = this.jumpForce;
    this.onGround = false;
    this.isJumping = true;
    this.coyoteTimer = 0;
    this.jumpBuffered = false;
    this.jumpBufferTimer = 0;
    // End slide but preserve momentum
    if (this.isSliding) {
      this.isSliding = false;
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = true; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = true; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = true; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = true; break;
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
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = false; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = false; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = false; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = false; break;
      case 'ShiftLeft': case 'ShiftRight':
        if (!this.sprintToggleSetting) this.shiftDown = false;
        break;
      case 'ControlLeft': case 'ControlRight': this.ctrlDown = false; break;
    }
  };

  update(delta: number, getHeight: (x: number, z: number) => number): void {
    // Capture pre-gravity vertical velocity for landing detection
    const prevVelY = this.velocity.y;

    // Sprint state
    const wantsSprint = this.sprintToggleSetting ? this.sprintToggleActive : this.shiftDown;
    this.isSprinting = wantsSprint && this.moveForward && !this.isCrouching && this.onGround && !this.isSliding;
    this.isCrouching = this.ctrlDown;

    // Auto-cancel sprint toggle if player stops or crouches
    if (this.sprintToggleSetting && this.sprintToggleActive && (!this.moveForward || this.isCrouching)) {
      this.sprintToggleActive = false;
    }

    // Target speed
    let targetSpeed = this.speed;
    if (this.isSprinting) targetSpeed = this.sprintSpeed;
    else if (this.isCrouching && !this.isSliding) targetSpeed = this.crouchSpeed;

    // Landing recovery speed penalty
    targetSpeed *= this.landingRecoverySpeedMult;

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

    // Apply horizontal velocity
    this.camera.position.x += this.hVelX * delta;
    this.camera.position.z += this.hVelZ * delta;

    // Variable gravity
    const grav = this.velocity.y > 0 ? this.gravityAscending : this.gravity;
    this.velocity.y += grav * delta;
    this.camera.position.y += this.velocity.y * delta;

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

    // Ground collision
    const groundHeight = getHeight(this.camera.position.x, this.camera.position.z) + this.currentEyeHeight;
    const wasOnGround = this.onGround;

    this.justLanded = false;
    if (this.camera.position.y < groundHeight) {
      this.camera.position.y = groundHeight;

      // Landing detection
      if (!wasOnGround && prevVelY < -2) {
        this.justLanded = true;
        this.landingIntensity = Math.min(1, Math.max(0, (-prevVelY - 2) / 18));

        // Camera dip
        this.landingDip = this.landingIntensity * 0.15;

        // Landing recovery: brief speed reduction
        this.landingRecoveryTimer = 0.15 + this.landingIntensity * 0.15;
        this.landingRecoverySpeedMult = 1 - this.landingIntensity * 0.4;

        // Dampen head bob on landing
        this.bobTime = 0;
      }

      this.velocity.y = 0;
      this.onGround = true;
      this.isJumping = false;

      // Consume jump buffer on landing
      if (this.jumpBuffered) {
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

    // Landing dip recovery
    if (this.landingDip > 0.001) {
      this.landingDip *= Math.max(0, 1 - delta * 8);
      this.camera.position.y -= this.landingDip;
    } else {
      this.landingDip = 0;
    }

    // Landing recovery timer
    if (this.landingRecoveryTimer > 0) {
      this.landingRecoveryTimer -= delta;
      if (this.landingRecoveryTimer <= 0) {
        this.landingRecoverySpeedMult = 1;
      }
    }

    // World bounds
    this.camera.position.x = Math.max(this.minX, Math.min(this.maxX, this.camera.position.x));
    this.camera.position.y = Math.max(-5, Math.min(95, this.camera.position.y));
    this.camera.position.z = Math.max(this.minZ, Math.min(this.maxZ, this.camera.position.z));

    // Head bob
    this.stepTriggered = false;
    const landingBobDampen = this.landingDip > 0.01 ? 0.2 : 1;

    if (this.onGround && this.horizontalSpeed > 1 && !this.isSliding) {
      const bobFreq = this.isSprinting ? 12 : this.isCrouching ? 6 : 8;
      const bobAmpY = (this.isSprinting ? 0.055 : this.isCrouching ? 0.02 : 0.035) * landingBobDampen;
      const bobAmpX = (this.isSprinting ? 0.028 : this.isCrouching ? 0.01 : 0.018) * landingBobDampen;
      const speedFactor = Math.min(1, this.horizontalSpeed / targetSpeed);

      this.bobTime += delta * bobFreq * speedFactor;
      // Primary + subtle 2nd harmonic for organic feel
      const primaryY = Math.sin(this.bobTime) * bobAmpY;
      const secondaryY = Math.sin(this.bobTime * 2.3) * bobAmpY * 0.08;
      this.headBobY = (primaryY + secondaryY) * speedFactor;

      const primaryX = Math.cos(this.bobTime * 0.5) * bobAmpX;
      const secondaryX = Math.cos(this.bobTime * 0.8) * bobAmpX * 0.1;
      this.headBobX = (primaryX + secondaryX) * speedFactor;

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
