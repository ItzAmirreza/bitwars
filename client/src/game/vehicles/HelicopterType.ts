/**
 * HelicopterType.ts — VehicleType implementation for the helicopter.
 *
 * Contains:
 *  • The ~370-line model builder (createHelicopterModel)
 *  • Per-frame animation (banking, rotor spin, blur disc, hover bob)
 *  • Breakup piece spawning on destruction
 *  • All helicopter constants from shared-config
 */

import * as THREE from 'three';
import { BlockType } from '../VoxelWorld';
import { VEHICLE_TYPES, HELICOPTER } from '../../shared-config';
import type {
  VehicleType,
  VehicleInstance,
  VehicleCameraConfig,
  BreakupPiece,
  VehicleTypeFrameContext,
  VehicleTypeDestroyContext,
} from './VehicleBase';

// ── Constants ──
const VEHICLE_TYPE_HELICOPTER = VEHICLE_TYPES.Helicopter;
const HELI_BREAKUP_GRAVITY = 22;

export class HelicopterType implements VehicleType {
  readonly typeId = VEHICLE_TYPE_HELICOPTER;
  readonly name = 'Helicopter';

  getHealthMax(): number {
    return HELICOPTER.healthMax;
  }

  getMountRange(): number {
    return HELICOPTER.mountRange;
  }

  getCameraConfig(): VehicleCameraConfig {
    return {
      distance: HELICOPTER.camera.distance,
      height: HELICOPTER.camera.height,
      pitchMin: HELICOPTER.camera.pitchMin,
      pitchMax: HELICOPTER.camera.pitchMax,
    };
  }

  getPilotSeatHeight(): number {
    return HELICOPTER.pilotSeatHeight;
  }

  // ══════════════════════════════════════════════════════════════
  //  MODEL BUILDER
  // ══════════════════════════════════════════════════════════════

  createModel(): THREE.Group {
    const heli = new THREE.Group();
    heli.name = 'helicopter-root';

    // ── Shared voxel-style material ──
    const voxMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0x10182a),
      emissiveIntensity: 0.34,
      shininess: 6,
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
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0x8ff4ff, emissive: 0x12303a, emissiveIntensity: 0.3 });
    const tailBladeMat = new THREE.MeshLambertMaterial({ color: 0x93f2ff, emissive: 0x14323d, emissiveIntensity: 0.2 });

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
      mesh.castShadow = true;
      mesh.receiveShadow = true;
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

    const mkCyl = (
      parent: THREE.Object3D, rTop: number, rBot: number, h: number, hex: number,
      pos: [number, number, number], rot: [number, number, number] = [0, 0, 0],
    ): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(rTop, rBot, h, 8),
        new THREE.MeshPhongMaterial({
          color: hex, emissive: 0x10182a, emissiveIntensity: 0.34,
          shininess: 6, specular: new THREE.Color(0x111418),
        }),
      );
      m.position.set(...pos);
      m.rotation.set(...rot);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // ── Color palette ──
    const SHELL     = 0x4a4e52;
    const SHELL_LT  = 0x585e64;
    const SHELL_DK  = 0x33383c;
    const UNDER     = 0x2a2a2e;
    const DARK      = 0x1a1d20;
    const ACCENT    = 0x4ad2ff;
    const GLASS     = 0x83d8ff;
    const SKID      = 0x3a3632;
    const EXHAUST   = 0x1a1d20;

    // ── FUSELAGE ──
    const fuselage = new THREE.Group();
    fuselage.name = 'fuselage';
    heli.add(fuselage);

    B(fuselage, [5.0, 2.2, 2.8], SHELL, [0, 2.4, 0]);
    B(fuselage, [4.4, 0.35, 2.6], SHELL_LT, [0, 3.55, 0]);
    B(fuselage, [5.2, 0.3, 2.6], UNDER, [0, 1.25, 0]);
    B(fuselage, [2.0, 1.8, 2.5], SHELL, [3.2, 2.5, 0]);
    B(fuselage, [1.2, 1.4, 2.2], SHELL_LT, [4.4, 2.55, 0], [0.12, 0, 0]);
    B(fuselage, [2.4, 0.3, 2.3], UNDER, [3.4, 1.55, 0]);
    G(fuselage, [1.6, 1.5, 2.3], GLASS, [4.0, 2.9, 0], [0.15, 0, 0]);
    G(fuselage, [1.8, 0.9, 0.08], GLASS, [3.6, 2.9, -1.42]);
    G(fuselage, [1.8, 0.9, 0.08], GLASS, [3.6, 2.9, 1.42]);
    G(fuselage, [0.9, 0.7, 0.08], GLASS, [1.0, 2.9, -1.42]);
    G(fuselage, [0.9, 0.7, 0.08], GLASS, [1.0, 2.9, 1.42]);
    G(fuselage, [0.9, 0.7, 0.08], GLASS, [-0.5, 2.9, -1.42]);
    G(fuselage, [0.9, 0.7, 0.08], GLASS, [-0.5, 2.9, 1.42]);
    B(fuselage, [1.8, 1.6, 2.2], SHELL, [-2.8, 2.5, 0]);
    B(fuselage, [1.0, 1.2, 1.6], SHELL_DK, [-3.8, 2.5, 0]);
    B(fuselage, [2.4, 0.7, 2.0], SHELL_DK, [-0.5, 3.75, 0]);
    B(fuselage, [0.8, 0.35, 0.5], DARK, [-0.2, 4.15, -0.9]);
    B(fuselage, [0.8, 0.35, 0.5], DARK, [-0.2, 4.15, 0.9]);
    mkCyl(fuselage, 0.15, 0.12, 0.6, EXHAUST, [-1.9, 3.7, -0.7], [0, 0, Math.PI / 2]);
    mkCyl(fuselage, 0.15, 0.12, 0.6, EXHAUST, [-1.9, 3.7, 0.7], [0, 0, Math.PI / 2]);

    // ── ACCENT DETAILS ──
    B(fuselage, [7.0, 0.15, 0.12], ACCENT, [0.3, 1.5, -1.42]);
    B(fuselage, [7.0, 0.15, 0.12], ACCENT, [0.3, 1.5, 1.42]);
    B(fuselage, [0.12, 0.8, 2.0], ACCENT, [5.0, 2.5, 0]);
    B(fuselage, [0.12, 1.0, 1.8], ACCENT, [-3.3, 2.5, 0]);

    // ── TAIL BOOM ──
    const tail = new THREE.Group();
    tail.name = 'tail-section';
    tail.position.set(-4.3, 2.5, 0);
    heli.add(tail);

    B(tail, [1.5, 0.9, 0.9], SHELL, [-0.3, 0, 0]);
    B(tail, [1.5, 0.75, 0.75], SHELL_DK, [-1.6, 0.05, 0]);
    B(tail, [1.5, 0.6, 0.6], SHELL_DK, [-2.8, 0.1, 0]);
    B(tail, [1.2, 0.5, 0.5], UNDER, [-3.8, 0.15, 0]);
    B(tail, [4.5, 0.1, 0.08], ACCENT, [-2.0, 0.45, 0]);
    B(tail, [0.9, 1.8, 0.2], DARK, [-4.2, 1.1, 0]);
    B(tail, [0.7, 0.12, 0.22], ACCENT, [-4.2, 2.0, 0]);
    B(tail, [0.6, 0.15, 1.8], SHELL_DK, [-4.0, 0.2, 0]);
    B(tail, [0.4, 0.12, 0.12], ACCENT, [-4.0, 0.28, -0.95]);
    B(tail, [0.4, 0.12, 0.12], ACCENT, [-4.0, 0.28, 0.95]);
    B(tail, [0.6, 0.7, 0.15], DARK, [-4.0, -0.5, 0]);

    // ── TAIL ROTOR ──
    const tailRotor = new THREE.Group();
    tailRotor.name = 'helicopter-tail-rotor';
    tailRotor.position.set(-4.3, 1.2, 0.14);
    tail.add(tailRotor);

    mkCyl(tailRotor, 0.08, 0.08, 0.12, DARK, [0, 0, 0], [Math.PI / 2, 0, 0]);

    for (let i = 0; i < 4; i++) {
      const bladeGroup = new THREE.Group();
      bladeGroup.rotation.z = (Math.PI / 2) * i;
      tailRotor.add(bladeGroup);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.04), tailBladeMat);
      blade.position.set(0, 0.42, 0);
      blade.name = 'tail-blade';
      blade.castShadow = true;
      bladeGroup.add(blade);
      const tip = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.08, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xb0f8ff, transparent: true, opacity: 0.9 }),
      );
      tip.position.set(0, 0.78, 0);
      bladeGroup.add(tip);
    }

    const tailBlurMat = new THREE.MeshBasicMaterial({
      color: 0x8ff4ff, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const tailBlurDisc = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.82, 32), tailBlurMat);
    tailBlurDisc.name = 'tail-blur-disc';
    tailBlurDisc.rotation.x = Math.PI / 2;
    tailRotor.add(tailBlurDisc);

    // ── LANDING SKIDS ──
    for (const side of [-1, 1]) {
      const z = side * 1.1;
      B(heli, [5.5, 0.15, 0.15], SKID, [0.5, 0.6, z]);
      B(heli, [0.15, 0.4, 0.15], SKID, [3.3, 0.8, z], [0, 0, -0.3]);
      B(heli, [0.12, 1.0, 0.12], SKID, [2.0, 1.1, z], [0, 0, 0.08]);
      B(heli, [0.12, 1.0, 0.12], SKID, [-1.2, 1.1, z], [0, 0, -0.08]);
      B(heli, [0.1, 0.1, Math.abs(z) - 0.15], SKID, [2.0, 1.55, side * 0.55]);
      B(heli, [0.1, 0.1, Math.abs(z) - 0.15], SKID, [-1.2, 1.55, side * 0.55]);
    }

    // ── MAIN ROTOR ──
    const mainRotor = new THREE.Group();
    mainRotor.name = 'helicopter-main-rotor';
    mainRotor.position.set(-0.3, 4.25, 0);
    heli.add(mainRotor);

    mkCyl(mainRotor, 0.12, 0.15, 0.5, DARK, [0, -0.25, 0]);
    mkCyl(mainRotor, 0.35, 0.3, 0.18, DARK, [0, 0.02, 0]);

    const tipGlowMat = new THREE.MeshBasicMaterial({
      color: 0xb0f8ff, transparent: true, opacity: 0.85,
    });

    for (let i = 0; i < 4; i++) {
      const bladeGroup = new THREE.Group();
      bladeGroup.rotation.y = (Math.PI / 2) * i;
      mainRotor.add(bladeGroup);

      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 3.0), bladeMat);
      inner.position.set(0, 0, 1.8);
      inner.rotation.z = 0.03;
      inner.name = 'main-blade';
      inner.castShadow = true;
      inner.receiveShadow = true;
      bladeGroup.add(inner);

      const outer = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 3.2), bladeMat);
      outer.position.set(0, 0, 4.6);
      outer.rotation.z = 0.05;
      outer.name = 'main-blade';
      outer.castShadow = true;
      outer.receiveShadow = true;
      bladeGroup.add(outer);

      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.14), tipGlowMat);
      tip.position.set(0, 0, 6.2);
      tip.name = 'main-blade';
      bladeGroup.add(tip);
    }

    const blurDiscMat = new THREE.MeshBasicMaterial({
      color: 0x8ff4ff, transparent: true, opacity: 0.0,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mainBlurDisc = new THREE.Mesh(new THREE.RingGeometry(0.5, 6.4, 64), blurDiscMat);
    mainBlurDisc.name = 'main-blur-disc';
    mainBlurDisc.rotation.x = -Math.PI / 2;
    mainRotor.add(mainBlurDisc);

    // ── DETAIL ──
    B(fuselage, [0.06, 1.6, 0.06], DARK, [1.8, 2.4, -1.42]);
    B(fuselage, [0.06, 1.6, 0.06], DARK, [1.8, 2.4, 1.42]);
    B(fuselage, [0.06, 1.6, 0.06], DARK, [0.0, 2.4, -1.42]);
    B(fuselage, [0.06, 1.6, 0.06], DARK, [0.0, 2.4, 1.42]);
    B(fuselage, [0.12, 0.12, 0.12], ACCENT, [5.05, 2.3, 0]);
    B(tail, [0.1, 0.1, 0.1], ACCENT, [-4.5, 2.0, 0]);
    B(fuselage, [0.18, 0.1, 0.18], ACCENT, [0, 1.18, 0]);

    // Orient wrapper
    const orientWrapper = new THREE.Group();
    orientWrapper.name = 'helicopter-orient-wrapper';
    orientWrapper.rotation.y = Math.PI / 2;
    while (heli.children.length > 0) {
      orientWrapper.add(heli.children[0]);
    }
    heli.add(orientWrapper);

    return heli;
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

    // Banking/roll animation
    const prevPos = mesh.userData.prevFramePos as THREE.Vector3 | undefined;
    if (prevPos && delta > 0) {
      const derivedVelX = (mesh.position.x - prevPos.x) / delta;
      const derivedVelZ = (mesh.position.z - prevPos.z) / delta;
      mesh.userData.derivedHSpeed = Math.sqrt(derivedVelX * derivedVelX + derivedVelZ * derivedVelZ);
      const yaw = mesh.rotation.y;
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const lateralSpeed = derivedVelX * rightX + derivedVelZ * rightZ;
      const targetRoll = -lateralSpeed * 0.04;
      const maxRoll = 0.26;
      const clampedRoll = Math.max(-maxRoll, Math.min(maxRoll, targetRoll));
      const prevRoll = mesh.userData.smoothRoll ?? 0;
      const rollLerp = 1 - Math.pow(0.05, delta);
      const smoothRoll = prevRoll + (clampedRoll - prevRoll) * rollLerp;
      mesh.userData.smoothRoll = smoothRoll;
      mesh.rotation.z = smoothRoll;
    }
    if (!mesh.userData.prevFramePos) {
      mesh.userData.prevFramePos = mesh.position.clone();
    } else {
      (mesh.userData.prevFramePos as THREE.Vector3).copy(mesh.position);
    }

    // ── Idle hover animation ──
    const orientWrapper = mesh.getObjectByName('helicopter-orient-wrapper');
    if (orientWrapper) {
      const hSpeed = (mesh.userData.derivedHSpeed as number) ?? 0;
      const idleBlend = Math.max(0, 1 - hSpeed / 6);
      const phase = id * 1.7;
      const t = ctx.elapsedTime;

      const bobY = (Math.sin(t * 1.1 + phase) * 0.14
                  + Math.sin(t * 2.3 + phase * 0.6) * 0.08
                  + Math.sin(t * 3.7 + phase * 1.3) * 0.035) * idleBlend;
      const driftX = (Math.sin(t * 0.7 + phase + 1.0) * 0.10
                    + Math.sin(t * 1.9 + phase * 0.8) * 0.05
                    + Math.sin(t * 2.6 + phase * 1.4) * 0.025) * idleBlend;
      const driftZ = (Math.sin(t * 0.9 + phase + 2.0) * 0.08
                    + Math.sin(t * 1.5 + phase * 1.1) * 0.04
                    + Math.sin(t * 2.9 + phase * 0.5) * 0.02) * idleBlend;

      const swayPitch = (Math.sin(t * 0.8 + phase + 0.5) * 0.035
                       + Math.sin(t * 1.7 + phase * 0.9) * 0.018
                       + Math.sin(t * 2.8 + phase * 1.1) * 0.008) * idleBlend;
      const swayRoll  = (Math.sin(t * 0.6 + phase + 3.0) * 0.04
                       + Math.sin(t * 1.3 + phase * 0.7) * 0.02
                       + Math.sin(t * 2.4 + phase * 0.3) * 0.01) * idleBlend;
      const swayYaw   = (Math.sin(t * 0.5 + phase + 4.0) * 0.025
                       + Math.sin(t * 1.1 + phase * 1.2) * 0.012
                       + Math.sin(t * 2.1 + phase * 0.9) * 0.006) * idleBlend;

      orientWrapper.position.set(driftX, bobY, driftZ);
      orientWrapper.rotation.set(swayPitch, Math.PI / 2 + swayYaw, swayRoll);
    }

    // ── Client-side rotor spin ──
    let spinRate = 2.4;
    if (isLocal) {
      let fwd = 0;
      if (ctx.controls.moveForward) fwd += 1;
      if (ctx.controls.moveBackward) fwd -= 1;
      let strafe = 0;
      if (ctx.controls.ePressed) strafe += 1;
      if (ctx.controls.qPressed) strafe -= 1;
      let lift = 0;
      if (ctx.controls.spacePressed) lift += 1;
      if (ctx.controls.shiftHeld) lift -= 1;
      spinRate = 10.0 + (Math.abs(fwd) + Math.abs(strafe)) * 4.0 + Math.abs(lift) * 2.0;
    } else {
      const vRow = ctx.getVehicleRow(id);
      if (vRow && vRow.pilotIdentity) {
        const af = Math.abs(Number(vRow.inputForward ?? 0));
        const as_ = Math.abs(Number(vRow.inputStrafe ?? 0));
        const al = Math.abs(Number(vRow.inputLift ?? 0));
        spinRate = 10.0 + (af + as_) * 4.0 + al * 2.0;
      }
    }

    const prevAngle = (mesh.userData.clientSpinAngle as number) ?? 0;
    const newAngle = prevAngle + spinRate * delta;
    mesh.userData.clientSpinAngle = newAngle;

    const mainRotor = mesh.getObjectByName('helicopter-main-rotor');
    if (mainRotor) mainRotor.rotation.y = newAngle;
    const tailRotor = mesh.getObjectByName('helicopter-tail-rotor');
    if (tailRotor) tailRotor.rotation.z = newAngle * 3.4;

    // ── Blur disc fading ──
    const BLUR_FADE_START = 5.0;
    const BLUR_FADE_FULL  = 10.0;
    const blurT = Math.max(0, Math.min(1, (spinRate - BLUR_FADE_START) / (BLUR_FADE_FULL - BLUR_FADE_START)));
    const prevBlurT = (mesh.userData.smoothBlurT as number) ?? 0;
    const blurLerp = 1 - Math.pow(0.02, delta);
    const smoothBlurT = prevBlurT + (blurT - prevBlurT) * blurLerp;
    mesh.userData.smoothBlurT = smoothBlurT;

    const bladeOpacity = 1.0 - smoothBlurT;
    const discOpacity = smoothBlurT * 0.13;

    if (mainRotor) {
      const mainDisc = mainRotor.getObjectByName('main-blur-disc') as THREE.Mesh | null;
      if (mainDisc) {
        (mainDisc.material as THREE.MeshBasicMaterial).opacity = discOpacity;
        mainDisc.visible = smoothBlurT > 0.01;
      }
      mainRotor.traverse((child) => {
        if (child instanceof THREE.Mesh && child.name === 'main-blade') {
          child.visible = bladeOpacity > 0.01;
          if (child.material instanceof THREE.Material) {
            child.material.transparent = true;
            child.material.opacity = bladeOpacity;
          }
        }
      });
    }

    if (tailRotor) {
      const tailDisc = tailRotor.getObjectByName('tail-blur-disc') as THREE.Mesh | null;
      if (tailDisc) {
        (tailDisc.material as THREE.MeshBasicMaterial).opacity = discOpacity;
        tailDisc.visible = smoothBlurT > 0.01;
      }
      tailRotor.traverse((child) => {
        if (child instanceof THREE.Mesh && child.name === 'tail-blade') {
          child.visible = bladeOpacity > 0.01;
          if (child.material instanceof THREE.Material) {
            child.material.transparent = true;
            child.material.opacity = bladeOpacity;
          }
        }
      });
    }

    // ── Helicopter audio ──
    const heliSpeed = (mesh.userData.derivedHSpeed as number) ?? 0;
    ctx.audio.updateHelicopterSound(id, mesh.position, spinRate, heliSpeed, isLocal);
  }

  // ══════════════════════════════════════════════════════════════
  //  DESTRUCTION
  // ══════════════════════════════════════════════════════════════

  onDestroy(
    instance: VehicleInstance,
    ctx: VehicleTypeDestroyContext,
  ): BreakupPiece[] {
    return HelicopterType.spawnBreakup(
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

  /** Static so VehicleManager can also call it from triggerDestroyFx with explicit pos/yaw/intensity. */
  static spawnBreakup(
    pos: { x: number; y: number; z: number },
    yaw: number,
    intensity: number,
    ctx: VehicleTypeDestroyContext,
  ): BreakupPiece[] {
    const fxIntensity = THREE.MathUtils.clamp(intensity, 0.55, 1.8);
    const colorPool = [0x2a3138, 0x38434d, 0x4a5561, 0x191f24, 0x6b7685];
    const pieceCount = Math.floor(18 + fxIntensity * 8);
    const origin = new THREE.Vector3(pos.x, pos.y + 2.2, pos.z);
    const radial = new THREE.Vector3();

    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 2.5, z: pos.z },
      color: 0xff7a32,
      intensity: 8.5 * fxIntensity,
      distance: 28 + 12 * fxIntensity,
      decay: 1.45,
      ttl: 0.22,
      kind: 'generic',
    });
    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 1.4, z: pos.z },
      color: 0xff3a12,
      intensity: 5.8 * fxIntensity,
      distance: 20 + 8 * fxIntensity,
      decay: 1.8,
      ttl: 0.42,
      kind: 'generic',
    });

    const pieces: BreakupPiece[] = [];
    for (let i = 0; i < pieceCount; i++) {
      const sx = 0.24 + Math.random() * 0.65;
      const sy = 0.2 + Math.random() * 0.55;
      const sz = 0.24 + Math.random() * 0.75;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshStandardMaterial({
          color: colorPool[(Math.random() * colorPool.length) | 0],
          roughness: 0.72,
          metalness: 0.34,
        }),
      );

      const local = new THREE.Vector3(
        (Math.random() - 0.5) * 8.5,
        (Math.random() - 0.5) * 3.2 + 1.8,
        (Math.random() - 0.5) * 5.8,
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
        .multiplyScalar((7 + Math.random() * 13) * (0.85 + fxIntensity * 0.45))
        .add(new THREE.Vector3(0, (8 + Math.random() * 10) * (0.82 + fxIntensity * 0.38), 0));
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
      );

      pieces.push({
        mesh,
        vel,
        angVel,
        ttl: 2.8 + Math.random() * 1.6 + fxIntensity * 0.4,
      });
    }

    const ringBlocks: { x: number; y: number; z: number; blockType: number }[] = [];
    const baseY = Math.floor(pos.y + 1.5);
    const ringCount = Math.floor(28 + fxIntensity * 14);
    for (let i = 0; i < ringCount; i++) {
      const ang = (i / ringCount) * Math.PI * 2;
      const r = 2.8 + Math.random() * (2.4 + fxIntensity * 1.7);
      ringBlocks.push({
        x: Math.floor(pos.x + Math.cos(ang) * r),
        y: baseY + ((Math.random() * (2 + fxIntensity * 2)) | 0),
        z: Math.floor(pos.z + Math.sin(ang) * r),
        blockType: BlockType.Metal,
      });
    }
    const blastRadius = 5.8 + fxIntensity * 1.8;
    const blastPower = 26 + fxIntensity * 18;
    ctx.physics.spawnExplosionDebris(ringBlocks, pos.x, pos.y + 2.0, pos.z, blastRadius, blastPower);
    ctx.vfx.emitExplosion(pos.x, pos.y + 2.0, pos.z, blastRadius);
    ctx.vfx.emitExplosion(pos.x, pos.y + 2.8, pos.z, blastRadius * 0.75);
    ctx.vfx.emitImpact(pos.x, pos.y + 1.4, pos.z);
    ctx.vfx.emitImpact(pos.x + 1.1, pos.y + 2.3, pos.z - 0.6);
    ctx.vfx.emitImpact(pos.x - 1.0, pos.y + 2.0, pos.z + 0.9);
    ctx.audio.playExplosion({ position: { x: pos.x, y: pos.y + 2.0, z: pos.z } });
    ctx.applyExplosionCameraEffects(pos.x, pos.y + 2.0, pos.z, blastRadius, 95 + fxIntensity * 40);

    return pieces;
  }

  // ── Breakup piece gravity constant (used by VehicleManager) ──
  static readonly BREAKUP_GRAVITY = HELI_BREAKUP_GRAVITY;
}
