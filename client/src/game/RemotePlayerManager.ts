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
  localIdentity: string | null;
}

// ── RemotePlayerManager ──

export class RemotePlayerManager {
  readonly otherPlayers: Map<string, THREE.Group> = new Map();
  readonly interpBuffers: Map<string, InterpolationBuffer> = new Map();
  private ctx: RemotePlayerContext;

  constructor(ctx: RemotePlayerContext) {
    this.ctx = ctx;
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

    // Background with rounded corners and gradient
    const bgX = 16, bgY = 6, bgW = w - 32, bgH = h - 12;
    const radius = 6;
    ctx2d.beginPath();
    ctx2d.moveTo(bgX + radius, bgY);
    ctx2d.lineTo(bgX + bgW - radius, bgY);
    ctx2d.quadraticCurveTo(bgX + bgW, bgY, bgX + bgW, bgY + radius);
    ctx2d.lineTo(bgX + bgW, bgY + bgH - radius);
    ctx2d.quadraticCurveTo(bgX + bgW, bgY + bgH, bgX + bgW - radius, bgY + bgH);
    ctx2d.lineTo(bgX + radius, bgY + bgH);
    ctx2d.quadraticCurveTo(bgX, bgY + bgH, bgX, bgY + bgH - radius);
    ctx2d.lineTo(bgX, bgY + radius);
    ctx2d.quadraticCurveTo(bgX, bgY, bgX + radius, bgY);
    ctx2d.closePath();

    // Dark background fill
    const bgGrad = ctx2d.createLinearGradient(bgX, bgY, bgX, bgY + bgH);
    bgGrad.addColorStop(0, 'rgba(6, 12, 22, 0.85)');
    bgGrad.addColorStop(1, 'rgba(4, 8, 16, 0.9)');
    ctx2d.fillStyle = bgGrad;
    ctx2d.fill();

    // Border
    ctx2d.strokeStyle = 'rgba(0, 255, 136, 0.45)';
    ctx2d.lineWidth = 2;
    ctx2d.stroke();

    // Top accent line
    ctx2d.beginPath();
    ctx2d.moveTo(bgX + 20, bgY);
    ctx2d.lineTo(bgX + bgW - 20, bgY);
    ctx2d.strokeStyle = 'rgba(0, 255, 136, 0.7)';
    ctx2d.lineWidth = 2;
    ctx2d.stroke();

    // Name text with shadow
    ctx2d.shadowColor = 'rgba(0, 255, 136, 0.5)';
    ctx2d.shadowBlur = 8;
    ctx2d.fillStyle = '#00ff99';
    ctx2d.font = 'bold 30px monospace';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(displayName, w / 2, h / 2);
    ctx2d.shadowBlur = 0;

    // Small corner brackets
    const cLen = 6;
    ctx2d.strokeStyle = 'rgba(0, 255, 136, 0.6)';
    ctx2d.lineWidth = 2;
    // Top-left
    ctx2d.beginPath(); ctx2d.moveTo(bgX + 4, bgY + 4 + cLen); ctx2d.lineTo(bgX + 4, bgY + 4); ctx2d.lineTo(bgX + 4 + cLen, bgY + 4); ctx2d.stroke();
    // Top-right
    ctx2d.beginPath(); ctx2d.moveTo(bgX + bgW - 4 - cLen, bgY + 4); ctx2d.lineTo(bgX + bgW - 4, bgY + 4); ctx2d.lineTo(bgX + bgW - 4, bgY + 4 + cLen); ctx2d.stroke();
    // Bottom-left
    ctx2d.beginPath(); ctx2d.moveTo(bgX + 4, bgY + bgH - 4 - cLen); ctx2d.lineTo(bgX + 4, bgY + bgH - 4); ctx2d.lineTo(bgX + 4 + cLen, bgY + bgH - 4); ctx2d.stroke();
    // Bottom-right
    ctx2d.beginPath(); ctx2d.moveTo(bgX + bgW - 4 - cLen, bgY + bgH - 4); ctx2d.lineTo(bgX + bgW - 4, bgY + bgH - 4); ctx2d.lineTo(bgX + bgW - 4, bgY + bgH - 4 - cLen); ctx2d.stroke();

    texture.needsUpdate = true;
  }

  // ── Player model creation ──

  private createRemotePlayerModel(presetValue: number): THREE.Group {
    const preset = getCharacterPreset(presetValue);
    const model = new THREE.Group();

    // Upgraded materials with roughness/metalness for a more solid, grounded look
    const bodyMat = new THREE.MeshStandardMaterial({ color: preset.bodyColor, roughness: 0.85, metalness: 0.05 });
    const vestMat = new THREE.MeshStandardMaterial({ color: preset.vestColor, roughness: 0.7, metalness: 0.1 });
    const headMat = new THREE.MeshStandardMaterial({ color: preset.headColor, roughness: 0.9, metalness: 0.0 });
    const visorMat = new THREE.MeshStandardMaterial({ color: preset.visorColor, emissive: preset.visorColor, emissiveIntensity: 0.4, roughness: 0.2, metalness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: preset.accentColor, emissive: preset.accentColor, emissiveIntensity: 0.15, roughness: 0.5, metalness: 0.3 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0.05 });
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.15 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: preset.vestColor, roughness: 0.6, metalness: 0.2 });

    const addBox = (
      size: [number, number, number],
      material: THREE.Material,
      position: [number, number, number],
      rotation: [number, number, number] = [0, 0, 0],
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      model.add(mesh);
      return mesh;
    };

    // ── BOOTS ──
    addBox([0.24, 0.16, 0.28], bootMat, [-0.16, 0.08, -0.02]);
    addBox([0.24, 0.16, 0.28], bootMat, [0.16, 0.08, -0.02]);

    // ── LEGS ──
    addBox([0.22, 0.48, 0.22], bodyMat, [-0.16, 0.40, 0]);
    addBox([0.22, 0.48, 0.22], bodyMat, [0.16, 0.40, 0]);

    // ── KNEE PADS ──
    addBox([0.14, 0.10, 0.06], vestMat, [-0.16, 0.38, -0.14]);
    addBox([0.14, 0.10, 0.06], vestMat, [0.16, 0.38, -0.14]);

    // ── WAIST / HIPS ──
    addBox([0.56, 0.34, 0.30], bodyMat, [0, 0.79, 0]);

    // ── BELT ──
    addBox([0.60, 0.08, 0.34], beltMat, [0, 0.94, 0]);
    // Belt pouches
    addBox([0.10, 0.10, 0.08], vestMat, [-0.24, 0.90, -0.18]);
    addBox([0.10, 0.10, 0.08], vestMat, [0.24, 0.90, -0.18]);
    addBox([0.12, 0.12, 0.06], vestMat, [0.30, 0.88, 0.0]);

    // ── UPPER TORSO ──
    addBox([0.62, 0.78, 0.34], bodyMat, [0, 1.34, 0]);

    // ── TACTICAL VEST ──
    addBox([0.68, 0.64, 0.38], vestMat, [0, 1.34, 0.01]);
    // Vest chest plate detail
    addBox([0.30, 0.22, 0.04], accentMat, [0, 1.42, -0.21]);
    // Shoulder straps
    addBox([0.08, 0.30, 0.18], vestMat, [-0.28, 1.52, 0.0]);
    addBox([0.08, 0.30, 0.18], vestMat, [0.28, 1.52, 0.0]);

    // ── SHOULDER PADS ──
    addBox([0.22, 0.12, 0.22], vestMat, [-0.38, 1.58, 0.0]);
    addBox([0.22, 0.12, 0.22], vestMat, [0.38, 1.58, 0.0]);
    // Shoulder pad accent stripe
    addBox([0.16, 0.04, 0.16], accentMat, [-0.38, 1.65, 0.0]);
    addBox([0.16, 0.04, 0.16], accentMat, [0.38, 1.65, 0.0]);

    // ── ARMS ──
    // Left arm (relaxed)
    addBox([0.18, 0.50, 0.18], bodyMat, [-0.40, 1.25, -0.02], [0.12, 0, 0.22]);
    addBox([0.16, 0.34, 0.16], bodyMat, [-0.37, 0.92, -0.12], [0.2, 0, 0.24]);
    // Left glove
    addBox([0.14, 0.10, 0.14], bootMat, [-0.34, 0.73, -0.18], [0.2, 0, 0.24]);

    // Right arm (holding weapon)
    addBox([0.18, 0.44, 0.18], bodyMat, [0.39, 1.35, 0.02], [-0.38, 0.12, -0.08]);
    addBox([0.16, 0.28, 0.16], bodyMat, [0.47, 1.09, -0.12], [-0.45, 0.1, -0.12]);
    // Right glove
    addBox([0.14, 0.10, 0.14], bootMat, [0.50, 0.95, -0.18], [-0.45, 0.1, -0.12]);

    // ── NECK ──
    addBox([0.18, 0.10, 0.18], headMat, [0, 1.76, 0]);

    // ── HEAD (HELMET) ──
    addBox([0.44, 0.44, 0.44], helmetMat, [0, 1.95, 0]);
    // Helmet brim/ridge
    addBox([0.48, 0.06, 0.48], helmetMat, [0, 2.10, 0]);
    // Face plate (slightly inset)
    addBox([0.34, 0.28, 0.04], headMat, [0, 1.92, -0.24]);

    // ── VISOR ──
    addBox([0.30, 0.12, 0.05], visorMat, [0, 1.98, -0.26]);
    // Visor side accents
    addBox([0.04, 0.08, 0.08], visorMat, [-0.19, 1.98, -0.22]);
    addBox([0.04, 0.08, 0.08], visorMat, [0.19, 1.98, -0.22]);

    // ── CHIN / MOUTH GUARD ──
    addBox([0.20, 0.08, 0.06], accentMat, [0, 1.85, -0.25]);
    // Breathing apparatus
    addBox([0.08, 0.08, 0.06], accentMat, [0, 1.88, -0.29]);

    // ── BACKPACK ──
    addBox([0.36, 0.46, 0.14], vestMat, [0, 1.24, 0.24]);
    // Backpack top flap
    addBox([0.32, 0.06, 0.12], vestMat, [0, 1.49, 0.24]);
    // Backpack accent stripe
    addBox([0.06, 0.30, 0.02], accentMat, [0, 1.24, 0.32]);
    // Antenna nub on backpack
    addBox([0.03, 0.14, 0.03], accentMat, [0.14, 1.56, 0.26]);

    // ── CHEST BADGE ──
    addBox([0.12, 0.06, 0.04], accentMat, [-0.14, 1.50, -0.20]);

    const gunMount = new THREE.Group();
    gunMount.name = 'remote-player-gun-mount';
    gunMount.position.set(0.5, 1.04, -0.17);
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

    const gunMat = new THREE.MeshStandardMaterial({ color: mainColor, roughness: 0.6, metalness: 0.3 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: preset.gunColor, roughness: 0.5, metalness: 0.4 });
    const detailMat = new THREE.MeshStandardMaterial({ color: preset.accentColor, emissive: preset.accentColor, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.3 });

    const add = (size: [number, number, number], material: THREE.Material, pos: [number, number, number]): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      gun.add(mesh);
    };

    if (idx === 1) {
      add([0.13, 0.12, 0.44], bodyMat, [0, 0, -0.03]);
      add([0.1, 0.09, 0.24], gunMat, [0, 0, 0.3]);
      add([0.06, 0.06, 0.36], detailMat, [0, -0.09, -0.18]);
      add([0.07, 0.16, 0.07], bodyMat, [0, -0.12, 0.02]);
    } else if (idx === 2) {
      add([0.17, 0.17, 0.58], bodyMat, [0, 0, -0.07]);
      add([0.1, 0.1, 0.18], gunMat, [0, 0, 0.36]);
      add([0.08, 0.08, 0.09], detailMat, [0, 0, -0.42]);
      add([0.08, 0.18, 0.08], gunMat, [0, -0.13, 0.06]);
    } else if (idx === 3) {
      add([0.12, 0.11, 0.52], bodyMat, [0, 0, -0.08]);
      add([0.07, 0.07, 0.26], detailMat, [0, 0.09, -0.18]);
      add([0.1, 0.1, 0.2], gunMat, [0, 0, 0.28]);
      add([0.09, 0.22, 0.1], gunMat, [0, -0.16, 0]);
    } else if (idx === 4) {
      add([0.14, 0.13, 0.48], bodyMat, [0, 0, -0.03]);
      add([0.12, 0.12, 0.2], gunMat, [0, 0, 0.27]);
      add([0.12, 0.12, 0.12], detailMat, [0, -0.11, 0.08]);
      add([0.07, 0.17, 0.07], bodyMat, [0, -0.13, 0]);
    } else {
      add([0.11, 0.1, 0.5], bodyMat, [0, 0, -0.08]);
      add([0.05, 0.05, 0.5], detailMat, [0, 0, -0.35]);
      add([0.08, 0.08, 0.2], gunMat, [0, 0, 0.27]);
      add([0.06, 0.16, 0.07], gunMat, [0, -0.12, 0.03]);
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
      sprite.position.y = 2.45; sprite.scale.set(2.4, 0.6, 1);
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
  }

  /** Interpolate all remote players — call once per frame. */
  interpolateAll(): void {
    const interpRot = { yaw: 0, pitch: 0 };
    for (const [id, group] of this.otherPlayers) {
      const buffer = this.interpBuffers.get(id);
      if (buffer && buffer.hasData()) {
        buffer.sample(group.position, interpRot);
        group.rotation.y = interpRot.yaw;
      }
    }
  }

  /** Remove and dispose all tracked remote players. */
  destroyAll(): void {
    for (const id of Array.from(this.otherPlayers.keys())) this.removeOtherPlayer(id);
  }
}
