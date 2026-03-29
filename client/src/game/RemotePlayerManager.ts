import * as THREE from 'three';
import { InterpolationBuffer } from './InterpolationBuffer';
import { WEAPONS } from './Weapons';
import { getCharacterPreset, normalizeCharacterPreset } from '../characterPresets';

// ── Standalone utility ──

/** Recursively dispose all geometries and materials under the given object. */
export function disposeObjectMaterials(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    if (Array.isArray(node.material)) {
      for (const mat of node.material) mat.dispose();
    } else {
      node.material.dispose();
    }
  });
}

// ── Context interface ──

/** Dependencies the RemotePlayerManager needs from the Engine. */
export interface RemotePlayerContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  localIdentity: string | null;
}

// ── RemotePlayerManager ──

// ── Sniper glint constants ──
const SNIPER_WEAPON_INDEX = 5;
const GLINT_DOT_THRESHOLD = 0.92;   // cos(~23°) — must be roughly aimed at you
const GLINT_MAX_DIST = 200;         // meters — matches sniper max range
const GLINT_MIN_DIST = 8;           // too close = no glint visible
const GLINT_PULSE_SPEED = 4;        // shimmer speed

export class RemotePlayerManager {
  readonly otherPlayers: Map<string, THREE.Group> = new Map();
  readonly interpBuffers: Map<string, InterpolationBuffer> = new Map();
  private ctx: RemotePlayerContext;

  // Sniper glint system
  private glintSprites: Map<string, THREE.Sprite> = new Map();
  private glintTime = 0;
  private static glintMaterial: THREE.SpriteMaterial | null = null;

  constructor(ctx: RemotePlayerContext) {
    this.ctx = ctx;
  }

  private getGlintMaterial(): THREE.SpriteMaterial {
    if (!RemotePlayerManager.glintMaterial) {
      // Create a radial gradient texture for the lens flare
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const c = canvas.getContext('2d')!;
      const cx = size / 2, cy = size / 2;

      // Outer soft glow
      const outer = c.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
      outer.addColorStop(0, 'rgba(255, 255, 255, 1)');
      outer.addColorStop(0.1, 'rgba(230, 180, 255, 0.9)');
      outer.addColorStop(0.3, 'rgba(200, 100, 255, 0.4)');
      outer.addColorStop(0.6, 'rgba(180, 60, 255, 0.1)');
      outer.addColorStop(1, 'rgba(180, 60, 255, 0)');
      c.fillStyle = outer;
      c.fillRect(0, 0, size, size);

      // Horizontal flare streak
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

  // ── Nametag drawing ──

  private drawNametag(
    canvas: HTMLCanvasElement,
    texture: THREE.CanvasTexture,
    username: string,
  ): void {
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const w = canvas.width;
    const h = canvas.height;
    const displayName = username.length > 16 ? `${username.slice(0, 16)}...` : username;
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.imageSmoothingEnabled = false;

    // Flat dark background — sharp rectangle
    const bgX = 16, bgY = 6, bgW = w - 32, bgH = h - 12;
    ctx2d.fillStyle = 'rgba(6, 12, 22, 0.9)';
    ctx2d.fillRect(bgX, bgY, bgW, bgH);

    // 2px solid border
    ctx2d.strokeStyle = '#76ff03';
    ctx2d.lineWidth = 3;
    ctx2d.strokeRect(bgX, bgY, bgW, bgH);

    // Name text — pixel font with hard offset shadow
    ctx2d.font = 'bold 24px "Press Start 2P", monospace';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';

    // Hard shadow (offset, no blur)
    ctx2d.fillStyle = '#000000';
    ctx2d.fillText(displayName, w / 2 + 2, h / 2 + 2);

    // Main text
    ctx2d.fillStyle = '#76ff03';
    ctx2d.fillText(displayName, w / 2, h / 2);

    texture.needsUpdate = true;
  }

  // ── Player model creation ──

  private createRemotePlayerModel(presetValue: number): THREE.Group {
    const preset = getCharacterPreset(presetValue);
    const model = new THREE.Group();

    // Flat Lambert materials — retro blocky look
    const bodyMat = new THREE.MeshLambertMaterial({ color: preset.bodyColor });
    const vestMat = new THREE.MeshLambertMaterial({ color: preset.vestColor });
    const headMat = new THREE.MeshLambertMaterial({ color: preset.headColor });
    const visorMat = new THREE.MeshLambertMaterial({ color: preset.visorColor, emissive: preset.visorColor, emissiveIntensity: 0.4 });
    const accentMat = new THREE.MeshLambertMaterial({ color: preset.accentColor, emissive: preset.accentColor, emissiveIntensity: 0.15 });
    // Darkened body for legs
    const legMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(preset.bodyColor).multiplyScalar(0.7).getHex() });

    const addBox = (
      size: [number, number, number],
      material: THREE.Material,
      position: [number, number, number],
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      model.add(mesh);
      return mesh;
    };

    // ── HEAD ──
    addBox([0.5, 0.5, 0.5], headMat, [0, 1.65, 0]);
    // Visor slit
    addBox([0.44, 0.12, 0.06], visorMat, [0, 1.68, -0.26]);

    // ── BODY ──
    addBox([0.55, 0.65, 0.3], vestMat, [0, 1.1, 0]);
    // Accent stripe across chest
    addBox([0.55, 0.06, 0.32], accentMat, [0, 1.35, 0]);

    // ── ARMS ──
    addBox([0.2, 0.6, 0.2], bodyMat, [-0.38, 1.05, 0]);
    addBox([0.2, 0.6, 0.2], bodyMat, [0.38, 1.05, 0]);

    // ── LEGS ──
    addBox([0.22, 0.5, 0.22], legMat, [-0.14, 0.4, 0]);
    addBox([0.22, 0.5, 0.22], legMat, [0.14, 0.4, 0]);

    const gunMount = new THREE.Group();
    gunMount.name = 'remote-player-gun-mount';
    gunMount.position.set(0.48, 0.95, -0.15);
    gunMount.rotation.set(-0.08, -0.03, -0.22);
    model.add(gunMount);

    return model;
  }

  // ── Weapon model helpers ──

  private normalizeWeaponIndex(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const idx = Math.floor(value);
    if (idx < 0 || idx >= WEAPONS.length) return 0;
    return idx;
  }

  private createRemoteWeaponModel(weaponIndex: number, presetValue: number): THREE.Group {
    const preset = getCharacterPreset(presetValue);
    const idx = this.normalizeWeaponIndex(weaponIndex);
    const parsed = Number.parseInt(WEAPONS[idx]?.color.replace('#', ''), 16);
    const mainColor = Number.isFinite(parsed) ? parsed : preset.gunColor;

    const gun = new THREE.Group();
    gun.name = 'remote-player-gun';

    const gunMat = new THREE.MeshLambertMaterial({ color: mainColor });
    const bodyMat = new THREE.MeshLambertMaterial({ color: preset.gunColor });
    const detailMat = new THREE.MeshLambertMaterial({ color: preset.accentColor, emissive: preset.accentColor, emissiveIntensity: 0.25 });

    const add = (size: [number, number, number], material: THREE.Material, pos: [number, number, number]): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      gun.add(mesh);
    };

    if (idx === 1) {
      // Shotgun: body + barrel + accent
      add([0.1, 0.09, 0.4], bodyMat, [0, 0, -0.03]);
      add([0.06, 0.06, 0.3], gunMat, [0, 0, -0.3]);
      add([0.08, 0.015, 0.06], detailMat, [0, 0.05, -0.1]);
    } else if (idx === 2) {
      // RPG: tube + flare + tip
      add([0.12, 0.12, 0.5], bodyMat, [0, 0, -0.07]);
      add([0.14, 0.14, 0.06], gunMat, [0, 0, -0.36]);
      add([0.07, 0.07, 0.07], detailMat, [0, 0, -0.42]);
    } else if (idx === 3) {
      // Machine gun: body + barrel + accent
      add([0.1, 0.09, 0.4], bodyMat, [0, 0, 0]);
      add([0.05, 0.05, 0.35], gunMat, [0, 0.01, -0.3]);
      add([0.1, 0.015, 0.12], detailMat, [0, 0.06, 0]);
    } else if (idx === 4) {
      // Grenade launcher: tube + breech + drum
      add([0.12, 0.12, 0.4], bodyMat, [0, 0, -0.05]);
      add([0.13, 0.11, 0.1], gunMat, [0, 0, 0.2]);
      add([0.08, 0.08, 0.08], detailMat, [0, -0.09, 0.06]);
    } else {
      // Rifle: body + barrel + accent
      add([0.08, 0.08, 0.3], bodyMat, [0, 0, 0]);
      add([0.04, 0.04, 0.3], gunMat, [0, 0, -0.28]);
      add([0.075, 0.015, 0.12], detailMat, [0, 0.04, -0.08]);
    }

    return gun;
  }

  private setRemoteWeaponModel(group: THREE.Group, weaponIndex: number, presetValue: number): void {
    const mount = group.getObjectByName('remote-player-gun-mount');
    if (!(mount instanceof THREE.Group)) return;

    const existingGun = mount.getObjectByName('remote-player-gun');
    if (existingGun) {
      mount.remove(existingGun);
      disposeObjectMaterials(existingGun);
    }

    const gun = this.createRemoteWeaponModel(weaponIndex, presetValue);
    mount.add(gun);
  }

  // ── Public API ──

  shouldRenderRemotePlayer(player: any): boolean {
    return player.online && player.health > 0 && !player.spawnProtected
      && Number(player.mountedVehicleId ?? 0) === 0;
  }

  updateOtherPlayer(
    id: string, pos: { x: number; y: number; z: number },
    vel: { x: number; y: number; z: number },
    rot: { yaw: number; pitch: number },
    username: string,
    characterPreset: number,
    currentWeapon: number,
  ): void {
    const normalizedPreset = normalizeCharacterPreset(characterPreset);
    const normalizedWeapon = this.normalizeWeaponIndex(currentWeapon);
    let group = this.otherPlayers.get(id);
    if (!group) {
      group = new THREE.Group();
      const model = this.createRemotePlayerModel(normalizedPreset);
      model.name = 'remote-player-model';
      group.add(model);
      this.setRemoteWeaponModel(group, normalizedWeapon, normalizedPreset);

      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 128;
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      this.drawNametag(canvas, texture, username);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
      sprite.name = 'remote-player-nametag';
      sprite.position.y = 2.15; sprite.scale.set(2.4, 0.6, 1);
      group.add(sprite);
      group.userData.username = username;
      group.userData.characterPreset = normalizedPreset;
      group.userData.currentWeapon = normalizedWeapon;
      group.userData.nametagCanvas = canvas;
      group.userData.nametagTexture = texture;
      this.ctx.scene.add(group);
      this.otherPlayers.set(id, group);
      this.interpBuffers.set(id, new InterpolationBuffer());
    } else {
      if (group.userData.characterPreset !== normalizedPreset) {
        const existingModel = group.getObjectByName('remote-player-model');
        if (existingModel) {
          group.remove(existingModel);
          disposeObjectMaterials(existingModel);
        }
        const model = this.createRemotePlayerModel(normalizedPreset);
        model.name = 'remote-player-model';
        group.add(model);
        this.setRemoteWeaponModel(group, normalizedWeapon, normalizedPreset);
        group.userData.characterPreset = normalizedPreset;
        group.userData.currentWeapon = normalizedWeapon;
      }

      if (group.userData.currentWeapon !== normalizedWeapon) {
        this.setRemoteWeaponModel(group, normalizedWeapon, normalizedPreset);
        group.userData.currentWeapon = normalizedWeapon;
      }

      if (group.userData.username !== username) {
        const canvas = group.userData.nametagCanvas as HTMLCanvasElement | undefined;
        const texture = group.userData.nametagTexture as THREE.CanvasTexture | undefined;
        if (canvas && texture) this.drawNametag(canvas, texture, username);
        group.userData.username = username;
      }
    }

    // Push snapshot to interpolation buffer instead of immediate lerp
    const buffer = this.interpBuffers.get(id)!;
    buffer.push(
      new THREE.Vector3(pos.x, pos.y - 1.7, pos.z),
      new THREE.Vector3(vel.x, vel.y, vel.z),
      rot,
    );
  }

  removeOtherPlayer(id: string): void {
    const g = this.otherPlayers.get(id);
    if (g) {
      const nametagTexture = g.userData.nametagTexture as THREE.CanvasTexture | undefined;
      if (nametagTexture) nametagTexture.dispose();
      const nametag = g.getObjectByName('remote-player-nametag');
      if (nametag instanceof THREE.Sprite) nametag.material.dispose();
      const model = g.getObjectByName('remote-player-model');
      if (model) disposeObjectMaterials(model);
      this.ctx.scene.remove(g);
      this.otherPlayers.delete(id);
    }
    this.interpBuffers.delete(id);
    // Clean up sniper glint
    const glint = this.glintSprites.get(id);
    if (glint) {
      glint.material.dispose();
      this.ctx.scene.remove(glint);
      this.glintSprites.delete(id);
    }
  }

  /** Interpolate all remote players — call once per frame. */
  interpolateAll(delta = 0.016): void {
    this.glintTime += delta;
    const interpRot = { yaw: 0, pitch: 0 };
    const camPos = this.ctx.camera.position;
    const toPlayer = new THREE.Vector3();
    const lookDir = new THREE.Vector3();

    for (const [id, group] of this.otherPlayers) {
      const buffer = this.interpBuffers.get(id);
      if (buffer && buffer.hasData()) {
        buffer.sample(group.position, interpRot);
        group.rotation.y = interpRot.yaw;
      }

      // ── Sniper scope glint ──
      const weaponIdx = group.userData.currentWeapon as number;
      if (weaponIdx === SNIPER_WEAPON_INDEX) {
        // Vector from remote player's eye to local camera
        toPlayer.set(
          camPos.x - group.position.x,
          camPos.y - group.position.y,
          camPos.z - group.position.z,
        );
        const dist = toPlayer.length();

        if (dist > GLINT_MIN_DIST && dist < GLINT_MAX_DIST) {
          toPlayer.divideScalar(dist); // normalize

          // Remote player's look direction from yaw (they face -Z in local space)
          lookDir.set(-Math.sin(interpRot.yaw), 0, -Math.cos(interpRot.yaw));

          const dot = lookDir.dot(toPlayer);

          if (dot > GLINT_DOT_THRESHOLD) {
            // They're looking at us — show glint
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
            // Position at remote player's eye height
            sprite.position.set(
              group.position.x,
              group.position.y + 0.15,
              group.position.z,
            );
            // Scale grows with distance so it remains visible from afar
            const baseScale = 0.4 + dist * 0.012;
            sprite.scale.setScalar(baseScale * (0.8 + intensity * 0.4));
            sprite.material.opacity = Math.min(1, alpha * 1.2);
            sprite.visible = true;
            continue;
          }
        }
      }

      // Hide glint if not applicable
      const existingGlint = this.glintSprites.get(id);
      if (existingGlint) existingGlint.visible = false;
    }
  }

  /** Flush all interpolation buffers (used on map reset to prevent position sliding). */
  flushAllBuffers(): void {
    for (const buffer of this.interpBuffers.values()) {
      buffer.clear();
    }
  }

  /** Remove and dispose all tracked remote players. */
  destroyAll(): void {
    for (const id of Array.from(this.otherPlayers.keys())) this.removeOtherPlayer(id);
  }
}
