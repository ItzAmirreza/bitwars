/**
 * AntiAirType.ts â€” VehicleType implementation for the CRAM anti-air emplacement.
 *
 * Stationary ground emplacement with a rotating turret and a 6-barrel Gatling
 * CRAM (Counter Rocket, Artillery, Mortar) cannon. Sits on a concrete platform
 * with sandbag fortification. Single weapon slot only.
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

// â”€â”€ Constants â”€â”€
const VEHICLE_TYPE_ANTI_AIR = VEHICLE_TYPES.AntiAir;
const AA_BREAKUP_GRAVITY = 20;
const AA_HIT_INDICATOR_DURATION = 0.28;

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

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  MODEL BUILDER
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  createModel(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'anti-air-root';

    // â”€â”€ Shared voxel-style material â”€â”€
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
      parent.add(mesh);
      return mesh;
    };

    const B = (
      parent: THREE.Object3D, size: [number, number, number],
      hex: number, pos: [number, number, number], rot?: [number, number, number],
    ) => shadedBox(parent, size, hex, pos, rot);

    // â”€â”€ Color palette (military emplacement) â”€â”€
    const CONCRETE  = 0x6a6a62;
    const CONC_DK   = 0x505048;
    const CONC_LT   = 0x7a7a72;
    const SANDBAG   = 0x8a7a5a;
    const SAND_DK   = 0x6a5a3a;
    const HULL      = 0x3a4032;
    const HULL_LT   = 0x4a5240;
    const HULL_DK   = 0x2a3022;
    const DARK      = 0x151810;
    const ACCENT    = 0xff4433;
    const ACCENT2   = 0xffdd33;
    const RADAR_COL = 0x556655;
    const BARREL    = 0x3a3e42;
    const BARREL_TIP = 0xff8833;
    const METAL_DK  = 0x2a2e30;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  CONCRETE BASE PLATFORM
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const base = new THREE.Group();
    base.name = 'base';
    root.add(base);

    // Main concrete slab
    B(base, [6.0, 0.6, 6.0], CONCRETE, [0, 0.3, 0]);
    // Raised center platform
    B(base, [3.5, 0.4, 3.5], CONC_DK, [0, 0.8, 0]);
    // Platform edge trim
    B(base, [4.0, 0.15, 0.15], CONC_LT, [0, 0.62, 2.9]);
    B(base, [4.0, 0.15, 0.15], CONC_LT, [0, 0.62, -2.9]);
    B(base, [0.15, 0.15, 6.0], CONC_LT, [2.9, 0.62, 0]);
    B(base, [0.15, 0.15, 6.0], CONC_LT, [-2.9, 0.62, 0]);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  SANDBAG WALLS (fortification around base)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Front and back sandbag walls
    for (const fwd of [-1, 1]) {
      // Bottom row
      for (let i = -2; i <= 2; i++) {
        B(base, [1.0, 0.45, 0.6], SANDBAG, [i * 1.1, 0.85, fwd * 3.3]);
      }
      // Top row (staggered)
      for (let i = -1; i <= 1; i++) {
        B(base, [1.0, 0.45, 0.6], SAND_DK, [i * 1.1 + 0.55, 1.28, fwd * 3.3]);
      }
    }
    // Side sandbag walls
    for (const side of [-1, 1]) {
      for (let i = -2; i <= 2; i++) {
        B(base, [0.6, 0.45, 1.0], SANDBAG, [side * 3.3, 0.85, i * 1.1]);
      }
      for (let i = -1; i <= 1; i++) {
        B(base, [0.6, 0.45, 1.0], SAND_DK, [side * 3.3, 1.28, i * 1.1 + 0.55]);
      }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  PEDESTAL (turret mount)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // Cylindrical pedestal approximation
    B(base, [1.2, 1.0, 1.2], METAL_DK, [0, 1.5, 0]);
    B(base, [1.6, 0.2, 1.6], HULL_DK, [0, 2.05, 0]);
    // Mounting bolts
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        B(base, [0.12, 0.15, 0.12], DARK, [sx * 0.5, 1.0, sz * 0.5]);
      }
    }

    // â”€â”€ Ammo crates near base â”€â”€
    B(base, [0.8, 0.5, 0.5], HULL_DK, [2.2, 0.85, -1.5]);
    B(base, [0.8, 0.5, 0.5], HULL_DK, [2.2, 0.85, -0.8]);
    B(base, [0.5, 0.5, 0.8], HULL, [-2.0, 0.85, 1.2]);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  TURRET (rotates on yaw, sits on pedestal)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const turret = new THREE.Group();
    turret.name = 'turret';
    turret.position.set(0, 2.15, 0);
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

    // â”€â”€ CRAM Gatling barrel cluster (6-barrel rotary cannon) â”€â”€
    const barrelGroup = new THREE.Group();
    barrelGroup.name = 'barrel-group';
    barrelGroup.position.set(1.4, 0.8, 0);
    turret.add(barrelGroup);

    // Barrel housing / shroud (chunky rectangular housing)
    B(barrelGroup, [2.0, 0.8, 0.8], HULL_DK, [0, 0, 0]);
    B(barrelGroup, [0.3, 0.9, 0.9], METAL_DK, [-0.9, 0, 0]);

    // 6 barrels in circular arrangement
    const BARREL_R = 0.28; // radius of barrel ring
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const bz = Math.cos(angle) * BARREL_R;
      const by = Math.sin(angle) * BARREL_R;
      B(barrelGroup, [4.5, 0.14, 0.14], BARREL, [2.8, by, bz]);
      B(barrelGroup, [0.25, 0.18, 0.18], BARREL_TIP, [5.1, by, bz]);
    }

    // Front barrel clamp rings
    B(barrelGroup, [0.12, 0.7, 0.7], HULL, [1.5, 0, 0]);
    B(barrelGroup, [0.12, 0.7, 0.7], HULL, [3.5, 0, 0]);

    // Ammo feed chute (side of turret)
    B(turret, [1.2, 0.35, 0.35], HULL_DK, [0.5, 0.2, -1.35]);
    B(turret, [0.5, 0.7, 0.35], HULL_DK, [-0.1, -0.05, -1.35]);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  RADAR DISH (on top of turret)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  DETAILS & ACCENTS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Warning light on base
    B(base, [0.15, 0.15, 0.15], ACCENT, [2.8, 1.5, 2.8]);
    // Antenna whip near base edge
    B(base, [0.06, 2.0, 0.06], HULL_DK, [-2.5, 1.6, 2.0]);
    // Warning stripe on concrete edge
    B(base, [5.0, 0.08, 0.08], ACCENT2, [0, 0.62, 2.7]);
    B(base, [5.0, 0.08, 0.08], ACCENT2, [0, 0.62, -2.7]);

    // Orient wrapper â€” model faces +X, wrapper rotates so -Z forward matches server
    const orientWrapper = new THREE.Group();
    orientWrapper.name = 'anti-air-orient-wrapper';
    orientWrapper.rotation.y = Math.PI / 2;
    while (root.children.length > 0) {
      orientWrapper.add(root.children[0]);
    }
    root.add(orientWrapper);

    const hitIndicator = new THREE.Group();
    hitIndicator.name = 'aa-hit-indicator';
    hitIndicator.position.set(0, 4.35, 0);
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
      rot: [number, number, number] = [0, 0, 0],
    ): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), hitIndicatorMat);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      mesh.renderOrder = 20;
      hitIndicator.add(mesh);
    };

    addIndicatorBar([1.8, 0.14, 0.18], [0, 0, 0]);
    addIndicatorBar([0.18, 0.14, 1.8], [0, 0, 0]);
    addIndicatorBar([0.24, 0.9, 0.24], [0, -0.35, 0]);

    return root;
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PER-FRAME ANIMATION
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  updatePerFrame(
    instance: VehicleInstance,
    delta: number,
    _isLocal: boolean,
    ctx: VehicleTypeFrameContext,
  ): void {
    const mesh = instance.mesh;

    // Find orient wrapper and turret
    const orientWrapper = mesh.getObjectByName('anti-air-orient-wrapper');
    const turret = orientWrapper?.getObjectByName('turret');
    const radar = turret?.getObjectByName('radar');
    const barrelGroup = turret?.getObjectByName('barrel-group');
    const hitIndicator = mesh.getObjectByName('aa-hit-indicator');

    const vehicleRow = ctx.getVehicleRow(instance.entityId);
    if (vehicleRow) {
      const health = Number(vehicleRow.health ?? this.getHealthMax());
      const prevHealth = Number(mesh.userData.lastVehicleHealth ?? health);
      if (health < prevHealth) {
        const damageTaken = prevHealth - health;
        mesh.userData.hitIndicatorTimer = AA_HIT_INDICATOR_DURATION;
        mesh.userData.hitIndicatorStrength = THREE.MathUtils.clamp(
          0.6 + damageTaken / 30,
          0.7,
          1.45,
        );
      }
      mesh.userData.lastVehicleHealth = health;
    }

    const hitIndicatorTimer = Math.max(
      0,
      Number(mesh.userData.hitIndicatorTimer ?? 0) - delta,
    );
    mesh.userData.hitIndicatorTimer = hitIndicatorTimer;
    if (hitIndicator) {
      const strength = Number(mesh.userData.hitIndicatorStrength ?? 1);
      const t = hitIndicatorTimer / AA_HIT_INDICATOR_DURATION;
      const alpha = Math.max(0, t * (0.55 + strength * 0.22));
      hitIndicator.visible = alpha > 0.02;
      hitIndicator.position.y = 4.35 + (1 - t) * 0.25;
      const scale = 0.9 + (1 - t) * 0.45 * strength;
      hitIndicator.scale.setScalar(scale);
      hitIndicator.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.opacity = alpha;
          child.material.color.setHex(t > 0.55 ? 0xfff2a6 : 0xff6a4a);
        }
      });
    }

    // â”€â”€ Radar dish rotation (constant spin) â”€â”€
    if (radar) {
      const radarSpin = ((mesh.userData.radarSpin as number) ?? 0) + delta * 3.0;
      mesh.userData.radarSpin = radarSpin % (Math.PI * 2);
      radar.rotation.y = radarSpin;
    }

    // â”€â”€ Static base â€” no sway or movement animation â”€â”€
    if (orientWrapper) {
      orientWrapper.position.set(0, 0, 0);
      orientWrapper.rotation.set(0, Math.PI / 2, 0);
    }

    // â”€â”€ Turret rotation â€” follow pilot's aim direction â”€â”€
    const pilotAim = ctx.getPilotAim(instance.entityId);
    if (turret && pilotAim) {
      // The orient wrapper rotates the model by PI/2 so +X model forward maps
      // to -Z world forward. The turret yaw needs to be relative to the base
      // orientation. Since the base entity yaw = mesh.rotation.y (set by
      // VehicleManager), subtract it to get turret-local yaw.
      const baseYaw = mesh.rotation.y;
      const turretYaw = pilotAim.yaw - baseYaw;

      // Smooth turret rotation for remote vehicles
      const prevYaw = (mesh.userData.turretYaw as number) ?? turretYaw;
      const prevPitch = (mesh.userData.turretPitch as number) ?? pilotAim.pitch;
      const smoothRate = 12; // radians/sec convergence rate
      const t = Math.min(1, smoothRate * delta);

      // Handle yaw wrapping for shortest-path interpolation
      let dyaw = turretYaw - prevYaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const smoothYaw = prevYaw + dyaw * t;
      const smoothPitch = prevPitch + (pilotAim.pitch - prevPitch) * t;

      mesh.userData.turretYaw = smoothYaw;
      mesh.userData.turretPitch = smoothPitch;

      // Apply yaw to turret group (rotates on pedestal)
      turret.rotation.y = smoothYaw;

      // Apply pitch to barrel group (elevates/depresses the guns)
      if (barrelGroup) {
        // Clamp pitch to reasonable range for an AA gun
        const clampedPitch = Math.max(-0.8, Math.min(1.2, smoothPitch));
        barrelGroup.rotation.z = clampedPitch;
      }
    }
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  DESTRUCTION
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
