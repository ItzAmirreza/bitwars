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

  speed = 12;
  jumpForce = 8;
  gravity = -25;
  sensitivity = 0.002;
  locked = false;

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
      case 'Space':
        if (this.onGround) {
          this.velocity.y = this.jumpForce;
          this.onGround = false;
          this.isJumping = true;
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
    }
  };

  update(delta: number, getHeight: (x: number, z: number) => number): void {
    // Horizontal movement
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

    const moveVec = new THREE.Vector3();
    moveVec.addScaledVector(forward, -this.direction.z);
    moveVec.addScaledVector(right, this.direction.x);
    moveVec.normalize().multiplyScalar(this.speed * delta);

    this.camera.position.x += moveVec.x;
    this.camera.position.z += moveVec.z;

    // Gravity
    this.velocity.y += this.gravity * delta;
    this.camera.position.y += this.velocity.y * delta;

    // Ground collision
    const groundHeight = getHeight(this.camera.position.x, this.camera.position.z) + 1.7;
    if (this.camera.position.y < groundHeight) {
      this.camera.position.y = groundHeight;
      this.velocity.y = 0;
      this.onGround = true;
      this.isJumping = false;
    }

    // World bounds
    this.camera.position.x = Math.max(this.minX, Math.min(this.maxX, this.camera.position.x));
    this.camera.position.y = Math.max(-5, Math.min(95, this.camera.position.y));
    this.camera.position.z = Math.max(this.minZ, Math.min(this.maxZ, this.camera.position.z));
  }

  dispose(): void {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
  }
}
