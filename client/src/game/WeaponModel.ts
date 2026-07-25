import * as THREE from 'three';
import { WEAPON_MODELS } from './weaponModels';

/**
 * First-person weapon model rendered in a separate pass
 * to prevent wall clipping. Includes bob, sway, and recoil.
 */

export class WeaponModel {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;

  private weapons: THREE.Group[] = [];
  private basePositions: THREE.Vector3[] = [];
  private adsPositions: THREE.Vector3[] = [];
  /** Aim blend 0..1, set by Engine each frame. */
  private ads = 0;
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
  private queuedSwitchTarget: number | null = null;
  private switchSwapApplied = false;

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

    this.weapons = WEAPON_MODELS.map((def) => def.firstPerson());
    this.basePositions = WEAPON_MODELS.map((def) => new THREE.Vector3(...def.fpAnchor));
    this.adsPositions = WEAPON_MODELS.map((def) => new THREE.Vector3(...def.adsAnchor));

    this.weapons.forEach((w) => this.scene.add(w));
    this.showWeapon(0);
  }


  private showWeapon(index: number): void {
    this.weapons.forEach((w, i) => {
      w.visible = i === index;
    });
    this.current = index;
  }

  switchWeapon(index: number): void {
    if (this.switching) {
      if (!this.switchSwapApplied) {
        this.switchTarget = index;
      } else {
        this.queuedSwitchTarget = index === this.current ? null : index;
      }
      return;
    }
    if (index === this.current) return;
    this.switching = true;
    this.switchTarget = index;
    this.queuedSwitchTarget = null;
    this.switchSwapApplied = false;
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
        if (!this.switchSwapApplied) {
          this.showWeapon(this.switchTarget);
          this.switchSwapApplied = true;
        }
        switchOffsetY = -0.3;
      } else if (this.switchTimer < 2) {
        // Rise back up
        switchOffsetY = -(2 - this.switchTimer) * 0.3;
      } else {
        this.switching = false;
        this.switchSwapApplied = false;
        switchOffsetY = 0;
        const queuedTarget = this.queuedSwitchTarget;
        this.queuedSwitchTarget = null;
        if (queuedTarget != null && queuedTarget !== this.current) {
          this.switchWeapon(queuedTarget);
        }
      }
    }

    // ── Apply transforms to active weapon ──
    const w = this.weapons[this.current];
    if (!w) return;

    // Blend the rest pose toward the sighted pose. `ads` is driven by Engine so
    // the model and the camera FOV move on exactly the same curve — if these
    // drift apart the sights visibly slide off centre mid-transition.
    const ads = this.ads;
    const hip = this.getBasePos(this.current);
    const aim = this.getAdsPos(this.current);
    const baseX = hip.x + (aim.x - hip.x) * ads;
    const baseY = hip.y + (aim.y - hip.y) * ads;
    const baseZ = hip.z + (aim.z - hip.z) * ads;

    // Aiming suppresses the idle/movement sway that makes hip-fire feel loose.
    // Left in at full strength it fights the sight alignment and reads as drift.
    const sway = 1 - ads * 0.88;

    // Movement reactions
    const weaponTiltZ = -this.strafeTilt * 0.04 * sway; // ~2.3 degrees at the hip
    const sprintLowerY = -this.sprintLower * 0.06;
    const sprintLowerRot = this.sprintLower * 0.15;
    const slideOffsetX = this.isSliding ? -0.05 : 0;
    const slideLowerY = this.isSliding ? -0.04 : 0;

    w.position.x = baseX + (bobX + slideOffsetX) * sway;
    w.position.y = baseY + (bobY + sprintLowerY + slideLowerY) * sway + switchOffsetY;
    // Recoil punch stays mostly intact while aimed — it is the shot's feedback.
    w.position.z = baseZ + this.recoilZ * 0.015 * (1 - ads * 0.35);
    w.rotation.x = this.recoilRot * 0.05 * (1 - ads * 0.35) + sprintLowerRot * sway;
    w.rotation.z = weaponTiltZ;
  }

  /**
   * Aim blend, 0 (hip) to 1 (fully sighted). Engine owns the easing so the
   * weapon pose, camera FOV and sensitivity all move together.
   */
  setAds(t: number): void {
    this.ads = Math.max(0, Math.min(1, t));
  }

  /** Sighted position of a weapon in view space; owned by the weapon's model file. */
  private getAdsPos(index: number): THREE.Vector3 {
    return this.adsPositions[index] ?? this.adsPositions[0]!;
  }

  /** Rest position of a weapon in view space; owned by the weapon's model file. */
  private getBasePos(index: number): THREE.Vector3 {
    return this.basePositions[index] ?? this.basePositions[0]!;
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
