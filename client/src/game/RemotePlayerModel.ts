import * as THREE from 'three';
import { WEAPONS } from './Weapons';
import { getCharacterPreset } from '../characterPresets';

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

export interface RemotePlayerRig {
  model: THREE.Group;
  root: THREE.Group;
  upperBody: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  gunMount: THREE.Group;
}

export interface RemoteWeaponHoldPose {
  mountPosition: [number, number, number];
  mountRotation: [number, number, number];
  leftArmRotation: [number, number, number];
  rightArmRotation: [number, number, number];
}

// Mount positions are in upper-body-local space. The rig now uses true
// Minecraft proportions where the arms pivot at the shoulder (top of the
// torso), so the hands sit high and forward when aiming — the gun mount is
// placed to land in those hands.
export function getRemoteWeaponHoldPose(weaponIndex: number): RemoteWeaponHoldPose {
  switch (weaponIndex) {
    case 1:
      return {
        mountPosition: [0.35, 0.69, -0.9],
        mountRotation: [0.22, -0.08, -0.1],
        leftArmRotation: [1.04, 0.18, 0.46],
        rightArmRotation: [1.12, -0.16, -0.18],
      };
    case 2:
      return {
        mountPosition: [0.31, 0.72, -0.88],
        mountRotation: [0.12, -0.07, -0.03],
        leftArmRotation: [0.92, 0.1, 0.18],
        rightArmRotation: [1.0, -0.12, -0.1],
      };
    case 3:
      return {
        mountPosition: [0.34, 0.67, -0.95],
        mountRotation: [0.28, -0.1, -0.14],
        leftArmRotation: [1.14, 0.18, 0.5],
        rightArmRotation: [1.22, -0.16, -0.22],
      };
    case 4:
      return {
        mountPosition: [0.34, 0.68, -0.91],
        mountRotation: [0.24, -0.08, -0.1],
        leftArmRotation: [1.08, 0.16, 0.44],
        rightArmRotation: [1.16, -0.14, -0.18],
      };
    case 5:
      return {
        mountPosition: [0.36, 0.72, -1.04],
        mountRotation: [0.18, -0.05, -0.08],
        leftArmRotation: [1.0, 0.14, 0.36],
        rightArmRotation: [1.08, -0.12, -0.14],
      };
    default:
      return {
        mountPosition: [0.34, 0.7, -0.96],
        mountRotation: [0.24, -0.09, -0.12],
        leftArmRotation: [1.08, 0.18, 0.42],
        rightArmRotation: [1.16, -0.14, -0.2],
      };
  }
}

export function normalizeWeaponIndex(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const idx = Math.floor(value);
  if (idx < 0 || idx >= WEAPONS.length) return 0;
  return idx;
}

export function drawNametag(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  username: string,
): void {
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.imageSmoothingEnabled = false;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  ctx2d.lineJoin = 'round';
  ctx2d.miterLimit = 2;

  const trimmed = username.trim();
  const displayName = (trimmed.length > 16 ? `${trimmed.slice(0, 16)}…` : trimmed || 'PLAYER').toUpperCase();

  // Auto-fit the pixel font to the available width so long names stay on one line.
  const maxTextW = w - h * 0.9;
  let fontSize = Math.round(h * 0.4);
  for (; fontSize > 12; fontSize -= 2) {
    ctx2d.font = `${fontSize}px "Press Start 2P", monospace`;
    if (ctx2d.measureText(displayName).width <= maxTextW) break;
  }

  const textW = ctx2d.measureText(displayName).width;
  const plateH = Math.round(fontSize * 1.7);
  const plateW = Math.min(w - 8, textW + fontSize * 1.6);
  const plateX = Math.round((w - plateW) / 2);
  const plateY = Math.round((h - plateH) / 2);
  const cx = w / 2;
  const cy = h / 2 + Math.round(fontSize * 0.04);

  // Clean dark plate — hard square corners, design-compliant (no blur, no radius).
  ctx2d.fillStyle = 'rgba(8, 11, 18, 0.72)';
  ctx2d.fillRect(plateX, plateY, plateW, plateH);
  // Hard border.
  ctx2d.strokeStyle = 'rgba(20, 26, 38, 1)';
  ctx2d.lineWidth = Math.max(4, Math.round(h * 0.03));
  ctx2d.strokeRect(
    plateX + ctx2d.lineWidth / 2,
    plateY + ctx2d.lineWidth / 2,
    plateW - ctx2d.lineWidth,
    plateH - ctx2d.lineWidth,
  );
  // Lime accent strip along the top edge for identity.
  ctx2d.fillStyle = '#76ff03';
  ctx2d.fillRect(plateX, plateY, plateW, Math.max(3, Math.round(h * 0.025)));

  // Name: thick black outline for readability against any backdrop, lime fill.
  ctx2d.font = `${fontSize}px "Press Start 2P", monospace`;
  ctx2d.strokeStyle = '#000000';
  ctx2d.lineWidth = Math.max(4, Math.round(fontSize * 0.36));
  ctx2d.strokeText(displayName, cx, cy);
  ctx2d.fillStyle = '#caffa0';
  ctx2d.fillText(displayName, cx, cy);

  texture.needsUpdate = true;
}

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  material: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * The rig is authored at true world scale — its geometry is exactly 3 blocks
 * tall (feet at the model origin, head crown at y = 3). Keeping the scale at 1
 * means the model reads as the same size at every distance (no arbitrary
 * multiplier that made it look 3 blocks far away but ~2 up close).
 */
export const REMOTE_PLAYER_MODEL_SCALE = 1.0;

/**
 * Builds a clean, Minecraft-proportioned soldier — balanced thirds:
 *   legs  0.000 → 1.125   (37.5%)
 *   torso 1.125 → 2.250   (37.5%)
 *   head  2.250 → 3.000   (25%)
 * -Z is forward (the face side). Decorative boxes are kept proud of (never
 * coplanar with) the surface beneath them so adjacent faces never z-fight.
 */
export function createRemotePlayerModel(presetValue: number): RemotePlayerRig {
  const preset = getCharacterPreset(presetValue);
  const model = new THREE.Group();
  model.scale.setScalar(REMOTE_PLAYER_MODEL_SCALE);

  // Material set — flat, saturated voxel colours that read clearly in 3D.
  const skinMat = new THREE.MeshLambertMaterial({ color: preset.headColor });
  const shirtMat = new THREE.MeshLambertMaterial({ color: preset.bodyColor });
  const pantsMat = new THREE.MeshLambertMaterial({ color: preset.vestColor });
  const hairMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(preset.gunColor).multiplyScalar(0.9).getHex(),
  });
  const bootMat = new THREE.MeshLambertMaterial({ color: 0x14161c });
  const accentMat = new THREE.MeshLambertMaterial({
    color: preset.accentColor,
    emissive: preset.accentColor,
    emissiveIntensity: 0.16,
  });
  const eyeWhiteMat = new THREE.MeshLambertMaterial({ color: 0xeef1ff });
  const eyeMat = new THREE.MeshLambertMaterial({
    color: preset.visorColor,
    emissive: preset.visorColor,
    emissiveIntensity: 0.5,
  });

  const root = new THREE.Group();
  root.name = 'remote-player-root';
  model.add(root);

  // ---- Torso (pivots at the waist, y = 1.125) ----
  const upperBody = new THREE.Group();
  upperBody.position.set(0, 1.125, 0);
  root.add(upperBody);
  addBox(upperBody, [0.75, 1.125, 0.4], shirtMat, [0, 0.5625, 0]);     // chest + abdomen
  addBox(upperBody, [0.8, 0.16, 0.44], accentMat, [0, 0.06, 0]);       // belt (proud sides)
  addBox(upperBody, [0.12, 0.78, 0.05], accentMat, [0, 0.6, -0.215]);  // front zip strip (proud of chest)
  addBox(upperBody, [0.46, 0.14, 0.06], skinMat, [0, 1.05, -0.2]);     // collar / neck base

  // ---- Head (pivots at the neck, top of torso) ----
  const head = new THREE.Group();
  head.position.set(0, 1.125, 0);
  upperBody.add(head);
  addBox(head, [0.75, 0.75, 0.75], skinMat, [0, 0.375, 0]);            // skull / face
  // Hair cap — wider & set back so the lower front stays skin (a real face).
  addBox(head, [0.81, 0.5, 0.81], hairMat, [0, 0.55, 0.04]);
  // Eyes: whites + glowing iris (per-player identity colour), proud of the face.
  addBox(head, [0.15, 0.16, 0.05], eyeWhiteMat, [-0.16, 0.42, -0.39]);
  addBox(head, [0.15, 0.16, 0.05], eyeWhiteMat, [0.16, 0.42, -0.39]);
  addBox(head, [0.08, 0.1, 0.05], eyeMat, [-0.17, 0.42, -0.41]);
  addBox(head, [0.08, 0.1, 0.05], eyeMat, [0.17, 0.42, -0.41]);
  addBox(head, [0.26, 0.05, 0.05], hairMat, [0, 0.21, -0.39]);        // mouth line

  // ---- Arms (pivot at the shoulders, top of torso) ----
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.5625, 1.125, 0);
  upperBody.add(leftArm);
  addBox(leftArm, [0.375, 0.78, 0.375], shirtMat, [0, -0.39, 0]);      // sleeve
  addBox(leftArm, [0.375, 0.36, 0.375], skinMat, [0, -0.96, 0]);       // forearm / hand

  const rightArm = new THREE.Group();
  rightArm.position.set(0.5625, 1.125, 0);
  upperBody.add(rightArm);
  addBox(rightArm, [0.375, 0.78, 0.375], shirtMat, [0, -0.39, 0]);
  addBox(rightArm, [0.375, 0.36, 0.375], skinMat, [0, -0.96, 0]);

  // ---- Legs (pivot at the hips, y = 1.125) ----
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.1875, 1.125, 0);
  root.add(leftLeg);
  addBox(leftLeg, [0.375, 0.95, 0.375], pantsMat, [0, -0.475, 0]);     // leg
  addBox(leftLeg, [0.4, 0.18, 0.46], bootMat, [0, -1.04, -0.04]);      // boot (proud, toe forward)

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.1875, 1.125, 0);
  root.add(rightLeg);
  addBox(rightLeg, [0.375, 0.95, 0.375], pantsMat, [0, -0.475, 0]);
  addBox(rightLeg, [0.4, 0.18, 0.46], bootMat, [0, -1.04, -0.04]);

  const gunMount = new THREE.Group();
  const defaultHoldPose = getRemoteWeaponHoldPose(0);
  gunMount.name = 'remote-player-gun-mount';
  gunMount.position.set(...defaultHoldPose.mountPosition);
  gunMount.rotation.set(...defaultHoldPose.mountRotation);
  upperBody.add(gunMount);

  return {
    model,
    root,
    upperBody,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    gunMount,
  };
}

export function createRemoteWeaponModel(weaponIndex: number, presetValue: number): THREE.Group {
  const preset = getCharacterPreset(presetValue);
  const idx = normalizeWeaponIndex(weaponIndex);
  const parsed = Number.parseInt(WEAPONS[idx]?.color.replace('#', ''), 16);
  const mainColor = Number.isFinite(parsed) ? parsed : preset.gunColor;

  const gun = new THREE.Group();
  gun.name = 'remote-player-gun';

  const gunMat = new THREE.MeshLambertMaterial({ color: mainColor });
  const bodyMat = new THREE.MeshLambertMaterial({ color: preset.gunColor });
  const detailMat = new THREE.MeshLambertMaterial({
    color: preset.accentColor,
    emissive: preset.accentColor,
    emissiveIntensity: 0.25,
  });

  const add = (
    size: [number, number, number],
    material: THREE.Material,
    pos: [number, number, number],
  ): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    gun.add(mesh);
  };

  if (idx === 1) {
    add([0.12, 0.1, 0.48], bodyMat, [0, 0, -0.02]);
    add([0.06, 0.06, 0.34], gunMat, [0, 0, -0.36]);
    add([0.1, 0.02, 0.08], detailMat, [0, 0.06, -0.14]);
  } else if (idx === 2) {
    add([0.14, 0.14, 0.56], bodyMat, [0, 0, -0.08]);
    add([0.16, 0.16, 0.08], gunMat, [0, 0, -0.4]);
    add([0.08, 0.08, 0.08], detailMat, [0, 0, -0.48]);
  } else if (idx === 3) {
    add([0.12, 0.1, 0.44], bodyMat, [0, 0, 0]);
    add([0.06, 0.06, 0.38], gunMat, [0, 0.01, -0.34]);
    add([0.12, 0.02, 0.14], detailMat, [0, 0.06, 0.02]);
  } else if (idx === 4) {
    add([0.14, 0.14, 0.44], bodyMat, [0, 0, -0.06]);
    add([0.14, 0.12, 0.12], gunMat, [0, 0, 0.2]);
    add([0.09, 0.09, 0.09], detailMat, [0, -0.1, 0.08]);
  } else {
    add([0.1, 0.09, 0.34], bodyMat, [0, 0, 0]);
    add([0.05, 0.05, 0.34], gunMat, [0, 0, -0.31]);
    add([0.08, 0.02, 0.12], detailMat, [0, 0.05, -0.08]);
  }

  return gun;
}

export function setRemoteWeaponModel(
  group: THREE.Group,
  weaponIndex: number,
  presetValue: number,
): void {
  const mount = group.getObjectByName('remote-player-gun-mount');
  if (!(mount instanceof THREE.Group)) return;

  const existingGun = mount.getObjectByName('remote-player-gun');
  if (existingGun) {
    mount.remove(existingGun);
    disposeObjectMaterials(existingGun);
  }

  mount.add(createRemoteWeaponModel(weaponIndex, presetValue));
}
