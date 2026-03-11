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
  headBobX = 0;
  headBobY = 0;
  stepTriggered = false;
  horizontalSpeed = 0;

  // Tuning
  speed = 12;
  sprintSpeed = 18;
  crouchSpeed = 5;
  jumpForce = 8;
  gravity = -25;
  gravityAscending = -18; // lighter gravity going up for floaty peak
  sensitivity = 0.002;
  locked = false;

  // Acceleration-based movement
  private groundAccel = 65;
  private groundFriction = 45;
  private airAccel = 18; // reduced air control
  private hVelX = 0;
  private hVelZ = 0;

  // Sprint/crouch keys
  private shiftDown = false;
  private ctrlDown = false;

  // Crouch interpolation
  private currentEyeHeight = 1.7;
  private targetEyeHeight = 1.7;
  private readonly standHeight = 1.7;
  private readonly crouchHeight = 1.0;

  // Coyote time
  private coyoteTimer = 0;
  private readonly coyoteTime = 0.1; // 100ms grace period

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

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= event.movementX * this.sensitivity;
    this.euler.x -= event.movementY * this.sensitivity;
    this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    switch (event.code) {
      case 'KeyW': case 'ArrowUp': this.moveForward = true; break;
      case 'KeyS': case 'ArrowDown': this.moveBackward = true; break;
      case 'KeyA': case 'ArrowLeft': this.moveLeft = true; break;
      case 'KeyD': case 'ArrowRight': this.moveRight = true; break;
      case 'ShiftLeft': case 'ShiftRight': this.shiftDown = true; break;
      case 'ControlLeft': case 'ControlRight':
        event.preventDefault();
        this.ctrlDown = true;
        break;
      case 'Space':
        if (this.onGround || this.coyoteTimer > 0) {
          this.velocity.y = this.jumpForce;
          this.onGround = false;
          this.isJumping = true;
          this.coyoteTimer = 0;
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
      case 'ShiftLeft': case 'ShiftRight': this.shiftDown = false; break;
      case 'ControlLeft': case 'ControlRight': this.ctrlDown = false; break;
    }
  };

  update(delta: number, getHeight: (x: number, z: number) => number): void {
    // Sprint and crouch state
    this.isSprinting = this.shiftDown && this.moveForward && !this.isCrouching && this.onGround;
    this.isCrouching = this.ctrlDown;

    // Target speed
    let targetSpeed = this.speed;
    if (this.isSprinting) targetSpeed = this.sprintSpeed;
    else if (this.isCrouching) targetSpeed = this.crouchSpeed;

    // Eye height interpolation
    this.targetEyeHeight = this.isCrouching ? this.crouchHeight : this.standHeight;
    const heightLerp = 1 - Math.pow(0.00001, delta); // smooth ~10ms
    this.currentEyeHeight += (this.targetEyeHeight - this.currentEyeHeight) * heightLerp;

    // Input direction
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
      // Accelerate toward desired direction
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
      // Friction when no input (ground only)
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

    // Clamp horizontal speed
    this.horizontalSpeed = Math.sqrt(this.hVelX * this.hVelX + this.hVelZ * this.hVelZ);
    if (this.horizontalSpeed > targetSpeed * 1.1) {
      const scale = targetSpeed * 1.1 / this.horizontalSpeed;
      this.hVelX *= scale;
      this.hVelZ *= scale;
      this.horizontalSpeed = targetSpeed * 1.1;
    }

    // Apply horizontal velocity
    this.camera.position.x += this.hVelX * delta;
    this.camera.position.z += this.hVelZ * delta;

    // Variable gravity (lighter when ascending for floaty peak feel)
    const grav = this.velocity.y > 0 ? this.gravityAscending : this.gravity;
    this.velocity.y += grav * delta;
    this.camera.position.y += this.velocity.y * delta;

    // Coyote time
    if (this.onGround) {
      this.coyoteTimer = this.coyoteTime;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - delta);
    }

    // Ground collision
    const groundHeight = getHeight(this.camera.position.x, this.camera.position.z) + this.currentEyeHeight;
    const wasOnGround = this.onGround;
    if (this.camera.position.y < groundHeight) {
      this.camera.position.y = groundHeight;
      this.velocity.y = 0;
      this.onGround = true;
      this.isJumping = false;
    } else if (this.camera.position.y > groundHeight + 0.2) {
      this.onGround = false;
      // Start coyote timer on edge departure
      if (wasOnGround && !this.isJumping) {
        this.coyoteTimer = this.coyoteTime;
      }
    }

    // World bounds
    this.camera.position.x = Math.max(this.minX, Math.min(this.maxX, this.camera.position.x));
    this.camera.position.y = Math.max(-5, Math.min(95, this.camera.position.y));
    this.camera.position.z = Math.max(this.minZ, Math.min(this.maxZ, this.camera.position.z));

    // Head bob
    this.stepTriggered = false;
    if (this.onGround && this.horizontalSpeed > 1) {
      const bobFreq = this.isSprinting ? 12 : this.isCrouching ? 6 : 8;
      const bobAmpY = this.isSprinting ? 0.055 : this.isCrouching ? 0.02 : 0.035;
      const bobAmpX = this.isSprinting ? 0.028 : this.isCrouching ? 0.01 : 0.018;
      const speedFactor = Math.min(1, this.horizontalSpeed / targetSpeed);

      this.bobTime += delta * bobFreq * speedFactor;
      this.headBobY = Math.sin(this.bobTime) * bobAmpY * speedFactor;
      this.headBobX = Math.cos(this.bobTime * 0.5) * bobAmpX * speedFactor;

      // Step trigger: when bob crosses zero going downward
      if (this.lastBobY >= 0 && this.headBobY < 0) {
        this.stepTriggered = true;
      }
      this.lastBobY = this.headBobY;
    } else {
      // Idle breathing sway
      this.bobTime += delta * 1.5;
      this.headBobY = Math.sin(this.bobTime) * 0.004;
      this.headBobX = Math.cos(this.bobTime * 0.7) * 0.002;
      this.lastBobY = this.headBobY;
    }
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
  }
}
