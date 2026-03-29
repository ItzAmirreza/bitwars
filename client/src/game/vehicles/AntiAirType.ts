/**
 * AntiAirType.ts — VehicleType implementation for the anti-air vehicle.
 *
 * Ground-based tracked vehicle with a rotating turret and dual-barrel autocannon
 * plus SAM missile launcher. Procedural voxel-style model.
 */

import * as THREE from 'three';
import { BlockType } from '../VoxelWorld';
import { VEHICLE_TYPES, ANTI_AIR } from '../../shared-config';
import type {
  VehicleType,
  VehicleInstance,
  VehicleCameraConfig,
  BreakupPiece,
  VehicleTypeFrameContext,
  VehicleTypeDestroyContext,
} from './VehicleBase';

// ── Constants ──
const VEHICLE_TYPE_ANTI_AIR = VEHICLE_TYPES.AntiAir;
const AA_BREAKUP_GRAVITY = 20;

export class AntiAirType implements VehicleType {
  readonly typeId = VEHICLE_TYPE_ANTI_AIR;
  readonly name = 'Anti-Air';

  getHealthMax(): number {
    return ANTI_AIR.healthMax;
  }

  getMountRange(): number {
    return ANTI_AIR.mountRange;
  }

  getCameraConfig(): VehicleCameraConfig {
    return {
      distance: ANTI_AIR.camera.distance,
      height: ANTI_AIR.camera.height,
      pitchMin: ANTI_AIR.camera.pitchMin,
      pitchMax: ANTI_AIR.camera.pitchMax,
    };
  }

  getPilotSeatHeight(): number {
    return ANTI_AIR.pilotSeatHeight;
  }

  // ══════════════════════════════════════════════════════════════
  //  MODEL BUILDER
  // ══════════════════════════════════════════════════════════════

  createModel(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'anti-air-root';

    // ── Shared voxel-style material ──
    const voxMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0x0c1210),
      emissiveIntensity: 0.32,
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

    // ── Color palette (olive drab / military green) ──
    const HULL      = 0x3a4032;
    const HULL_LT   = 0x4a5240;
    const HULL_DK   = 0x2a3022;
    const UNDER     = 0x1e2218;
    const DARK      = 0x151810;
    const TRACK_COL = 0x1a1c16;
    const WHEEL_COL = 0x222418;
    const ACCENT    = 0xff4433;
    const ACCENT2   = 0xffdd33;
    const RADAR_COL = 0x556655;
    const BARREL    = 0x3a3e42;
    const BARREL_TIP = 0xff8833;

    // ═══════════════════════════════════════════════
    //  HULL (main body, builds along +X = forward)
    // ═══════════════════════════════════════════════
    const hull = new THREE.Group();
    hull.name = 'hull';
    root.add(hull);

    // Main hull block
    B(hull, [7.0, 1.6, 3.6], HULL,    [0, 0.8, 0]);
    // Front slope
    B(hull, [2.0, 1.0, 3.2], HULL_LT, [4.2, 1.1, 0], [0, 0, -0.15]);
    // Rear plate
    B(hull, [1.5, 1.8, 3.4], HULL_DK, [-3.8, 0.9, 0]);
    // Top deck
    B(hull, [5.0, 0.25, 3.0], HULL_LT, [0, 1.65, 0]);
    // Undercarriage
    B(hull, [6.5, 0.3, 3.2], UNDER,   [0, -0.05, 0]);

    // Side skirts
    for (const side of [-1, 1]) {
      B(hull, [6.0, 0.9, 0.25], HULL_DK, [0, 0.5, side * 2.0]);
      // Armor plate detail
      B(hull, [2.0, 0.6, 0.1], HULL_LT, [1.5, 0.8, side * 2.15]);
      B(hull, [2.0, 0.6, 0.1], HULL_LT, [-1.0, 0.8, side * 2.15]);
    }

    // ── Driver viewport ──
    B(hull, [0.8, 0.3, 0.6], DARK, [4.5, 1.5, 0]);

    // ── Exhaust pipes (rear) ──
    for (const side of [-1, 1]) {
      B(hull, [0.8, 0.3, 0.3], DARK, [-4.2, 1.3, side * 0.8]);
    }

    // ═══════════════════════════════════════════════
    //  TRACKS (on each side)
    // ═══════════════════════════════════════════════
    for (const side of [-1, 1]) {
      const trackGroup = new THREE.Group();
      trackGroup.name = side < 0 ? 'track-left' : 'track-right';

      // Track belt
      B(trackGroup, [7.5, 0.8, 0.6], TRACK_COL, [0, 0.1, side * 2.5]);
      // Track top plate
      B(trackGroup, [7.0, 0.15, 0.5], HULL_DK,  [0, 0.55, side * 2.5]);

      // Wheels (road wheels)
      for (let w = -3; w <= 3; w++) {
        B(trackGroup, [0.3, 0.5, 0.3], WHEEL_COL, [w * 1.0, 0.0, side * 2.5]);
      }
      // Drive sprockets (front/rear)
      B(trackGroup, [0.4, 0.6, 0.4], WHEEL_COL, [3.5, 0.2, side * 2.5]);
      B(trackGroup, [0.4, 0.6, 0.4], WHEEL_COL, [-3.5, 0.2, side * 2.5]);

      hull.add(trackGroup);
    }

    // ═══════════════════════════════════════════════
    //  TURRET (rotates on yaw, child of root)
    // ═══════════════════════════════════════════════
    const turret = new THREE.Group();
    turret.name = 'turret';
    turret.position.set(-0.3, 1.8, 0);
    root.add(turret);

    // Turret base ring
    B(turret, [2.8, 0.4, 2.8], HULL_DK, [0, 0, 0]);
    // Turret body
    B(turret, [2.4, 1.2, 2.4], HULL,    [0, 0.8, 0]);
    // Turret top
    B(turret, [2.0, 0.2, 2.0], HULL_LT, [0, 1.45, 0]);
    // Front face (angled)
    B(turret, [0.3, 0.9, 2.0], HULL_LT, [1.3, 0.75, 0], [0, 0, -0.1]);

    // Commander's hatch
    B(turret, [0.5, 0.12, 0.5], HULL_DK, [-0.5, 1.55, 0]);

    // ── Autocannon barrels (dual barrel) ──
    const barrelGroup = new THREE.Group();
    barrelGroup.name = 'barrel-group';
    barrelGroup.position.set(1.4, 0.8, 0);
    turret.add(barrelGroup);

    // Left barrel
    B(barrelGroup, [4.0, 0.22, 0.22], BARREL,     [2.0, 0, -0.35]);
    B(barrelGroup, [0.3, 0.28, 0.28], BARREL_TIP,  [4.05, 0, -0.35]);
    // Right barrel
    B(barrelGroup, [4.0, 0.22, 0.22], BARREL,     [2.0, 0, 0.35]);
    B(barrelGroup, [0.3, 0.28, 0.28], BARREL_TIP,  [4.05, 0, 0.35]);
    // Barrel housing
    B(barrelGroup, [1.5, 0.5, 0.9], HULL_DK,      [0.2, 0, 0]);

    // ── SAM missile pods (side-mounted on turret) ──
    for (const side of [-1, 1]) {
      const pod = new THREE.Group();
      pod.name = side < 0 ? 'missile-pod-left' : 'missile-pod-right';
      pod.position.set(-0.2, 0.6, side * 1.6);
      turret.add(pod);

      // Pod housing
      B(pod, [1.8, 0.6, 0.5], HULL_DK, [0, 0, 0]);
      // Missile tubes (2x2 grid)
      for (const row of [-0.15, 0.15]) {
        for (const col of [-0.12, 0.12]) {
          B(pod, [1.6, 0.15, 0.15], DARK, [0.15, row, col]);
          // Missile nose (red tip)
          B(pod, [0.15, 0.12, 0.12], ACCENT, [1.0, row, col]);
        }
      }
    }

    // ═══════════════════════════════════════════════
    //  RADAR DISH (on top of turret)
    // ═══════════════════════════════════════════════
    const radar = new THREE.Group();
    radar.name = 'radar';
    radar.position.set(-0.5, 1.65, 0);
    turret.add(radar);

    // Radar mast
    B(radar, [0.15, 0.5, 0.15], HULL_DK, [0, 0.25, 0]);
    // Radar dish (flat rectangle rotating)
    B(radar, [0.08, 0.35, 1.2], RADAR_COL, [0, 0.6, 0]);
    // Radar feed horn
    B(radar, [0.12, 0.12, 0.12], ACCENT2, [0.12, 0.6, 0]);

    // ═══════════════════════════════════════════════
    //  DETAILS & ACCENTS
    // ═══════════════════════════════════════════════

    // Headlights (front of hull)
    for (const side of [-1, 1]) {
      B(hull, [0.15, 0.15, 0.15], ACCENT2, [5.1, 1.2, side * 1.0]);
    }

    // Rear taillights
    for (const side of [-1, 1]) {
      B(hull, [0.12, 0.12, 0.12], ACCENT, [-4.5, 1.2, side * 1.0]);
    }

    // Antenna whip
    B(hull, [0.06, 1.5, 0.06], HULL_DK, [-3.0, 2.3, 1.2]);

    // Stowage boxes on hull sides
    for (const side of [-1, 1]) {
      B(hull, [1.2, 0.4, 0.3], HULL_LT, [-2.0, 1.8, side * 1.7]);
    }

    // Tow hooks (front/rear)
    B(hull, [0.3, 0.15, 0.5], DARK, [5.2, 0.4, 0]);
    B(hull, [0.3, 0.15, 0.5], DARK, [-4.5, 0.4, 0]);

    // Accent stripes on hull
    B(hull, [5.0, 0.08, 0.08], ACCENT2, [0, 1.68, -1.3]);
    B(hull, [5.0, 0.08, 0.08], ACCENT2, [0, 1.68, 1.3]);

    // Orient wrapper — model faces +X, wrapper rotates so -Z forward matches server
    const orientWrapper = new THREE.Group();
    orientWrapper.name = 'anti-air-orient-wrapper';
    orientWrapper.rotation.y = Math.PI / 2;
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
    isLocal: boolean,
    ctx: VehicleTypeFrameContext,
  ): void {
    const mesh = instance.mesh;
    const id = instance.entityId;

    // Find orient wrapper and turret
    const orientWrapper = mesh.getObjectByName('anti-air-orient-wrapper');
    const turret = orientWrapper?.getObjectByName('turret');
    const radar = turret?.getObjectByName('radar');

    // ── Track animation (from derived velocity) ──
    const prevPos = mesh.userData.prevFramePos as THREE.Vector3 | undefined;
    let hSpeed = 0;
    if (prevPos && delta > 0) {
      const rawVelX = (mesh.position.x - prevPos.x) / delta;
      const rawVelZ = (mesh.position.z - prevPos.z) / delta;

      const velSmooth = 1 - Math.pow(0.00001, delta);
      const prevDvx = (mesh.userData.smoothDerivedVelX as number) ?? rawVelX;
      const prevDvz = (mesh.userData.smoothDerivedVelZ as number) ?? rawVelZ;
      const smoothVelX = prevDvx + (rawVelX - prevDvx) * velSmooth;
      const smoothVelZ = prevDvz + (rawVelZ - prevDvz) * velSmooth;
      mesh.userData.smoothDerivedVelX = smoothVelX;
      mesh.userData.smoothDerivedVelZ = smoothVelZ;

      hSpeed = Math.sqrt(smoothVelX * smoothVelX + smoothVelZ * smoothVelZ);
      mesh.userData.derivedHSpeed = hSpeed;
    } else {
      hSpeed = (mesh.userData.derivedHSpeed as number) ?? 0;
    }
    if (!mesh.userData.prevFramePos) {
      mesh.userData.prevFramePos = mesh.position.clone();
    } else {
      (mesh.userData.prevFramePos as THREE.Vector3).copy(mesh.position);
    }

    // ── Radar dish rotation (constant spin) ──
    if (radar) {
      const radarSpin = ((mesh.userData.radarSpin as number) ?? 0) + delta * 3.0;
      mesh.userData.radarSpin = radarSpin % (Math.PI * 2);
      radar.rotation.y = radarSpin;
    }

    // ── Idle sway (very subtle for a heavy vehicle) ──
    if (orientWrapper) {
      const idleBlend = Math.max(0, 1 - hSpeed / 8);
      const phase = id * 2.3;
      const t = ctx.elapsedTime;

      const bobY = Math.sin(t * 0.6 + phase) * 0.015 * idleBlend;
      const swayRoll = Math.sin(t * 0.35 + phase + 2.0) * 0.006 * idleBlend;

      orientWrapper.position.set(0, bobY, 0);
      // Preserve base rotation + add subtle sway
      orientWrapper.rotation.set(0, Math.PI / 2, swayRoll);
    }

    // ── Audio: reuse jet engine sound (diesel engine feel) ──
    ctx.audio.updateJetEngineSound(id, mesh.position, hSpeed * 2, isLocal);
  }

  // ══════════════════════════════════════════════════════════════
  //  DESTRUCTION
  // ══════════════════════════════════════════════════════════════

  onDestroy(
    instance: VehicleInstance,
    ctx: VehicleTypeDestroyContext,
  ): BreakupPiece[] {
    return AntiAirType.spawnBreakup(
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
    const colorPool = [0x2a3022, 0x3a4032, 0x1e2218, 0x4a5240, 0x1a1c16];
    const pieceCount = Math.floor(25 + fxIntensity * 12);
    const origin = new THREE.Vector3(pos.x, pos.y + 1.5, pos.z);
    const radial = new THREE.Vector3();

    // Primary explosion light
    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 2.5, z: pos.z },
      color: 0xff7a32,
      intensity: 10 * fxIntensity,
      distance: 35 + 15 * fxIntensity,
      decay: 1.4,
      ttl: 0.3,
      kind: 'generic',
    });
    // Secondary fire light
    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 1.0, z: pos.z },
      color: 0xff3a12,
      intensity: 7 * fxIntensity,
      distance: 24 + 10 * fxIntensity,
      decay: 1.7,
      ttl: 0.5,
      kind: 'generic',
    });

    const pieces: BreakupPiece[] = [];
    for (let i = 0; i < pieceCount; i++) {
      const sx = 0.3 + Math.random() * 0.9;
      const sy = 0.15 + Math.random() * 0.5;
      const sz = 0.3 + Math.random() * 0.9;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshStandardMaterial({
          color: colorPool[(Math.random() * colorPool.length) | 0],
          roughness: 0.8,
          metalness: 0.25,
        }),
      );

      const local = new THREE.Vector3(
        (Math.random() - 0.5) * 8.0,
        (Math.random() - 0.5) * 3.0 + 1.2,
        (Math.random() - 0.5) * 6.0,
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
        .multiplyScalar((6 + Math.random() * 12) * (0.85 + fxIntensity * 0.45))
        .add(new THREE.Vector3(0, (8 + Math.random() * 10) * (0.8 + fxIntensity * 0.4), 0));
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
      );

      pieces.push({
        mesh,
        vel,
        angVel,
        ttl: 2.8 + Math.random() * 2.0 + fxIntensity * 0.5,
      });
    }

    // Explosion debris ring
    const ringBlocks: { x: number; y: number; z: number; blockType: number }[] = [];
    const baseY = Math.floor(pos.y + 1.0);
    const ringCount = Math.floor(28 + fxIntensity * 14);
    for (let i = 0; i < ringCount; i++) {
      const ang = (i / ringCount) * Math.PI * 2;
      const r = 2.8 + Math.random() * (2.5 + fxIntensity * 1.8);
      ringBlocks.push({
        x: Math.floor(pos.x + Math.cos(ang) * r),
        y: baseY + ((Math.random() * (2 + fxIntensity * 1.5)) | 0),
        z: Math.floor(pos.z + Math.sin(ang) * r),
        blockType: BlockType.Metal,
      });
    }
    const blastRadius = 6.0 + fxIntensity * 2.0;
    const blastPower = 28 + fxIntensity * 20;
    ctx.physics.spawnExplosionDebris(ringBlocks, pos.x, pos.y + 1.5, pos.z, blastRadius, blastPower);
    ctx.vfx.emitExplosion(pos.x, pos.y + 1.5, pos.z, blastRadius);
    ctx.vfx.emitExplosion(pos.x, pos.y + 2.5, pos.z, blastRadius * 0.6);
    ctx.vfx.emitImpact(pos.x, pos.y + 1.0, pos.z);
    ctx.vfx.emitImpact(pos.x + 1.2, pos.y + 1.5, pos.z - 0.6);
    ctx.audio.playExplosion({ position: { x: pos.x, y: pos.y + 1.5, z: pos.z } });
    ctx.applyExplosionCameraEffects(pos.x, pos.y + 1.5, pos.z, blastRadius, 110 + fxIntensity * 40);

    return pieces;
  }

  static readonly BREAKUP_GRAVITY = AA_BREAKUP_GRAVITY;
}
