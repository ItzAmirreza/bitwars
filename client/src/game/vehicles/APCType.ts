/**
 * APCType.ts — VehicleType implementation for the Armored Personnel Carrier.
 *
 * Heavy ground vehicle with 4 seats. Driver cannot fire weapons.
 * Strong block collision resistance — plows through terrain.
 * Voxel model: angular military hull, angled front, commander hatch,
 * side windows, rear door, treads.
 */

import * as THREE from 'three';
import { BlockType } from '../VoxelWorld';
import { VEHICLE_TYPES, APC } from '../../shared-config';
import type {
  VehicleType,
  VehicleInstance,
  VehicleCameraConfig,
  BreakupPiece,
  VehicleTypeFrameContext,
  VehicleTypeDestroyContext,
} from './VehicleBase';

// ── Constants ──
const VEHICLE_TYPE_APC = VEHICLE_TYPES.APC;
const APC_BREAKUP_GRAVITY = 18;
const APC_HIT_INDICATOR_DURATION = 0.3;

export class APCType implements VehicleType {
  readonly typeId = VEHICLE_TYPE_APC;
  readonly name = 'APC';

  getHealthMax(): number {
    return APC.healthMax;
  }

  getMountRange(): number {
    return APC.mountRange;
  }

  getCameraConfig(): VehicleCameraConfig {
    return {
      distance: APC.camera.distance,
      height: APC.camera.height,
      pitchMin: APC.camera.pitchMin,
      pitchMax: APC.camera.pitchMax,
    };
  }

  getPilotSeatHeight(): number {
    return APC.pilotSeatHeight;
  }

  // ══════════════════════════════════════════════════════════════
  //  MODEL BUILDER
  // ══════════════════════════════════════════════════════════════

  createModel(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'apc-root';

    // ── Shared voxel-style material ──
    const voxMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0x0a0e08),
      emissiveIntensity: 0.30,
      shininess: 6,
      specular: new THREE.Color(0x111418),
    });

    const FACE_SHADE = [0.85, 0.85, 1.0, 0.7, 0.9, 0.9];

    let _partSeed = 0;
    const partVariation = (): number => {
      _partSeed++;
      const h = ((_partSeed * 374761393) ^ (_partSeed * 668265263)) | 0;
      return ((((h ^ (h >> 13)) * 1274126177) ^ ((h >> 16))) & 0x7fffffff) / 0x7fffffff;
    };

    const shadedBox = (
      parent: THREE.Object3D,
      size: [number, number, number],
      baseHex: number,
      pos: [number, number, number],
      rot: [number, number, number] = [0, 0, 0],
    ): THREE.Mesh => {
      const geo = new THREE.BoxGeometry(...size);
      const posAttr = geo.getAttribute('position');
      const normalAttr = geo.getAttribute('normal');
      const colors = new Float32Array(posAttr.count * 3);
      const c = new THREE.Color(baseHex);

      const v = (partVariation() - 0.5) * 0.06;
      const br = Math.max(0, Math.min(1, c.r + v));
      const bg = Math.max(0, Math.min(1, c.g + v));
      const bb = Math.max(0, Math.min(1, c.b + v));

      for (let i = 0; i < posAttr.count; i++) {
        const nx = normalAttr.getX(i);
        const ny = normalAttr.getY(i);
        const nz = normalAttr.getZ(i);

        let shade = 0.85;
        if (nx > 0.5) shade = FACE_SHADE[0];
        else if (nx < -0.5) shade = FACE_SHADE[1];
        else if (ny > 0.5) shade = FACE_SHADE[2];
        else if (ny < -0.5) shade = FACE_SHADE[3];
        else if (nz > 0.5) shade = FACE_SHADE[4];
        else if (nz < -0.5) shade = FACE_SHADE[5];

        colors[i * 3 + 0] = br * shade;
        colors[i * 3 + 1] = bg * shade;
        colors[i * 3 + 2] = bb * shade;
      }

      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geo, voxMat);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const B = (
      parent: THREE.Object3D, size: [number, number, number],
      hex: number, pos: [number, number, number], rot?: [number, number, number],
    ) => shadedBox(parent, size, hex, pos, rot);

    // ── Color palette (olive drab military) ──
    const HULL      = 0x4a5a3a;
    const HULL_LT   = 0x5a6a4a;
    const HULL_DK   = 0x3a4a2a;
    const ARMOR     = 0x3e4e2e;
    const METAL_DK  = 0x2a2e30;
    const TREAD     = 0x1e2220;
    const TREAD_LT  = 0x2a2e28;
    const WINDOW    = 0x1a2a35;
    const ACCENT    = 0xffaa00;
    const ACCENT_R  = 0xff3322;
    const DARK      = 0x151810;

    // ═══════════════════════════════════════════════
    //  HULL (main body — long armored box)
    // ═══════════════════════════════════════════════
    const hull = new THREE.Group();
    hull.name = 'hull';
    root.add(hull);

    // Lower hull (chassis)
    B(hull, [3.6, 1.4, 8.0], HULL, [0, 1.2, 0]);
    // Upper hull (troop compartment)
    B(hull, [3.2, 1.2, 6.5], HULL_LT, [0, 2.5, -0.4]);
    // Roof
    B(hull, [3.4, 0.2, 7.0], HULL_DK, [0, 3.15, -0.1]);

    // ── Front glacis plate (angled armor) ──
    B(hull, [3.2, 1.0, 0.3], ARMOR, [0, 2.2, 3.85], [-0.3, 0, 0]);
    // Lower front plate
    B(hull, [3.4, 0.5, 0.3], HULL_DK, [0, 1.0, 3.95]);

    // ── Rear door ──
    B(hull, [2.8, 2.0, 0.25], HULL_DK, [0, 1.9, -4.05]);
    // Door hinges
    B(hull, [0.15, 0.3, 0.15], METAL_DK, [-1.2, 2.6, -4.15]);
    B(hull, [0.15, 0.3, 0.15], METAL_DK, [1.2, 2.6, -4.15]);
    // Door handle
    B(hull, [0.4, 0.1, 0.1], ACCENT, [0, 1.8, -4.2]);

    // ── Side armor plates ──
    for (const side of [-1, 1]) {
      B(hull, [0.2, 0.8, 6.5], ARMOR, [side * 1.7, 1.6, -0.4]);
      // Storage boxes on sides
      B(hull, [0.3, 0.5, 1.2], HULL_DK, [side * 1.9, 1.0, 1.5]);
      B(hull, [0.3, 0.5, 1.0], HULL_DK, [side * 1.9, 1.0, -1.8]);
    }

    // ═══════════════════════════════════════════════
    //  WINDOWS (4 windows — 2 per side)
    // ═══════════════════════════════════════════════
    for (const side of [-1, 1]) {
      // Front window
      B(hull, [0.08, 0.4, 0.6], WINDOW, [side * 1.65, 2.6, 1.2]);
      // Rear window
      B(hull, [0.08, 0.4, 0.6], WINDOW, [side * 1.65, 2.6, -1.4]);
      // Window frames
      B(hull, [0.06, 0.5, 0.08], METAL_DK, [side * 1.66, 2.6, 0.88]);
      B(hull, [0.06, 0.5, 0.08], METAL_DK, [side * 1.66, 2.6, 1.52]);
      B(hull, [0.06, 0.5, 0.08], METAL_DK, [side * 1.66, 2.6, -1.72]);
      B(hull, [0.06, 0.5, 0.08], METAL_DK, [side * 1.66, 2.6, -1.08]);
    }

    // ═══════════════════════════════════════════════
    //  DRIVER VIEWPORT (front windshield — armored slit)
    // ═══════════════════════════════════════════════
    B(hull, [2.0, 0.25, 0.08], WINDOW, [0, 2.85, 2.85]);
    // Windshield armor frame
    B(hull, [2.2, 0.08, 0.1], METAL_DK, [0, 3.0, 2.86]);
    B(hull, [2.2, 0.08, 0.1], METAL_DK, [0, 2.7, 2.86]);

    // ═══════════════════════════════════════════════
    //  COMMANDER HATCH (top)
    // ═══════════════════════════════════════════════
    B(hull, [0.7, 0.1, 0.7], HULL_DK, [0, 3.3, 1.5]);
    // Hatch ring
    B(hull, [0.8, 0.06, 0.8], METAL_DK, [0, 3.25, 1.5]);
    // Hatch handle
    B(hull, [0.3, 0.08, 0.08], DARK, [0.2, 3.36, 1.5]);

    // ═══════════════════════════════════════════════
    //  TRACKS / TREADS (left and right)
    // ═══════════════════════════════════════════════
    const treadGroup = new THREE.Group();
    treadGroup.name = 'treads';
    hull.add(treadGroup);

    for (const side of [-1, 1]) {
      // Track housing
      B(treadGroup, [0.6, 0.9, 8.4], TREAD, [side * 2.0, 0.65, 0]);
      // Track top guard
      B(treadGroup, [0.7, 0.15, 8.6], HULL_DK, [side * 2.0, 1.15, 0]);
      // Track segments (visual detail)
      for (let i = -4; i <= 4; i++) {
        B(treadGroup, [0.62, 0.08, 0.15], TREAD_LT, [side * 2.0, 0.2, i * 0.9]);
      }
      // Drive sprockets (front and rear)
      B(treadGroup, [0.3, 0.5, 0.5], METAL_DK, [side * 2.0, 0.6, 3.6]);
      B(treadGroup, [0.3, 0.5, 0.5], METAL_DK, [side * 2.0, 0.6, -3.6]);
      // Road wheels
      for (let i = -2; i <= 2; i++) {
        B(treadGroup, [0.2, 0.4, 0.4], HULL_DK, [side * 2.0, 0.5, i * 1.5]);
      }
    }

    // ═══════════════════════════════════════════════
    //  DETAILS & ACCENTS
    // ═══════════════════════════════════════════════

    // Antenna whip
    B(hull, [0.06, 2.5, 0.06], HULL_DK, [-1.3, 3.4, -2.5]);
    // Secondary antenna
    B(hull, [0.05, 1.5, 0.05], HULL_DK, [1.1, 3.2, -2.0]);

    // Front headlights
    B(hull, [0.2, 0.2, 0.15], ACCENT, [-1.4, 1.6, 4.0]);
    B(hull, [0.2, 0.2, 0.15], ACCENT, [1.4, 1.6, 4.0]);

    // Rear taillights
    B(hull, [0.2, 0.2, 0.12], ACCENT_R, [-1.3, 1.6, -4.15]);
    B(hull, [0.2, 0.2, 0.12], ACCENT_R, [1.3, 1.6, -4.15]);

    // Front tow hooks
    B(hull, [0.3, 0.15, 0.2], METAL_DK, [-1.0, 0.8, 4.1]);
    B(hull, [0.3, 0.15, 0.2], METAL_DK, [1.0, 0.8, 4.1]);

    // Bull bar / ram plate (front bumper — for that ramming feel)
    B(hull, [3.8, 0.6, 0.3], METAL_DK, [0, 0.8, 4.2]);
    B(hull, [3.8, 0.15, 0.15], DARK, [0, 1.15, 4.25]);

    // Exhaust pipes (rear)
    B(hull, [0.15, 0.15, 0.4], DARK, [-1.5, 1.1, -4.2]);
    B(hull, [0.15, 0.15, 0.4], DARK, [1.5, 1.1, -4.2]);

    // Side markings (chevrons — simple accent stripes)
    for (const side of [-1, 1]) {
      B(hull, [0.06, 0.12, 1.2], ACCENT, [side * 1.82, 2.1, 0]);
    }

    // Roof-mounted spotlight
    B(hull, [0.2, 0.2, 0.3], HULL_DK, [0.8, 3.3, 2.0]);
    B(hull, [0.15, 0.15, 0.15], ACCENT, [0.8, 3.3, 2.2]);

    // ── Hit indicator ──
    const hitIndicator = new THREE.Group();
    hitIndicator.name = 'apc-hit-indicator';
    hitIndicator.position.set(0, 4.0, 0);
    hitIndicator.visible = false;
    root.add(hitIndicator);

    const hitIndicatorMat = new THREE.MeshBasicMaterial({
      color: 0xffd966,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    const addIndicatorBar = (
      size: [number, number, number],
      pos: [number, number, number],
    ): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), hitIndicatorMat);
      mesh.position.set(...pos);
      mesh.renderOrder = 20;
      hitIndicator.add(mesh);
    };

    addIndicatorBar([1.8, 0.14, 0.18], [0, 0, 0]);
    addIndicatorBar([0.18, 0.14, 1.8], [0, 0, 0]);
    addIndicatorBar([0.24, 0.9, 0.24], [0, -0.35, 0]);

    // Orient wrapper — model faces +Z, wrapper rotates so -Z forward matches server
    const orientWrapper = new THREE.Group();
    orientWrapper.name = 'apc-orient-wrapper';
    while (root.children.length > 0) {
      orientWrapper.add(root.children[0]);
    }
    root.add(orientWrapper);

    return root;
  }

  // ══════════════════════════════════════════════════════════════
  //  PER-FRAME ANIMATION
  // ══════════════════════════════════════════════════════════════

  updatePerFrame(
    instance: VehicleInstance,
    delta: number,
    _isLocal: boolean,
    ctx: VehicleTypeFrameContext,
  ): void {
    const mesh = instance.mesh;
    const vehicleRow = ctx.getVehicleRow(instance.entityId);

    // ── Hit indicator ──
    if (vehicleRow) {
      const health = Number(vehicleRow.health ?? this.getHealthMax());
      const prevHealth = Number(mesh.userData.lastVehicleHealth ?? health);
      if (health < prevHealth) {
        const damageTaken = prevHealth - health;
        mesh.userData.hitIndicatorTimer = APC_HIT_INDICATOR_DURATION;
        mesh.userData.hitIndicatorStrength = THREE.MathUtils.clamp(
          0.6 + damageTaken / 40,
          0.7,
          1.45,
        );
      }
      mesh.userData.lastVehicleHealth = health;
    }

    const hitIndicator = mesh.getObjectByName('apc-hit-indicator');
    const hitIndicatorTimer = Math.max(
      0,
      Number(mesh.userData.hitIndicatorTimer ?? 0) - delta,
    );
    mesh.userData.hitIndicatorTimer = hitIndicatorTimer;
    if (hitIndicator) {
      const strength = Number(mesh.userData.hitIndicatorStrength ?? 1);
      const t = hitIndicatorTimer / APC_HIT_INDICATOR_DURATION;
      const alpha = Math.max(0, t * (0.55 + strength * 0.22));
      hitIndicator.visible = alpha > 0.02;
      hitIndicator.position.y = 4.0 + (1 - t) * 0.25;
      const scale = 0.9 + (1 - t) * 0.45 * strength;
      hitIndicator.scale.setScalar(scale);
      hitIndicator.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.opacity = alpha;
          child.material.color.setHex(t > 0.55 ? 0xfff2a6 : 0xff6a4a);
        }
      });
    }

    // ── Tread animation (scroll based on speed) ──
    const orientWrapper = mesh.getObjectByName('apc-orient-wrapper');
    if (orientWrapper) {
      // Subtle body sway based on speed
      const speed = Math.sqrt(
        (instance.buffer as any)?.lastVx ** 2 + (instance.buffer as any)?.lastVz ** 2,
      ) || 0;
      const sway = Math.sin(ctx.elapsedTime * 3.5) * Math.min(speed * 0.001, 0.015);
      orientWrapper.rotation.z = sway;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  DESTRUCTION
  // ══════════════════════════════════════════════════════════════

  onDestroy(
    instance: VehicleInstance,
    ctx: VehicleTypeDestroyContext,
  ): BreakupPiece[] {
    return APCType.spawnBreakup(
      {
        x: instance.mesh.position.x,
        y: instance.mesh.position.y,
        z: instance.mesh.position.z,
      },
      instance.mesh.rotation.y,
      1,
      ctx,
    );
  }

  static spawnBreakup(
    pos: { x: number; y: number; z: number },
    yaw: number,
    intensity: number,
    ctx: VehicleTypeDestroyContext,
  ): BreakupPiece[] {
    const fxIntensity = THREE.MathUtils.clamp(intensity, 0.55, 1.8);
    const colorPool = [0x3a4a2a, 0x4a5a3a, 0x2a3a1a, 0x5a6a4a, 0x1e2218, 0x2a2e30];
    const pieceCount = Math.floor(30 + fxIntensity * 15);
    const origin = new THREE.Vector3(pos.x, pos.y + 1.5, pos.z);
    const radial = new THREE.Vector3();

    // Primary explosion light
    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 2.5, z: pos.z },
      color: 0xff7a32,
      intensity: 12 * fxIntensity,
      distance: 40 + 15 * fxIntensity,
      decay: 1.4,
      ttl: 0.35,
      kind: 'generic',
    });
    // Secondary fire light
    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 1.0, z: pos.z },
      color: 0xff3a12,
      intensity: 8 * fxIntensity,
      distance: 28 + 10 * fxIntensity,
      decay: 1.7,
      ttl: 0.55,
      kind: 'generic',
    });

    const pieces: BreakupPiece[] = [];
    for (let i = 0; i < pieceCount; i++) {
      const sx = 0.3 + Math.random() * 1.2;
      const sy = 0.15 + Math.random() * 0.6;
      const sz = 0.3 + Math.random() * 1.2;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshStandardMaterial({
          color: colorPool[(Math.random() * colorPool.length) | 0],
          roughness: 0.8,
          metalness: 0.3,
        }),
      );

      const local = new THREE.Vector3(
        (Math.random() - 0.5) * 10.0,
        (Math.random() - 0.5) * 3.5 + 1.5,
        (Math.random() - 0.5) * 12.0,
      );
      local.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      mesh.position.copy(origin).add(local);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      ctx.scene.add(mesh);

      radial.copy(local).normalize();
      if (!Number.isFinite(radial.x)) radial.set(0, 1, 0);
      const vel = radial
        .multiplyScalar((5 + Math.random() * 10) * (0.85 + fxIntensity * 0.45))
        .add(new THREE.Vector3(0, (7 + Math.random() * 8) * (0.8 + fxIntensity * 0.4), 0));
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 7,
        (Math.random() - 0.5) * 7,
        (Math.random() - 0.5) * 7,
      );

      pieces.push({
        mesh,
        vel,
        angVel,
        ttl: 3.0 + Math.random() * 2.5 + fxIntensity * 0.5,
      });
    }

    // Explosion debris ring
    const ringBlocks: { x: number; y: number; z: number; blockType: number }[] = [];
    const baseY = Math.floor(pos.y + 1.0);
    const ringCount = Math.floor(32 + fxIntensity * 16);
    for (let i = 0; i < ringCount; i++) {
      const ang = (i / ringCount) * Math.PI * 2;
      const r = 3.0 + Math.random() * (3.0 + fxIntensity * 2.0);
      ringBlocks.push({
        x: Math.floor(pos.x + Math.cos(ang) * r),
        y: baseY + ((Math.random() * (2 + fxIntensity * 1.5)) | 0),
        z: Math.floor(pos.z + Math.sin(ang) * r),
        blockType: BlockType.Metal,
      });
    }
    const blastRadius = 7.0 + fxIntensity * 2.5;
    const blastPower = 30 + fxIntensity * 22;
    ctx.physics.spawnExplosionDebris(ringBlocks, pos.x, pos.y + 1.5, pos.z, blastRadius, blastPower);
    ctx.vfx.emitExplosion(pos.x, pos.y + 1.5, pos.z, blastRadius);
    ctx.vfx.emitExplosion(pos.x, pos.y + 2.5, pos.z, blastRadius * 0.6);
    ctx.vfx.emitImpact(pos.x, pos.y + 1.0, pos.z);
    ctx.vfx.emitImpact(pos.x + 1.5, pos.y + 1.5, pos.z - 0.8);
    ctx.audio.playExplosion({ position: { x: pos.x, y: pos.y + 1.5, z: pos.z } });
    ctx.applyExplosionCameraEffects(pos.x, pos.y + 1.5, pos.z, blastRadius, 120 + fxIntensity * 45);

    return pieces;
  }

  static readonly BREAKUP_GRAVITY = APC_BREAKUP_GRAVITY;
}
