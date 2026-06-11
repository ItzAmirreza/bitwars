/**
 * FighterJetType.ts â€” VehicleType implementation for the fighter jet.
 *
 * Contains:
 *  â€¢ Procedural voxel-style model builder (fuselage, delta wings, tail, cockpit, exhaust)
 *  â€¢ Per-frame animation (banking, pitch, afterburner glow)
 *  â€¢ Breakup piece spawning on destruction
 *  â€¢ All fighter jet constants from shared-config
 */

import * as THREE from 'three';
import { BlockType } from '../VoxelWorld';
import { VEHICLE_TYPES, FIGHTER_JET } from '../../shared-config';
import type {
  VehicleType,
  VehicleInstance,
  VehicleCameraConfig,
  BreakupPiece,
  VehicleTypeFrameContext,
  VehicleTypeDestroyContext,
} from './VehicleBase';

// â”€â”€ Constants â”€â”€
const VEHICLE_TYPE_FIGHTER_JET = VEHICLE_TYPES.FighterJet;
const JET_BREAKUP_GRAVITY = 24;

export class FighterJetType implements VehicleType {
  readonly typeId = VEHICLE_TYPE_FIGHTER_JET;
  readonly name = 'Fighter Jet';

  getHealthMax(): number {
    return FIGHTER_JET.healthMax;
  }

  getMountRange(): number {
    return FIGHTER_JET.mountRange;
  }

  getCameraConfig(): VehicleCameraConfig {
    return {
      distance: FIGHTER_JET.camera.distance,
      height: FIGHTER_JET.camera.height,
      pitchMin: FIGHTER_JET.camera.pitchMin,
      pitchMax: FIGHTER_JET.camera.pitchMax,
    };
  }

  getPilotSeatHeight(): number {
    return FIGHTER_JET.pilotSeatHeight;
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  MODEL BUILDER
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  createModel(): THREE.Group {
    const jet = new THREE.Group();
    jet.name = 'fighter-jet-root';

    // â”€â”€ Shared voxel-style material â”€â”€
    const voxMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0x0a0f1a),
      emissiveIntensity: 0.38,
      shininess: 8,
      specular: new THREE.Color(0x111418),
    });
    const glassMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0x0a2f3d),
      emissiveIntensity: 0.45,
      shininess: 30,
      specular: new THREE.Color(0x334455),
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
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
      mat: THREE.Material = voxMat,
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
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      parent.add(mesh);
      return mesh;
    };

    const B = (
      parent: THREE.Object3D, size: [number, number, number],
      hex: number, pos: [number, number, number], rot?: [number, number, number],
    ) => shadedBox(parent, size, hex, pos, rot);

    const G = (
      parent: THREE.Object3D, size: [number, number, number],
      hex: number, pos: [number, number, number], rot?: [number, number, number],
    ) => shadedBox(parent, size, hex, pos, rot, glassMat);

    // â”€â”€ Color palette (dark military grey) â”€â”€
    const SHELL     = 0x3a3e42;
    const SHELL_LT  = 0x484e54;
    const SHELL_DK  = 0x2a2e32;
    const UNDER     = 0x222428;
    const DARK      = 0x151820;
    const ACCENT    = 0x4ad2ff;
    const GLASS     = 0x83d8ff;
    const EXHAUST   = 0x151820;
    const EXHAUST_GLOW = 0xff6622;

    // â”€â”€ FUSELAGE (nose â†’ tail along +X) â”€â”€
    const fuselage = new THREE.Group();
    fuselage.name = 'fuselage';
    jet.add(fuselage);
    B(fuselage, [1.2, 0.8, 0.8],  SHELL_LT, [5.0, 1.8, 0], [0, 0, 0.06]);
    B(fuselage, [2.0, 1.2, 1.2],  SHELL,    [3.6, 1.8, 0]);
    B(fuselage, [3.0, 1.5, 1.6],  SHELL,    [1.6, 1.8, 0]);
    B(fuselage, [4.0, 1.8, 2.0],  SHELL,    [-1.2, 1.8, 0]);
    B(fuselage, [3.0, 1.6, 1.8],  SHELL_DK, [-4.0, 1.8, 0]);
    B(fuselage, [1.8, 1.4, 1.4],  SHELL_DK, [-6.0, 1.9, 0]);
    B(fuselage, [8.0, 0.25, 1.8], UNDER,    [0.0, 0.95, 0]);
    B(fuselage, [3.0, 0.2, 1.4],  UNDER,    [-4.0, 1.0, 0]);
    B(fuselage, [5.0, 0.3, 1.0],  SHELL_LT, [0.0, 2.7, 0]);
    B(fuselage, [2.0, 0.25, 0.8], SHELL_LT, [-3.5, 2.65, 0]);

    // Cockpit canopy
    G(fuselage, [2.2, 1.0, 1.3],  GLASS,    [3.2, 2.5, 0], [0.12, 0, 0]);
    G(fuselage, [1.0, 0.6, 0.08], GLASS,    [3.0, 2.5, -0.68]);
    G(fuselage, [1.0, 0.6, 0.08], GLASS,    [3.0, 2.5, 0.68]);
    B(fuselage, [2.2, 0.1, 1.3],  DARK,     [3.2, 2.0, 0]);

    // Intake ramps
    B(fuselage, [2.2, 1.0, 0.3],  SHELL_DK, [-0.4, 1.8, -1.15]);
    B(fuselage, [2.2, 1.0, 0.3],  SHELL_DK, [-0.4, 1.8, 1.15]);
    B(fuselage, [1.0, 0.6, 0.15], DARK,     [-0.4, 1.8, -1.38]);
    B(fuselage, [1.0, 0.6, 0.15], DARK,     [-0.4, 1.8, 1.38]);

    // â”€â”€ DELTA WINGS â”€â”€
    const wingGroup = new THREE.Group();
    wingGroup.name = 'wings';
    jet.add(wingGroup);
    for (const side of [-1, 1]) {
      const z = side;
      B(wingGroup, [4.0, 0.2, 2.0],  SHELL,   [-1.5, 1.6, z * 2.0]);
      B(wingGroup, [3.0, 0.18, 1.8], SHELL_DK, [-2.2, 1.6, z * 3.5]);
      B(wingGroup, [1.8, 0.15, 1.2], SHELL_DK, [-3.0, 1.6, z * 5.0]);
      B(wingGroup, [0.15, 0.22, 4.5], ACCENT,  [0.4, 1.6, z * 3.2]);
      B(wingGroup, [0.8, 0.1, 1.4],  DARK,     [-3.8, 1.6, z * 4.2]);
      B(wingGroup, [0.6, 0.3, 0.25], UNDER,    [-1.5, 1.3, z * 2.8]);
      B(wingGroup, [0.15, 0.15, 0.15], side < 0 ? 0xff3d3d : 0x4cff83,
        [-3.5, 1.65, z * 5.5]);
    }

    // â”€â”€ TAIL â”€â”€
    const tailSection = new THREE.Group();
    tailSection.name = 'tail-section';
    tailSection.position.set(-5.8, 1.9, 0);
    jet.add(tailSection);
    B(tailSection, [1.8, 2.8, 0.2], SHELL_DK, [0, 1.6, 0]);
    B(tailSection, [1.0, 0.3, 0.22], ACCENT,  [0.2, 3.05, 0]);
    B(tailSection, [0.5, 2.0, 0.15], DARK,    [-0.6, 1.5, 0]);
    for (const side of [-1, 1]) {
      B(tailSection, [1.6, 0.12, 1.5],  SHELL_DK, [0, 0.1, side * 1.2]);
      B(tailSection, [0.8, 0.1, 1.0],   DARK,     [-0.6, 0.1, side * 1.8]);
      B(tailSection, [0.12, 0.14, 0.12], ACCENT,   [0.5, 0.15, side * 1.9]);
    }

    // â”€â”€ ENGINE EXHAUST â”€â”€
    const exhaustGroup = new THREE.Group();
    exhaustGroup.name = 'jet-exhaust';
    exhaustGroup.position.set(-6.8, 1.9, 0);
    jet.add(exhaustGroup);
    B(exhaustGroup, [0.6, 1.2, 1.2], EXHAUST, [0, 0, 0]);
    B(exhaustGroup, [0.3, 0.9, 0.9], DARK,    [-0.4, 0, 0]);

    // Afterburner glow cones
    const glowMat = new THREE.MeshBasicMaterial({
      color: EXHAUST_GLOW, transparent: true, opacity: 0.0,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const innerGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.15, 1.8, 8), glowMat.clone(),
    );
    innerGlow.name = 'afterburner-inner';
    innerGlow.rotation.z = Math.PI / 2;
    innerGlow.position.set(-1.2, 0, 0);
    exhaustGroup.add(innerGlow);
    const outerGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.08, 2.8, 8), glowMat.clone() as THREE.MeshBasicMaterial,
    );
    (outerGlow.material as THREE.MeshBasicMaterial).color.set(0xff4400);
    outerGlow.name = 'afterburner-outer';
    outerGlow.rotation.z = Math.PI / 2;
    outerGlow.position.set(-1.8, 0, 0);
    exhaustGroup.add(outerGlow);

    // Accent stripes & details
    B(fuselage, [10.0, 0.12, 0.1], ACCENT, [0.0, 1.05, -1.0]);
    B(fuselage, [10.0, 0.12, 0.1], ACCENT, [0.0, 1.05, 1.0]);
    B(fuselage, [0.1, 0.8, 1.4],   ACCENT, [5.6, 1.8, 0]);
    B(fuselage, [0.1, 0.1, 0.1],   ACCENT, [5.62, 1.75, 0]);
    B(fuselage, [0.06, 0.06, 0.06], ACCENT, [3.2, 3.05, 0]);

    // â”€â”€ LANDING GEAR â”€â”€
    const GEAR_COL   = 0x2a2e32;
    const WHEEL_COL  = 0x1a1c1e;
    const STRUT_COL  = 0x555a60;

    // Nose gear (single wheel at the front)
    const noseGear = new THREE.Group();
    noseGear.name = 'gear-nose';
    B(noseGear, [0.12, 0.7, 0.12], STRUT_COL, [3.8, -0.3, 0]);    // strut
    B(noseGear, [0.35, 0.35, 0.2], WHEEL_COL, [3.8, -0.7, 0]);    // wheel
    B(noseGear, [0.08, 0.3, 0.08], GEAR_COL,  [3.8, 0.1, 0]);     // upper strut
    jet.add(noseGear);

    // Left main gear
    const leftGear = new THREE.Group();
    leftGear.name = 'gear-left';
    B(leftGear, [0.12, 0.65, 0.12], STRUT_COL, [-0.8, -0.35, -1.6]); // strut
    B(leftGear, [0.45, 0.4, 0.22],  WHEEL_COL, [-0.8, -0.75, -1.6]); // wheel
    B(leftGear, [0.08, 0.25, 0.08], GEAR_COL,  [-0.8, 0.05, -1.6]);  // upper
    jet.add(leftGear);

    // Right main gear
    const rightGear = new THREE.Group();
    rightGear.name = 'gear-right';
    B(rightGear, [0.12, 0.65, 0.12], STRUT_COL, [-0.8, -0.35, 1.6]);
    B(rightGear, [0.45, 0.4, 0.22],  WHEEL_COL, [-0.8, -0.75, 1.6]);
    B(rightGear, [0.08, 0.25, 0.08], GEAR_COL,  [-0.8, 0.05, 1.6]);
    jet.add(rightGear);

    // Orient wrapper â€” model faces +X, wrapper rotates so +Z forward matches server
    const orientWrapper = new THREE.Group();
    orientWrapper.name = 'fighter-jet-orient-wrapper';
    orientWrapper.rotation.y = Math.PI / 2;
    while (jet.children.length > 0) {
      orientWrapper.add(jet.children[0]);
    }
    jet.add(orientWrapper);

    return jet;
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PER-FRAME ANIMATION
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  updatePerFrame(
    instance: VehicleInstance,
    delta: number,
    isLocal: boolean,
    ctx: VehicleTypeFrameContext,
  ): void {
    const mesh = instance.mesh;
    const id = instance.entityId;

    // Banking/roll animation (stronger than helicopter) â€” uses smoothed
    // derived velocity to avoid fixed-timestep quantization jitter.
    const prevPos = mesh.userData.prevFramePos as THREE.Vector3 | undefined;
    let hSpeed = 0;
    if (prevPos && delta > 0) {
      const rawVelX = (mesh.position.x - prevPos.x) / delta;
      const rawVelZ = (mesh.position.z - prevPos.z) / delta;

      // Exponential moving average of derived velocity (smooth over ~100ms)
      const velSmooth = 1 - Math.pow(0.00001, delta);
      const prevDvx = (mesh.userData.smoothDerivedVelX as number) ?? rawVelX;
      const prevDvz = (mesh.userData.smoothDerivedVelZ as number) ?? rawVelZ;
      const smoothVelX = prevDvx + (rawVelX - prevDvx) * velSmooth;
      const smoothVelZ = prevDvz + (rawVelZ - prevDvz) * velSmooth;
      mesh.userData.smoothDerivedVelX = smoothVelX;
      mesh.userData.smoothDerivedVelZ = smoothVelZ;

      hSpeed = Math.sqrt(smoothVelX * smoothVelX + smoothVelZ * smoothVelZ);
      mesh.userData.derivedHSpeed = hSpeed;

      const yaw = mesh.rotation.y;
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const lateralSpeed = smoothVelX * rightX + smoothVelZ * rightZ;
      const targetRoll = -lateralSpeed * 0.06;
      const maxRoll = 0.55;
      const clampedRoll = Math.max(-maxRoll, Math.min(maxRoll, targetRoll));
      const prevRoll = mesh.userData.smoothRoll ?? 0;
      const rollLerp = 1 - Math.pow(0.001, delta);
      const smoothRoll = prevRoll + (clampedRoll - prevRoll) * rollLerp;
      mesh.userData.smoothRoll = smoothRoll;
      mesh.rotation.z = smoothRoll;
    } else {
      hSpeed = (mesh.userData.derivedHSpeed as number) ?? 0;
    }
    if (!mesh.userData.prevFramePos) {
      mesh.userData.prevFramePos = mesh.position.clone();
    } else {
      (mesh.userData.prevFramePos as THREE.Vector3).copy(mesh.position);
    }

    // â”€â”€ Landing gear retraction â”€â”€
    // Gear extends when slow + low altitude, retracts when fast or high
    const altitude = mesh.position.y;
    const gearShouldBeDown = hSpeed < 15 && altitude < 20;
    const prevGearDeploy = (mesh.userData.gearDeploy as number) ?? 1.0;
    const gearRate = gearShouldBeDown ? 2.0 : -1.5; // deploy faster than retract
    const gearDeploy = Math.max(0, Math.min(1, prevGearDeploy + gearRate * delta));
    mesh.userData.gearDeploy = gearDeploy;

    const orientWrapper = mesh.getObjectByName('fighter-jet-orient-wrapper');
    if (orientWrapper) {
      for (const gearName of ['gear-nose', 'gear-left', 'gear-right']) {
        const gear = orientWrapper.getObjectByName(gearName);
        if (gear) {
          // When deployed (1.0): visible, normal position
          // When retracted (0.0): rotated up into the body and hidden
          gear.visible = gearDeploy > 0.01;
          if (gearName === 'gear-nose') {
            // Nose gear folds backward (rotate around Z)
            gear.rotation.z = (1 - gearDeploy) * -Math.PI / 2;
            gear.position.y = (1 - gearDeploy) * 0.5;
          } else {
            // Main gear folds inward (rotate around X)
            const inward = gearName === 'gear-left' ? 1 : -1;
            gear.rotation.x = (1 - gearDeploy) * inward * Math.PI / 2;
            gear.position.y = (1 - gearDeploy) * 0.5;
          }
        }
      }
    }

    // â”€â”€ Compute throttle intensity (0â€“1) â”€â”€
    let throttle = 0;
    if (isLocal) {
      if (ctx.controls.moveForward) throttle = 1.0;
      else if (ctx.controls.moveBackward) throttle = 0.2;
      else throttle = 0.5;
    } else {
      const vRow = ctx.getVehicleRow(id);
      if (vRow && vRow.pilotIdentity) {
        const fwd = Number(vRow.inputForward ?? 0);
        throttle = fwd > 0 ? 1.0 : fwd < 0 ? 0.2 : 0.5;
      } else {
        throttle = 0.3;
      }
    }

    // â”€â”€ Orient wrapper subtle idle sway (much less than heli) â”€â”€
    if (orientWrapper) {
      const idleBlend = Math.max(0, 1 - hSpeed / 25);
      const phase = id * 1.7;
      const t = ctx.elapsedTime;

      const bobY = Math.sin(t * 0.8 + phase) * 0.04 * idleBlend;
      const swayRoll = Math.sin(t * 0.5 + phase + 3.0) * 0.012 * idleBlend;
      const swayYaw = Math.sin(t * 0.4 + phase + 4.0) * 0.008 * idleBlend;

      orientWrapper.position.set(0, bobY, 0);
      orientWrapper.rotation.set(0, Math.PI / 2 + swayYaw, swayRoll);
    }

    // â”€â”€ Afterburner glow â”€â”€
    const exhaustGroup = mesh.getObjectByName('jet-exhaust');
    if (exhaustGroup) {
      const innerGlow = exhaustGroup.getObjectByName('afterburner-inner') as THREE.Mesh | null;
      const outerGlow = exhaustGroup.getObjectByName('afterburner-outer') as THREE.Mesh | null;

      // Smooth the throttle for glow transitions
      const prevGlow = (mesh.userData.smoothGlow as number) ?? 0;
      const glowTarget = throttle;
      const glowLerp = 1 - Math.pow(0.05, delta);
      const smoothGlow = prevGlow + (glowTarget - prevGlow) * glowLerp;
      mesh.userData.smoothGlow = smoothGlow;

      // Flicker effect
      const flicker = 0.92 + 0.08 * Math.sin(ctx.elapsedTime * 37 + id * 5.3);

      if (innerGlow) {
        const mat = innerGlow.material as THREE.MeshBasicMaterial;
        mat.opacity = smoothGlow * 0.65 * flicker;
        innerGlow.visible = smoothGlow > 0.05;
        innerGlow.scale.x = 0.8 + smoothGlow * 0.5;
      }
      if (outerGlow) {
        const mat = outerGlow.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, smoothGlow - 0.3) * 0.45 * flicker;
        outerGlow.visible = smoothGlow > 0.35;
        outerGlow.scale.x = 0.7 + smoothGlow * 0.6;
      }
    }

    // â”€â”€ Jet engine audio â”€â”€
    ctx.audio.updateJetEngineSound(id, mesh.position, hSpeed, isLocal);
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  DESTRUCTION
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  onDestroy(
    instance: VehicleInstance,
    ctx: VehicleTypeDestroyContext,
  ): BreakupPiece[] {
    return FighterJetType.spawnBreakup(
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

  /** Static so VehicleManager can call it from triggerDestroyFx with explicit pos/yaw/intensity. */
  static spawnBreakup(
    pos: { x: number; y: number; z: number },
    yaw: number,
    intensity: number,
    ctx: VehicleTypeDestroyContext,
  ): BreakupPiece[] {
    const fxIntensity = THREE.MathUtils.clamp(intensity, 0.55, 1.8);
    const colorPool = [0x222628, 0x2e3438, 0x3a4044, 0x141818, 0x505a4e];
    const pieceCount = Math.floor(22 + fxIntensity * 10);
    const origin = new THREE.Vector3(pos.x, pos.y + 1.8, pos.z);
    const radial = new THREE.Vector3();

    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 2.5, z: pos.z },
      color: 0xff7a32,
      intensity: 9.5 * fxIntensity,
      distance: 32 + 14 * fxIntensity,
      decay: 1.4,
      ttl: 0.25,
      kind: 'generic',
    });
    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 1.2, z: pos.z },
      color: 0xff3a12,
      intensity: 6.5 * fxIntensity,
      distance: 22 + 10 * fxIntensity,
      decay: 1.7,
      ttl: 0.45,
      kind: 'generic',
    });

    const pieces: BreakupPiece[] = [];
    for (let i = 0; i < pieceCount; i++) {
      const sx = 0.3 + Math.random() * 0.8;
      const sy = 0.15 + Math.random() * 0.45;
      const sz = 0.3 + Math.random() * 0.9;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshStandardMaterial({
          color: colorPool[(Math.random() * colorPool.length) | 0],
          roughness: 0.75,
          metalness: 0.32,
        }),
      );

      const local = new THREE.Vector3(
        (Math.random() - 0.5) * 12.0,
        (Math.random() - 0.5) * 2.8 + 1.5,
        (Math.random() - 0.5) * 10.0,
      );
      local.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      mesh.position.copy(origin).add(local);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      ctx.scene.add(mesh);

      radial.copy(local).normalize();
      if (!Number.isFinite(radial.x)) radial.set(0, 1, 0);
      const vel = radial
        .multiplyScalar((8 + Math.random() * 15) * (0.85 + fxIntensity * 0.45))
        .add(new THREE.Vector3(0, (9 + Math.random() * 12) * (0.82 + fxIntensity * 0.38), 0));
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9,
        (Math.random() - 0.5) * 9,
      );

      pieces.push({
        mesh,
        vel,
        angVel,
        ttl: 2.6 + Math.random() * 1.8 + fxIntensity * 0.5,
      });
    }

    const ringBlocks: { x: number; y: number; z: number; blockType: number }[] = [];
    const baseY = Math.floor(pos.y + 1.5);
    const ringCount = Math.floor(32 + fxIntensity * 16);
    for (let i = 0; i < ringCount; i++) {
      const ang = (i / ringCount) * Math.PI * 2;
      const r = 3.2 + Math.random() * (2.8 + fxIntensity * 2.0);
      ringBlocks.push({
        x: Math.floor(pos.x + Math.cos(ang) * r),
        y: baseY + ((Math.random() * (2 + fxIntensity * 2)) | 0),
        z: Math.floor(pos.z + Math.sin(ang) * r),
        blockType: BlockType.Metal,
      });
    }
    const blastRadius = 6.5 + fxIntensity * 2.2;
    const blastPower = 30 + fxIntensity * 22;
    ctx.physics.spawnExplosionDebris(ringBlocks, pos.x, pos.y + 1.8, pos.z, blastRadius, blastPower);
    ctx.vfx.emitExplosion(pos.x, pos.y + 1.8, pos.z, blastRadius);
    ctx.vfx.emitExplosion(pos.x, pos.y + 2.6, pos.z, blastRadius * 0.7);
    ctx.vfx.emitImpact(pos.x, pos.y + 1.2, pos.z);
    ctx.vfx.emitImpact(pos.x + 1.5, pos.y + 2.0, pos.z - 0.8);
    ctx.vfx.emitImpact(pos.x - 1.3, pos.y + 1.8, pos.z + 1.0);
    ctx.audio.playExplosion({ position: { x: pos.x, y: pos.y + 1.8, z: pos.z } });
    ctx.applyExplosionCameraEffects(pos.x, pos.y + 1.8, pos.z, blastRadius, 100 + fxIntensity * 45);

    return pieces;
  }

  // â”€â”€ Breakup piece gravity constant â”€â”€
  static readonly BREAKUP_GRAVITY = JET_BREAKUP_GRAVITY;
}
