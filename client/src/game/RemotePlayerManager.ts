import * as THREE from 'three';
import { InterpolationBuffer } from './InterpolationBuffer';
import { normalizeCharacterPreset } from '../characterPresets';
import {
  PLAYER_MOVEMENT_FLAG_CLIMBING,
  PLAYER_MOVEMENT_FLAG_CROUCHING,
  PLAYER_MOVEMENT_FLAG_GROUNDED,
  PLAYER_MOVEMENT_FLAG_SLIDING,
  PLAYER_MOVEMENT_FLAG_SPRINTING,
  hasPlayerMovementFlag,
} from './playerMovementFlags';
import {
  createRemotePlayerModel,
  disposeObjectMaterials,
  drawNametag,
  getRemoteWeaponHoldPose,
  normalizeWeaponIndex,
  setRemoteWeaponModel,
  type RemotePlayerRig,
} from './RemotePlayerModel';

export interface RemotePlayerContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  localIdentity: string | null;
}

interface RemotePlayerRuntime {
  username: string;
  characterPreset: number;
  currentWeapon: number;
  movementFlags: number;
  nametagCanvas?: HTMLCanvasElement;
  nametagTexture?: THREE.CanvasTexture;
  rig?: RemotePlayerRig;
  renderVelocity?: THREE.Vector3;
  animTime?: number;
  crouchAlpha?: number;
  sprintAlpha?: number;
  slideAlpha?: number;
  climbAlpha?: number;
  groundedAlpha?: number;
  pitch?: number;
}

const SNIPER_WEAPON_INDEX = 5;
const GLINT_DOT_THRESHOLD = 0.92;
const GLINT_MAX_DIST = 200;
const GLINT_MIN_DIST = 8;
const GLINT_PULSE_SPEED = 4;
const REMOTE_PLAYER_FOOT_OFFSET = 1.7;
const REMOTE_PLAYER_EYE_HEIGHT = 2.05;
const REMOTE_PLAYER_NAMETAG_Y = 3.05;

function damp(current: number, target: number, lambda: number, delta: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * delta));
}

export class RemotePlayerManager {
  readonly otherPlayers: Map<string, THREE.Group> = new Map();
  readonly interpBuffers: Map<string, InterpolationBuffer> = new Map();
  private ctx: RemotePlayerContext;
  private glintSprites: Map<string, THREE.Sprite> = new Map();
  private glintTime = 0;
  private static glintMaterial: THREE.SpriteMaterial | null = null;

  constructor(ctx: RemotePlayerContext) {
    this.ctx = ctx;
  }

  private getRuntime(group: THREE.Group): RemotePlayerRuntime {
    return group.userData as RemotePlayerRuntime;
  }

  private getGlintMaterial(): THREE.SpriteMaterial {
    if (!RemotePlayerManager.glintMaterial) {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const c = canvas.getContext('2d')!;
      const cx = size / 2;
      const cy = size / 2;

      const outer = c.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
      outer.addColorStop(0, 'rgba(255, 255, 255, 1)');
      outer.addColorStop(0.1, 'rgba(230, 180, 255, 0.9)');
      outer.addColorStop(0.3, 'rgba(200, 100, 255, 0.4)');
      outer.addColorStop(0.6, 'rgba(180, 60, 255, 0.1)');
      outer.addColorStop(1, 'rgba(180, 60, 255, 0)');
      c.fillStyle = outer;
      c.fillRect(0, 0, size, size);

      c.globalCompositeOperation = 'lighter';
      const streak = c.createLinearGradient(0, cy, size, cy);
      streak.addColorStop(0, 'rgba(255, 200, 255, 0)');
      streak.addColorStop(0.3, 'rgba(255, 200, 255, 0.15)');
      streak.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
      streak.addColorStop(0.7, 'rgba(255, 200, 255, 0.15)');
      streak.addColorStop(1, 'rgba(255, 200, 255, 0)');
      c.fillStyle = streak;
      c.fillRect(0, cy - 3, size, 6);

      const texture = new THREE.CanvasTexture(canvas);
      RemotePlayerManager.glintMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    }
    return RemotePlayerManager.glintMaterial;
  }

  private animateRemotePlayer(group: THREE.Group, delta: number): void {
    const runtime = this.getRuntime(group);
    const rig = runtime.rig;
    if (!rig) return;

    const velocity = runtime.renderVelocity ?? new THREE.Vector3();
    runtime.renderVelocity = velocity;

    const pitch = runtime.pitch ?? 0;
    const flags = runtime.movementFlags ?? 0;
    const sprinting = hasPlayerMovementFlag(flags, PLAYER_MOVEMENT_FLAG_SPRINTING);
    const crouching = hasPlayerMovementFlag(flags, PLAYER_MOVEMENT_FLAG_CROUCHING);
    const sliding = hasPlayerMovementFlag(flags, PLAYER_MOVEMENT_FLAG_SLIDING);
    const climbing = hasPlayerMovementFlag(flags, PLAYER_MOVEMENT_FLAG_CLIMBING);
    const grounded = hasPlayerMovementFlag(flags, PLAYER_MOVEMENT_FLAG_GROUNDED) && !climbing;

    runtime.crouchAlpha = damp(runtime.crouchAlpha ?? 0, crouching ? 1 : 0, 14, delta);
    runtime.sprintAlpha = damp(runtime.sprintAlpha ?? 0, sprinting ? 1 : 0, 10, delta);
    runtime.slideAlpha = damp(runtime.slideAlpha ?? 0, sliding ? 1 : 0, 16, delta);
    runtime.climbAlpha = damp(runtime.climbAlpha ?? 0, climbing ? 1 : 0, 16, delta);
    runtime.groundedAlpha = damp(runtime.groundedAlpha ?? 1, grounded ? 1 : 0, 12, delta);

    const crouchAlpha = runtime.crouchAlpha;
    const sprintAlpha = runtime.sprintAlpha;
    const slideAlpha = runtime.slideAlpha;
    const climbAlpha = runtime.climbAlpha;
    const groundedAlpha = runtime.groundedAlpha;

    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const moveAlpha = THREE.MathUtils.clamp(horizontalSpeed / (sprinting ? 16 : crouching ? 5 : 10), 0, 1);
    const idleMotion = 1 - moveAlpha;
    const stepRate = climbAlpha > 0.2
      ? 8
      : THREE.MathUtils.lerp(1.8, sprinting ? 16 : crouching ? 7.5 : 11, moveAlpha);
    runtime.animTime = (runtime.animTime ?? 0) + delta * stepRate;
    const animTime = runtime.animTime;

    const yaw = group.rotation.y;
    const localForward = horizontalSpeed > 0.001
      ? (-Math.sin(yaw) * velocity.x - Math.cos(yaw) * velocity.z) / horizontalSpeed
      : 0;
    const localStrafe = horizontalSpeed > 0.001
      ? (Math.cos(yaw) * velocity.x - Math.sin(yaw) * velocity.z) / horizontalSpeed
      : 0;
    const bodyTwist = localStrafe * 0.12 * moveAlpha;
    const bodyLeanZ = localStrafe * 0.08 * moveAlpha;
    const forwardLean = localForward * (0.06 + sprintAlpha * 0.12) + slideAlpha * 0.4 + climbAlpha * 0.18;
    const airborne = groundedAlpha < 0.45 && climbAlpha < 0.2;
    const rising = airborne && velocity.y > 1.4;
    const falling = airborne && velocity.y < -1.4;
    const climbWave = Math.sin(animTime * 0.95);
    const walkWave = Math.sin(animTime);
    const bounceWave = Math.sin(animTime * 2);
    const upperAimX = pitch * 0.35;
    const weaponPose = getRemoteWeaponHoldPose(runtime.currentWeapon ?? 0);

    const crouchDrop = crouchAlpha * 0.24 + slideAlpha * 0.12;
    const bobY = climbAlpha > 0.2
      ? Math.sin(animTime * 2.1) * 0.03
      : bounceWave * moveAlpha * (crouching ? 0.018 : sprinting ? 0.05 : 0.032);
    rig.root.position.set(0, bobY - crouchDrop, 0);
    rig.root.rotation.set(0, bodyTwist, 0);

    const upperBodyY = 1.22 - crouchAlpha * 0.08 - slideAlpha * 0.06;
    rig.upperBody.position.set(0, upperBodyY, 0.01);
    rig.upperBody.rotation.x = upperAimX + forwardLean;
    rig.upperBody.rotation.y = bodyTwist * 0.25;
    rig.upperBody.rotation.z = bodyLeanZ;

    rig.head.position.y = 0.72 - crouchAlpha * 0.06 - slideAlpha * 0.03;
    rig.head.rotation.x = -upperAimX * 0.2 - sprintAlpha * 0.06 + climbAlpha * 0.06;
    rig.head.rotation.y = -bodyTwist * 0.35;
    rig.head.rotation.z = -bodyLeanZ * 0.5;

    rig.gunMount.position.set(
      weaponPose.mountPosition[0] + localStrafe * 0.025,
      weaponPose.mountPosition[1] - crouchAlpha * 0.04 - slideAlpha * 0.05 + bounceWave * moveAlpha * 0.012,
      weaponPose.mountPosition[2] - sprintAlpha * 0.05 - slideAlpha * 0.08 + walkWave * moveAlpha * 0.01,
    );
    rig.gunMount.rotation.set(
      weaponPose.mountRotation[0] + pitch * 0.42 + sprintAlpha * 0.08 + slideAlpha * 0.12,
      weaponPose.mountRotation[1] + bodyTwist * 0.35,
      weaponPose.mountRotation[2] - localStrafe * 0.05 - forwardLean * 0.08,
    );

    const legSwing = moveAlpha * (crouching ? 0.42 : sprinting ? 0.88 : 0.64);
    const armSwing = moveAlpha * (crouching ? 0.05 : sprinting ? 0.09 : 0.035);
    let leftArmX = weaponPose.leftArmRotation[0] + pitch * 0.12 + walkWave * armSwing;
    let rightArmX = weaponPose.rightArmRotation[0] + pitch * 0.18 - walkWave * armSwing * 0.65;
    let leftArmY = weaponPose.leftArmRotation[1] + bodyTwist * 0.18;
    let rightArmY = weaponPose.rightArmRotation[1] + bodyTwist * 0.18;
    let leftArmZ = weaponPose.leftArmRotation[2] - crouchAlpha * 0.04 - localStrafe * 0.03;
    let rightArmZ = weaponPose.rightArmRotation[2] + crouchAlpha * 0.03 - localStrafe * 0.02;
    let leftLegX = walkWave * legSwing;
    let rightLegX = -walkWave * legSwing;
    let leftLegZ = 0;
    let rightLegZ = 0;

    if (climbAlpha > 0.2) {
      leftArmX = 1.5 - climbWave * 0.45;
      rightArmX = 1.4 + climbWave * 0.45;
      leftArmY = 0.06;
      rightArmY = -0.06;
      leftArmZ = -0.14;
      rightArmZ = 0.14;
      leftLegX = 0.5 - climbWave * 0.4;
      rightLegX = 0.5 + climbWave * 0.4;
      leftLegZ = -0.05;
      rightLegZ = 0.05;
    } else if (slideAlpha > 0.25) {
      leftArmX = 0.28;
      rightArmX = 0.6;
      leftArmY = 0.12;
      rightArmY = -0.16;
      leftArmZ = -0.45;
      rightArmZ = 0.18;
      leftLegX = -0.95;
      rightLegX = -0.82;
      leftLegZ = 0.05;
      rightLegZ = -0.05;
    } else if (airborne) {
      leftArmX += rising ? 0.16 : -0.08;
      rightArmX += rising ? 0.12 : -0.04;
      leftLegX = rising ? -0.24 : 0.26;
      rightLegX = rising ? -0.12 : 0.18;
      leftLegZ = 0.04;
      rightLegZ = -0.04;
    }

    rig.leftArm.rotation.x = leftArmX;
    rig.leftArm.rotation.y = leftArmY;
    rig.leftArm.rotation.z = leftArmZ;
    rig.rightArm.rotation.x = rightArmX;
    rig.rightArm.rotation.y = rightArmY;
    rig.rightArm.rotation.z = rightArmZ;

    rig.leftLeg.position.y = 0.96 - crouchAlpha * 0.18 - slideAlpha * 0.14;
    rig.rightLeg.position.y = 0.96 - crouchAlpha * 0.18 - slideAlpha * 0.14;
    rig.leftLeg.rotation.x = leftLegX;
    rig.leftLeg.rotation.z = leftLegZ;
    rig.rightLeg.rotation.x = rightLegX;
    rig.rightLeg.rotation.z = rightLegZ;

    const nametag = group.getObjectByName('remote-player-nametag');
    if (nametag instanceof THREE.Sprite) {
      nametag.position.y = REMOTE_PLAYER_NAMETAG_Y - crouchAlpha * 0.18 - slideAlpha * 0.08 + bobY * 0.4;
    }

    if (idleMotion > 0.7 && groundedAlpha > 0.8) {
      rig.head.position.y += Math.sin(animTime * 0.6) * 0.02;
      rig.upperBody.position.y += Math.sin(animTime * 0.5) * 0.01;
    }

    if (falling) {
      rig.upperBody.rotation.x += 0.08;
      rig.leftArm.rotation.x -= 0.08;
      rig.rightArm.rotation.x -= 0.08;
    }
  }

  shouldRenderRemotePlayer(player: any): boolean {
    return player.online && player.health > 0 && !player.spawnProtected
      && Number(player.mountedVehicleId ?? 0) === 0;
  }

  updateOtherPlayer(
    id: string,
    pos: { x: number; y: number; z: number },
    vel: { x: number; y: number; z: number },
    rot: { yaw: number; pitch: number },
    username: string,
    characterPreset: number,
    currentWeapon: number,
    movementFlags: number,
  ): void {
    const normalizedPreset = normalizeCharacterPreset(characterPreset);
    const normalizedWeapon = normalizeWeaponIndex(currentWeapon);
    let group = this.otherPlayers.get(id);
    if (!group) {
      group = new THREE.Group();
      const rig = createRemotePlayerModel(normalizedPreset);
      rig.model.name = 'remote-player-model';
      group.add(rig.model);
      setRemoteWeaponModel(group, normalizedWeapon, normalizedPreset);

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      drawNametag(canvas, texture, username);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      }));
      sprite.name = 'remote-player-nametag';
      sprite.position.y = REMOTE_PLAYER_NAMETAG_Y;
      sprite.scale.set(2.8, 0.7, 1);
      group.add(sprite);

      const runtime = this.getRuntime(group);
      runtime.username = username;
      runtime.characterPreset = normalizedPreset;
      runtime.currentWeapon = normalizedWeapon;
      runtime.movementFlags = movementFlags;
      runtime.nametagCanvas = canvas;
      runtime.nametagTexture = texture;
      runtime.rig = rig;
      runtime.renderVelocity = new THREE.Vector3();
      runtime.animTime = Math.random() * Math.PI * 2;
      runtime.pitch = rot.pitch;

      this.ctx.scene.add(group);
      this.otherPlayers.set(id, group);
      this.interpBuffers.set(id, new InterpolationBuffer());
    } else {
      const runtime = this.getRuntime(group);
      if (runtime.characterPreset !== normalizedPreset) {
        const existingModel = group.getObjectByName('remote-player-model');
        if (existingModel) {
          group.remove(existingModel);
          disposeObjectMaterials(existingModel);
        }
        const rig = createRemotePlayerModel(normalizedPreset);
        rig.model.name = 'remote-player-model';
        group.add(rig.model);
        setRemoteWeaponModel(group, normalizedWeapon, normalizedPreset);
        runtime.characterPreset = normalizedPreset;
        runtime.currentWeapon = normalizedWeapon;
        runtime.rig = rig;
      }

      if (runtime.currentWeapon !== normalizedWeapon) {
        setRemoteWeaponModel(group, normalizedWeapon, normalizedPreset);
        runtime.currentWeapon = normalizedWeapon;
      }

      if (runtime.username !== username) {
        if (runtime.nametagCanvas && runtime.nametagTexture) {
          drawNametag(runtime.nametagCanvas, runtime.nametagTexture, username);
        }
        runtime.username = username;
      }

      runtime.movementFlags = movementFlags;
      runtime.pitch = rot.pitch;
      runtime.renderVelocity ??= new THREE.Vector3();
    }

    const runtime = this.getRuntime(group);
    runtime.movementFlags = movementFlags;
    runtime.pitch = rot.pitch;
    runtime.renderVelocity?.set(vel.x, vel.y, vel.z);

    const buffer = this.interpBuffers.get(id)!;
    buffer.push(
      new THREE.Vector3(pos.x, pos.y - REMOTE_PLAYER_FOOT_OFFSET, pos.z),
      new THREE.Vector3(vel.x, vel.y, vel.z),
      rot,
    );
  }

  removeOtherPlayer(id: string): void {
    const group = this.otherPlayers.get(id);
    if (group) {
      const runtime = this.getRuntime(group);
      if (runtime.nametagTexture) runtime.nametagTexture.dispose();
      const nametag = group.getObjectByName('remote-player-nametag');
      if (nametag instanceof THREE.Sprite) nametag.material.dispose();
      const model = group.getObjectByName('remote-player-model');
      if (model) disposeObjectMaterials(model);
      this.ctx.scene.remove(group);
      this.otherPlayers.delete(id);
    }
    this.interpBuffers.delete(id);

    const glint = this.glintSprites.get(id);
    if (glint) {
      glint.material.dispose();
      this.ctx.scene.remove(glint);
      this.glintSprites.delete(id);
    }
  }

  interpolateAll(delta = 0.016): void {
    this.glintTime += delta;
    const interpRot = { yaw: 0, pitch: 0 };
    const camPos = this.ctx.camera.position;
    const toPlayer = new THREE.Vector3();
    const lookDir = new THREE.Vector3();

    for (const [id, group] of this.otherPlayers) {
      const buffer = this.interpBuffers.get(id);
      const runtime = this.getRuntime(group);
      if (buffer && buffer.hasData()) {
        buffer.sample(group.position, interpRot);
        group.rotation.y = interpRot.yaw;
        runtime.pitch = interpRot.pitch;
      }

      this.animateRemotePlayer(group, delta);

      const crouchAlpha = runtime.crouchAlpha ?? 0;
      const slideAlpha = runtime.slideAlpha ?? 0;
      const eyeY = group.position.y + REMOTE_PLAYER_EYE_HEIGHT - crouchAlpha * 0.14 - slideAlpha * 0.08;
      const weaponIdx = runtime.currentWeapon ?? 0;

      if (weaponIdx === SNIPER_WEAPON_INDEX) {
        toPlayer.set(
          camPos.x - group.position.x,
          camPos.y - eyeY,
          camPos.z - group.position.z,
        );
        const dist = toPlayer.length();

        if (dist > GLINT_MIN_DIST && dist < GLINT_MAX_DIST) {
          toPlayer.divideScalar(dist);
          const cosPitch = Math.cos(interpRot.pitch);
          lookDir.set(
            -Math.sin(interpRot.yaw) * cosPitch,
            -Math.sin(interpRot.pitch),
            -Math.cos(interpRot.yaw) * cosPitch,
          );

          const dot = lookDir.dot(toPlayer);
          if (dot > GLINT_DOT_THRESHOLD) {
            const intensity = (dot - GLINT_DOT_THRESHOLD) / (1 - GLINT_DOT_THRESHOLD);
            const distFade = 1 - (dist - GLINT_MIN_DIST) / (GLINT_MAX_DIST - GLINT_MIN_DIST);
            const pulse = 0.6 + 0.4 * Math.sin(this.glintTime * GLINT_PULSE_SPEED);
            const alpha = intensity * distFade * pulse;

            let sprite = this.glintSprites.get(id);
            if (!sprite) {
              sprite = new THREE.Sprite(this.getGlintMaterial().clone());
              sprite.renderOrder = 999;
              this.ctx.scene.add(sprite);
              this.glintSprites.set(id, sprite);
            }
            sprite.position.set(group.position.x, eyeY, group.position.z);
            const baseScale = 0.4 + dist * 0.012;
            sprite.scale.setScalar(baseScale * (0.8 + intensity * 0.4));
            sprite.material.opacity = Math.min(1, alpha * 1.2);
            sprite.visible = true;
            continue;
          }
        }
      }

      const existingGlint = this.glintSprites.get(id);
      if (existingGlint) existingGlint.visible = false;
    }
  }

  flushAllBuffers(): void {
    for (const buffer of this.interpBuffers.values()) {
      buffer.clear();
    }
  }

  destroyAll(): void {
    for (const id of Array.from(this.otherPlayers.keys())) this.removeOtherPlayer(id);
  }
}
