/**
 * HoverType.ts — VehicleType implementation for the terrain-aware hover bike.
 *
 * A sleek, fast hovercraft that floats a fixed clearance above the surface and
 * skims over the voxel world (it never collides with or is destroyed by normal
 * terrain). Two seats (driver + passenger). Driver cannot fire weapons.
 *
 * Voxel model: low neon-trimmed deck, pointed front cowl + handlebars, a saddle
 * seat, a rear turbine cowl, and four glowing repulsor pads on the underside.
 * The model is built nose-forward along -Z to match the server's forward axis.
 */

import * as THREE from 'three';
import { BlockType } from '../VoxelWorld';
import { VEHICLE_TYPES, HOVER } from '../../shared-config';
import type {
  VehicleType,
  VehicleInstance,
  VehicleCameraConfig,
  BreakupPiece,
  VehicleTypeFrameContext,
  VehicleTypeDestroyContext,
} from './VehicleBase';

// ── Constants ──
const VEHICLE_TYPE_HOVER = VEHICLE_TYPES.Hover;
const HOVER_BREAKUP_GRAVITY = 16;
const HOVER_HIT_INDICATOR_DURATION = 0.3;
const TAU = Math.PI * 2;

export class HoverType implements VehicleType {
  readonly typeId = VEHICLE_TYPE_HOVER;
  readonly name = 'Hover';

  getHealthMax(): number {
    return HOVER.healthMax;
  }

  getMountRange(): number {
    return HOVER.mountRange;
  }

  getCameraConfig(): VehicleCameraConfig {
    return {
      distance: HOVER.camera.distance,
      height: HOVER.camera.height,
      pitchMin: HOVER.camera.pitchMin,
      pitchMax: HOVER.camera.pitchMax,
    };
  }

  getPilotSeatHeight(): number {
    return HOVER.pilotSeatHeight;
  }

  // ══════════════════════════════════════════════════════════════
  //  MODEL BUILDER
  // ══════════════════════════════════════════════════════════════

  createModel(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'hover-root';

    // ── Shared voxel-style material (hard-shaded, vertex-coloured) ──
    const voxMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0x070a0e),
      emissiveIntensity: 0.35,
      shininess: 10,
      specular: new THREE.Color(0x16202a),
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

      const v = (partVariation() - 0.5) * 0.05;
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

    // ── Glow material for neon trim + repulsor pads (bloom-friendly) ──
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x33e0ff,
      toneMapped: false,
    });
    const glowBox = (
      parent: THREE.Object3D,
      size: [number, number, number],
      pos: [number, number, number],
      hex = 0x33e0ff,
    ): THREE.Mesh => {
      const mat = hex === 0x33e0ff ? glowMat : new THREE.MeshBasicMaterial({ color: hex, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
      mesh.position.set(...pos);
      parent.add(mesh);
      return mesh;
    };

    // ── Palette (dark gunmetal + cyan neon) ──
    const BODY    = 0x2b303a;
    const BODY_LT = 0x3a414d;
    const BODY_DK = 0x1d2128;
    const METAL   = 0x4a4e56;
    const SEAT    = 0x171a1f;
    const DARK    = 0x111318;

    // Forward is -Z. Origin sits near the underside so the bike floats by its skirt.
    const deck = new THREE.Group();
    deck.name = 'deck';
    root.add(deck);

    // ── Main hover deck (flat board) ──
    B(deck, [1.7, 0.32, 4.4], BODY, [0, 0.5, 0]);
    // Underside skirt / repulsor housing
    B(deck, [1.5, 0.22, 4.0], BODY_DK, [0, 0.28, 0]);
    // Bevelled front of the deck
    B(deck, [1.3, 0.26, 1.0], BODY_LT, [0, 0.48, -2.2], [0.25, 0, 0]);

    // ── Front cowl / fairing (nose at -Z) ──
    B(deck, [1.15, 0.55, 1.1], BODY_LT, [0, 0.85, -1.95]);
    B(deck, [0.8, 0.4, 0.7], BODY, [0, 0.85, -2.55]);
    B(deck, [0.45, 0.25, 0.5], DARK, [0, 0.85, -2.95]);
    // Headlight strip
    glowBox(deck, [0.7, 0.12, 0.1], [0, 0.85, -3.18]);

    // ── Handlebars ──
    B(deck, [0.16, 0.55, 0.16], METAL, [0, 1.15, -1.45]);
    B(deck, [1.05, 0.12, 0.12], METAL, [0, 1.42, -1.35]);
    B(deck, [0.14, 0.14, 0.14], DARK, [-0.55, 1.42, -1.35]);
    B(deck, [0.14, 0.14, 0.14], DARK, [0.55, 1.42, -1.35]);

    // ── Saddle seat ──
    B(deck, [0.78, 0.3, 1.5], SEAT, [0, 1.02, 0.15]);
    B(deck, [0.82, 0.12, 0.5], BODY_DK, [0, 1.18, 0.85]); // rear seat bump

    // ── Rear turbine cowl (engine) ──
    B(deck, [1.1, 0.7, 1.2], BODY, [0, 0.9, 1.75]);
    B(deck, [0.85, 0.5, 0.4], DARK, [0, 0.9, 2.4]); // exhaust recess
    glowBox(deck, [0.55, 0.3, 0.1], [0, 0.9, 2.58], 0xff5a2a); // exhaust glow (orange)

    // ── Tail fins / spoiler ──
    B(deck, [0.12, 0.6, 0.5], BODY_LT, [-0.52, 1.2, 2.05], [0.2, 0, 0.15]);
    B(deck, [0.12, 0.6, 0.5], BODY_LT, [0.52, 1.2, 2.05], [0.2, 0, -0.15]);

    // ── Side foot rails ──
    for (const side of [-1, 1]) {
      B(deck, [0.22, 0.16, 2.6], METAL, [side * 0.92, 0.55, 0.1]);
      // Neon accent strip along the deck side
      glowBox(deck, [0.07, 0.1, 3.4], [side * 0.9, 0.62, 0]);
    }

    // ── Repulsor pads (the hover glow, underside corners) ──
    const thrusters = new THREE.Group();
    thrusters.name = 'hover-thrusters';
    deck.add(thrusters);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // Housing
        B(thrusters, [0.5, 0.18, 0.5], BODY_DK, [sx * 0.62, 0.2, sz * 1.55]);
        // Glowing emitter underneath
        glowBox(thrusters, [0.42, 0.12, 0.42], [sx * 0.62, 0.08, sz * 1.55]);
      }
    }

    // ── Hit indicator (reused damage flash) ──
    const hitIndicator = new THREE.Group();
    hitIndicator.name = 'hover-hit-indicator';
    hitIndicator.position.set(0, 2.0, 0);
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
    const addIndicatorBar = (size: [number, number, number], pos: [number, number, number]): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), hitIndicatorMat);
      mesh.position.set(...pos);
      mesh.renderOrder = 20;
      hitIndicator.add(mesh);
    };
    addIndicatorBar([1.4, 0.14, 0.18], [0, 0, 0]);
    addIndicatorBar([0.18, 0.14, 1.4], [0, 0, 0]);
    addIndicatorBar([0.22, 0.7, 0.22], [0, -0.3, 0]);

    // Orient wrapper — holds all parts so per-frame bank/bob can be applied to it
    // without disturbing the entity yaw on the root.
    const orientWrapper = new THREE.Group();
    orientWrapper.name = 'hover-orient-wrapper';
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
        mesh.userData.hitIndicatorTimer = HOVER_HIT_INDICATOR_DURATION;
        mesh.userData.hitIndicatorStrength = THREE.MathUtils.clamp(
          0.6 + damageTaken / 40,
          0.7,
          1.45,
        );
      }
      mesh.userData.lastVehicleHealth = health;
    }

    const hitIndicator = mesh.getObjectByName('hover-hit-indicator');
    const hitIndicatorTimer = Math.max(0, Number(mesh.userData.hitIndicatorTimer ?? 0) - delta);
    mesh.userData.hitIndicatorTimer = hitIndicatorTimer;
    if (hitIndicator) {
      const strength = Number(mesh.userData.hitIndicatorStrength ?? 1);
      const t = hitIndicatorTimer / HOVER_HIT_INDICATOR_DURATION;
      const alpha = Math.max(0, t * (0.55 + strength * 0.22));
      hitIndicator.visible = alpha > 0.02;
      hitIndicator.position.y = 2.0 + (1 - t) * 0.25;
      hitIndicator.scale.setScalar(0.9 + (1 - t) * 0.45 * strength);
      hitIndicator.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.opacity = alpha;
          child.material.color.setHex(t > 0.55 ? 0xfff2a6 : 0xff6a4a);
        }
      });
    }

    // ── Hover bob + bank into turns ──
    const wrapper = mesh.getObjectByName('hover-orient-wrapper');
    if (wrapper) {
      const yaw = mesh.rotation.y;
      const lastYaw = Number(mesh.userData.lastHoverYaw ?? yaw);
      let dYaw = yaw - lastYaw;
      if (dYaw > Math.PI) dYaw -= TAU;
      if (dYaw < -Math.PI) dYaw += TAU;
      mesh.userData.lastHoverYaw = yaw;

      // Lean into turns (roll proportional to yaw rate), smoothed.
      const targetRoll = THREE.MathUtils.clamp(-dYaw * 7, -0.5, 0.5);
      const roll = Number(mesh.userData.hoverRoll ?? 0);
      const newRoll = roll + (targetRoll - roll) * Math.min(1, delta * 8);
      mesh.userData.hoverRoll = newRoll;

      const bob = Math.sin(ctx.elapsedTime * 3.2 + instance.entityId) * 0.06;
      wrapper.position.y = bob;
      wrapper.rotation.set(0, 0, newRoll);
    }

    // ── Repulsor pad pulse ──
    const thrusters = mesh.getObjectByName('hover-thrusters');
    if (thrusters) {
      const pulse = 0.65 + 0.35 * Math.sin(ctx.elapsedTime * 11 + instance.entityId);
      thrusters.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
          child.material.opacity = pulse;
          child.material.transparent = true;
        }
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  DESTRUCTION
  // ══════════════════════════════════════════════════════════════

  onDestroy(
    instance: VehicleInstance,
    ctx: VehicleTypeDestroyContext,
  ): BreakupPiece[] {
    return HoverType.spawnBreakup(
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
    const colorPool = [0x2b303a, 0x3a414d, 0x1d2128, 0x4a4e56, 0x33e0ff, 0x10707f];
    const pieceCount = Math.floor(22 + fxIntensity * 12);
    const origin = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
    const radial = new THREE.Vector3();

    // Primary explosion light (cyan-white flash)
    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 1.8, z: pos.z },
      color: 0x9fe9ff,
      intensity: 11 * fxIntensity,
      distance: 36 + 14 * fxIntensity,
      decay: 1.5,
      ttl: 0.3,
      kind: 'generic',
    });
    ctx.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 0.8, z: pos.z },
      color: 0xff7a32,
      intensity: 7 * fxIntensity,
      distance: 24 + 10 * fxIntensity,
      decay: 1.7,
      ttl: 0.5,
      kind: 'generic',
    });

    const pieces: BreakupPiece[] = [];
    for (let i = 0; i < pieceCount; i++) {
      const sx = 0.25 + Math.random() * 0.9;
      const sy = 0.12 + Math.random() * 0.4;
      const sz = 0.25 + Math.random() * 0.9;
      const isGlow = Math.random() < 0.25;
      const colorHex = colorPool[(Math.random() * colorPool.length) | 0];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        isGlow
          ? new THREE.MeshBasicMaterial({ color: 0x33e0ff, toneMapped: false })
          : new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.7, metalness: 0.35 }),
      );

      const local = new THREE.Vector3(
        (Math.random() - 0.5) * 4.0,
        (Math.random() - 0.5) * 2.0 + 0.8,
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
        .multiplyScalar((6 + Math.random() * 11) * (0.85 + fxIntensity * 0.45))
        .add(new THREE.Vector3(0, (8 + Math.random() * 8) * (0.8 + fxIntensity * 0.4), 0));
      const angVel = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
      );

      pieces.push({
        mesh,
        vel,
        angVel,
        ttl: 2.6 + Math.random() * 2.2 + fxIntensity * 0.5,
      });
    }

    // Explosion debris ring
    const ringBlocks: { x: number; y: number; z: number; blockType: number }[] = [];
    const baseY = Math.floor(pos.y + 0.5);
    const ringCount = Math.floor(20 + fxIntensity * 12);
    for (let i = 0; i < ringCount; i++) {
      const ang = (i / ringCount) * Math.PI * 2;
      const r = 2.0 + Math.random() * (2.5 + fxIntensity * 2.0);
      ringBlocks.push({
        x: Math.floor(pos.x + Math.cos(ang) * r),
        y: baseY + ((Math.random() * (2 + fxIntensity * 1.5)) | 0),
        z: Math.floor(pos.z + Math.sin(ang) * r),
        blockType: BlockType.Metal,
      });
    }
    const blastRadius = 5.0 + fxIntensity * 2.0;
    const blastPower = 24 + fxIntensity * 18;
    ctx.physics.spawnExplosionDebris(ringBlocks, pos.x, pos.y + 1.0, pos.z, blastRadius, blastPower);
    ctx.vfx.emitExplosion(pos.x, pos.y + 1.0, pos.z, blastRadius);
    ctx.vfx.emitExplosion(pos.x, pos.y + 1.8, pos.z, blastRadius * 0.6);
    ctx.vfx.emitImpact(pos.x, pos.y + 0.6, pos.z);
    ctx.audio.playExplosion({ position: { x: pos.x, y: pos.y + 1.0, z: pos.z } });
    ctx.applyExplosionCameraEffects(pos.x, pos.y + 1.0, pos.z, blastRadius, 100 + fxIntensity * 40);

    return pieces;
  }

  static readonly BREAKUP_GRAVITY = HOVER_BREAKUP_GRAVITY;
}
