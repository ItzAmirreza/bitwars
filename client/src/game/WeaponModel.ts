import * as THREE from 'three';

/**
 * First-person weapon model rendered in a separate pass
 * to prevent wall clipping. Includes bob, sway, and recoil.
 */

export class WeaponModel {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;

  private weapons: THREE.Group[] = [];
  private current = 0;
  private bobTime = 0;
  private isMoving = false;
  private isSprinting = false;
  private isCrouching = false;
  private isSliding = false;
  private strafeInput = 0;

  // Smoothed movement reactions
  private strafeTilt = 0;
  private sprintLower = 0;

  // Recoil
  private recoilZ = 0;
  private recoilRot = 0;

  // Switch animation
  private switchTimer = 0;
  private switching = false;
  private switchTarget = 0;

  constructor(aspect: number) {
    // Dedicated scene + camera for weapon overlay
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.01, 10);

    // Lighting for weapon scene
    const ambient = new THREE.AmbientLight(0x8899bb, 1.0);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xfff0d0, 1.8);
    dir.position.set(1, 2, 1);
    this.scene.add(dir);

    this.weapons = [
      this.buildRifle(),
      this.buildShotgun(),
      this.buildRPG(),
      this.buildMachineGun(),
      this.buildGrenadeLauncher(),
    ];

    this.weapons.forEach((w) => this.scene.add(w));
    this.showWeapon(0);
  }

  private createMaterial(
    color: number,
    roughness: number,
    metalness: number,
    emissive = 0x000000,
    emissiveIntensity = 0,
  ): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      emissive,
      emissiveIntensity,
    });
  }

  // ── Rifle: Sleek angular design ──
  private buildRifle(): THREE.Group {
    const g = new THREE.Group();
    const dark = this.createMaterial(0x1a1a22, 0.42, 0.78);
    const accent = this.createMaterial(0x2244aa, 0.32, 0.55, 0x112244, 0.45);
    const metal = this.createMaterial(0x3a3a44, 0.28, 0.84);

    // Barrel
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.55), dark);
    barrel.position.set(0, 0, -0.25);
    g.add(barrel);

    // Upper receiver
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.22), metal);
    upper.position.set(0, 0.01, 0.02);
    g.add(upper);

    // Magazine
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), dark);
    mag.position.set(0, -0.06, 0.04);
    mag.rotation.x = -0.15;
    g.add(mag);

    // Stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.15), metal);
    stock.position.set(0, -0.01, 0.18);
    g.add(stock);

    // Blue accent stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.008, 0.12), accent);
    stripe.position.set(0, 0.04, -0.06);
    g.add(stripe);

    // Sight
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.025, 0.015), accent);
    sight.position.set(0, 0.055, -0.1);
    g.add(sight);

    g.position.set(0.28, -0.26, -0.45);
    g.rotation.set(0, 0, 0);
    return g;
  }

  // ── Shotgun: Chunky double barrel ──
  private buildShotgun(): THREE.Group {
    const g = new THREE.Group();
    const wood = this.createMaterial(0x5a3a1a, 0.86, 0.12);
    const dark = this.createMaterial(0x1a1a1a, 0.36, 0.72);
    const accent = this.createMaterial(0xcc6600, 0.38, 0.35, 0x552200, 0.35);

    // Double barrel
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), dark);
    b1.position.set(-0.02, 0, -0.2);
    g.add(b1);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), dark);
    b2.position.set(0.02, 0, -0.2);
    g.add(b2);

    // Barrel band
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.02), accent);
    band.position.set(0, 0, -0.15);
    g.add(band);

    // Pump grip
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.1), wood);
    pump.position.set(0, -0.01, -0.02);
    g.add(pump);

    // Stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.2), wood);
    stock.position.set(0, -0.01, 0.18);
    g.add(stock);

    // Orange accent
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.006, 0.08), accent);
    line.position.set(0, 0.035, 0.05);
    g.add(line);

    g.position.set(0.3, -0.28, -0.42);
    return g;
  }

  // ── RPG: Tube launcher ──
  private buildRPG(): THREE.Group {
    const g = new THREE.Group();
    const olive = this.createMaterial(0x3a4a2a, 0.74, 0.22);
    const dark = this.createMaterial(0x1a1a1a, 0.35, 0.76);
    const red = this.createMaterial(0xcc2200, 0.34, 0.28, 0x551100, 0.4);

    // Main tube
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 8), olive);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0, -0.1);
    g.add(tube);

    // Front flare
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.08, 8), dark);
    flare.rotation.x = Math.PI / 2;
    flare.position.set(0, 0, -0.42);
    g.add(flare);

    // Rear guard
    const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 8), dark);
    rear.rotation.x = Math.PI / 2;
    rear.position.set(0, 0, 0.22);
    g.add(rear);

    // Grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), dark);
    grip.position.set(0, -0.08, 0.05);
    grip.rotation.x = -0.2;
    g.add(grip);

    // Sight
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.01), red);
    sight.position.set(0, 0.06, -0.15);
    g.add(sight);

    // Red stripe
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.044, 0.03), red);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.set(0, 0, -0.3);
    g.add(stripe);

    // Warhead tip (visible in tube)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 6), red);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0, -0.45);
    g.add(tip);

    g.position.set(0.32, -0.3, -0.38);
    return g;
  }

  // ── Machine Gun: Belt-fed bruiser ──
  private buildMachineGun(): THREE.Group {
    const g = new THREE.Group();
    const body = this.createMaterial(0x1a222c, 0.34, 0.82);
    const steel = this.createMaterial(0x3b4658, 0.28, 0.9);
    const cyan = this.createMaterial(0x2a8fa8, 0.36, 0.45, 0x115566, 0.5);

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.58), steel);
    barrel.position.set(0, 0.01, -0.24);
    g.add(barrel);

    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.28), body);
    shroud.position.set(0, 0.015, -0.02);
    g.add(shroud);

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.18), steel);
    receiver.position.set(0, 0.01, 0.16);
    g.add(receiver);

    const boxMag = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.09), body);
    boxMag.position.set(-0.02, -0.07, 0.1);
    g.add(boxMag);

    const carry = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.17), cyan);
    carry.position.set(0, 0.065, 0.08);
    g.add(carry);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.16), steel);
    stock.position.set(0, -0.005, 0.3);
    g.add(stock);

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.03), cyan);
    muzzle.position.set(0, 0.01, -0.53);
    g.add(muzzle);

    g.position.set(0.3, -0.26, -0.46);
    return g;
  }

  // ── Grenade Launcher: Heavy drum-fed arc cannon ──
  private buildGrenadeLauncher(): THREE.Group {
    const g = new THREE.Group();
    const dark = this.createMaterial(0x1c1f22, 0.42, 0.72);
    const olive = this.createMaterial(0x3a4d2a, 0.68, 0.28);
    const green = this.createMaterial(0x52b82f, 0.3, 0.22, 0x17480f, 0.45);

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.52, 10), olive);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.01, -0.18);
    g.add(tube);

    const breech = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.15), dark);
    breech.position.set(0, 0.01, 0.12);
    g.add(breech);

    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 8), dark);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, -0.07, 0.06);
    g.add(drum);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), dark);
    grip.position.set(0, -0.08, 0.2);
    grip.rotation.x = -0.22;
    g.add(grip);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.17), olive);
    stock.position.set(0, -0.005, 0.33);
    g.add(stock);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 6, 10), green);
    ring.position.set(0, 0.01, -0.43);
    g.add(ring);

    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), green);
    sight.position.set(0, 0.065, -0.08);
    g.add(sight);

    g.position.set(0.31, -0.29, -0.4);
    return g;
  }

  private showWeapon(index: number): void {
    this.weapons.forEach((w, i) => {
      w.visible = i === index;
    });
    this.current = index;
  }

  switchWeapon(index: number): void {
    if (index === this.current || this.switching) return;
    this.switching = true;
    this.switchTarget = index;
    this.switchTimer = 0;
  }

  triggerRecoil(amount: number): void {
    this.recoilZ = amount * 6;
    this.recoilRot = -amount * 3;
  }

  setMoving(moving: boolean, sprinting = false, crouching = false,
            sliding = false, strafeInput = 0): void {
    this.isMoving = moving;
    this.isSprinting = sprinting;
    this.isCrouching = crouching;
    this.isSliding = sliding;
    this.strafeInput = strafeInput;
  }

  update(delta: number): void {
    // ── Bob — varies with movement state ──
    let bobY: number, bobX: number;

    if (this.isSliding) {
      // Minimal vibration during slide
      this.bobTime += delta * 12;
      bobY = Math.sin(this.bobTime * 2.5) * 0.004;
      bobX = Math.cos(this.bobTime * 1.5) * 0.003;
    } else if (this.isMoving) {
      const bobSpeed = this.isSprinting ? 14 : this.isCrouching ? 6 : 10;
      this.bobTime += delta * bobSpeed;
      const ampY = this.isSprinting ? 0.018 : this.isCrouching ? 0.006 : 0.012;
      const ampX = this.isSprinting ? 0.01 : this.isCrouching ? 0.003 : 0.006;
      bobY = Math.sin(this.bobTime) * ampY;
      bobX = Math.cos(this.bobTime * 0.5) * ampX;
    } else {
      this.bobTime += delta * 1.5;
      bobY = Math.sin(this.bobTime) * 0.003;
      bobX = 0;
    }

    // ── Strafe tilt (smooth) ──
    const tiltLerp = 1 - Math.pow(0.001, delta);
    this.strafeTilt += (this.strafeInput - this.strafeTilt) * tiltLerp;

    // ── Sprint weapon lower (smooth) ──
    const targetSprintLower = this.isSprinting ? 1 : 0;
    const lowerLerp = 1 - Math.pow(0.01, delta);
    this.sprintLower += (targetSprintLower - this.sprintLower) * lowerLerp;

    // ── Recoil decay ──
    this.recoilZ *= Math.max(0, 1 - delta * 18);
    this.recoilRot *= Math.max(0, 1 - delta * 18);
    if (Math.abs(this.recoilZ) < 0.001) this.recoilZ = 0;

    // ── Switch animation ──
    let switchOffsetY = 0;
    if (this.switching) {
      this.switchTimer += delta * 5;

      if (this.switchTimer < 1) {
        // Drop down
        switchOffsetY = -this.switchTimer * 0.3;
      } else if (this.switchTimer < 1.1) {
        // Swap model at bottom
        this.showWeapon(this.switchTarget);
        switchOffsetY = -0.3;
      } else if (this.switchTimer < 2) {
        // Rise back up
        switchOffsetY = -(2 - this.switchTimer) * 0.3;
      } else {
        this.switching = false;
        switchOffsetY = 0;
      }
    }

    // ── Apply transforms to active weapon ──
    const w = this.weapons[this.current];
    if (!w) return;

    const base = this.getBasePos(this.current);

    // Movement reactions
    const weaponTiltZ = -this.strafeTilt * 0.04; // ~2.3 degrees
    const sprintLowerY = -this.sprintLower * 0.06;
    const sprintLowerRot = this.sprintLower * 0.15;
    const slideOffsetX = this.isSliding ? -0.05 : 0;
    const slideLowerY = this.isSliding ? -0.04 : 0;

    w.position.x = base.x + bobX + slideOffsetX;
    w.position.y = base.y + bobY + switchOffsetY + sprintLowerY + slideLowerY;
    w.position.z = base.z + this.recoilZ * 0.015;
    w.rotation.x = this.recoilRot * 0.05 + sprintLowerRot;
    w.rotation.z = weaponTiltZ;
  }

  private getBasePos(index: number): THREE.Vector3 {
    const positions = [
      new THREE.Vector3(0.28, -0.26, -0.45),  // Rifle
      new THREE.Vector3(0.30, -0.28, -0.42),  // Shotgun
      new THREE.Vector3(0.32, -0.30, -0.38),  // RPG
      new THREE.Vector3(0.30, -0.26, -0.46),  // Machine Gun
      new THREE.Vector3(0.31, -0.29, -0.40),  // Grenade Launcher
    ];
    return positions[index] || positions[0];
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.weapons.forEach((w) => {
      w.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    });
  }
}
