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

  private mat(color: number, emissive?: number): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({
      color,
      ...(emissive != null ? { emissive, emissiveIntensity: 0.4 } : {}),
    });
  }

  // ── Rifle: Blocky assault rifle ──
  private buildRifle(): THREE.Group {
    const g = new THREE.Group();
    const dark = this.mat(0x1a1a22);
    const metal = this.mat(0x3a3a44);
    const accent = this.mat(0x2244aa, 0x112244);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.3), metal);
    body.position.set(0, 0, 0);
    g.add(body);

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.35), dark);
    barrel.position.set(0, 0, -0.3);
    g.add(barrel);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.05), dark);
    mag.position.set(0, -0.08, 0.02);
    g.add(mag);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.015, 0.15), accent);
    stripe.position.set(0, 0.04, -0.08);
    g.add(stripe);

    g.position.set(0.28, -0.26, -0.45);
    return g;
  }

  // ── Shotgun: Chunky double block ──
  private buildShotgun(): THREE.Group {
    const g = new THREE.Group();
    const wood = this.mat(0x5a3a1a);
    const dark = this.mat(0x1a1a1a);
    const accent = this.mat(0xcc6600, 0x552200);

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.4), dark);
    barrel.position.set(0, 0, -0.18);
    g.add(barrel);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.2), wood);
    body.position.set(0, 0, 0.08);
    g.add(body);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.18), wood);
    stock.position.set(0, -0.01, 0.24);
    g.add(stock);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.015, 0.06), accent);
    stripe.position.set(0, 0.04, -0.1);
    g.add(stripe);

    g.position.set(0.3, -0.28, -0.42);
    return g;
  }

  // ── RPG: Big square tube ──
  private buildRPG(): THREE.Group {
    const g = new THREE.Group();
    const olive = this.mat(0x3a4a2a);
    const dark = this.mat(0x1a1a1a);
    const red = this.mat(0xcc2200, 0x551100);

    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.5), olive);
    tube.position.set(0, 0, -0.1);
    g.add(tube);

    const flare = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.06), dark);
    flare.position.set(0, 0, -0.38);
    g.add(flare);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), dark);
    grip.position.set(0, -0.08, 0.05);
    g.add(grip);

    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), red);
    tip.position.set(0, 0, -0.44);
    g.add(tip);

    g.position.set(0.32, -0.3, -0.38);
    return g;
  }

  // ── Machine Gun: Boxy belt-fed ──
  private buildMachineGun(): THREE.Group {
    const g = new THREE.Group();
    const body = this.mat(0x1a222c);
    const steel = this.mat(0x3b4658);
    const cyan = this.mat(0x2a8fa8, 0x115566);

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.45), steel);
    barrel.position.set(0, 0.01, -0.2);
    g.add(barrel);

    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.22), body);
    shroud.position.set(0, 0.01, 0.04);
    g.add(shroud);

    const boxMag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.08), body);
    boxMag.position.set(-0.02, -0.06, 0.08);
    g.add(boxMag);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.14), steel);
    stock.position.set(0, -0.005, 0.24);
    g.add(stock);

    const accent = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.015, 0.14), cyan);
    accent.position.set(0, 0.06, 0.04);
    g.add(accent);

    g.position.set(0.3, -0.26, -0.46);
    return g;
  }

  // ── Grenade Launcher: Square tube with drum cube ──
  private buildGrenadeLauncher(): THREE.Group {
    const g = new THREE.Group();
    const dark = this.mat(0x1c1f22);
    const olive = this.mat(0x3a4d2a);
    const green = this.mat(0x52b82f, 0x17480f);

    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.4), olive);
    tube.position.set(0, 0.01, -0.12);
    g.add(tube);

    const breech = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.12), dark);
    breech.position.set(0, 0.01, 0.14);
    g.add(breech);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.15), olive);
    stock.position.set(0, -0.005, 0.28);
    g.add(stock);

    const drum = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), green);
    drum.position.set(0, -0.08, 0.06);
    g.add(drum);

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
