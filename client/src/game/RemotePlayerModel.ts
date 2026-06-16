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

export function getRemoteWeaponHoldPose(weaponIndex: number): RemoteWeaponHoldPose {
  switch (weaponIndex) {
    case 1:
      return {
        mountPosition: [0.35, -0.22, -0.48],
        mountRotation: [0.22, -0.08, -0.1],
        leftArmRotation: [1.04, 0.18, 0.46],
        rightArmRotation: [1.12, -0.16, -0.18],
      };
    case 2:
      return {
        mountPosition: [0.31, -0.19, -0.46],
        mountRotation: [0.12, -0.07, -0.03],
        leftArmRotation: [0.92, 0.1, 0.18],
        rightArmRotation: [1.0, -0.12, -0.1],
      };
    case 3:
      return {
        mountPosition: [0.34, -0.24, -0.53],
        mountRotation: [0.28, -0.1, -0.14],
        leftArmRotation: [1.14, 0.18, 0.5],
        rightArmRotation: [1.22, -0.16, -0.22],
      };
    case 4:
      return {
        mountPosition: [0.34, -0.23, -0.49],
        mountRotation: [0.24, -0.08, -0.1],
        leftArmRotation: [1.08, 0.16, 0.44],
        rightArmRotation: [1.16, -0.14, -0.18],
      };
    case 5:
      return {
        mountPosition: [0.36, -0.19, -0.62],
        mountRotation: [0.18, -0.05, -0.08],
        leftArmRotation: [1.0, 0.14, 0.36],
        rightArmRotation: [1.08, -0.12, -0.14],
      };
    default:
      return {
        mountPosition: [0.34, -0.21, -0.54],
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
 * Uniform scale applied to the whole remote-player rig so other players read
 * as larger / easier to spot during fast-paced play. The rig is built around
 * the same joint anchors the animator drives, so scaling the root model keeps
 * every animation correct — it just renders bigger. Feet stay planted at the
 * model origin, so the foot offset is unaffected.
 */
export const REMOTE_PLAYER_MODEL_SCALE = 1.18;

export function createRemotePlayerModel(presetValue: number): RemotePlayerRig {
  const preset = getCharacterPreset(presetValue);
  const model = new THREE.Group();
  model.scale.setScalar(REMOTE_PLAYER_MODEL_SCALE);

  // Material set — distinct shades give the silhouette depth under Lambert lighting.
  // Every decorative box below is deliberately kept PROUD of its parent surface
  // (never coplanar) so adjacent faces don't z-fight ("two things overlayed").
  const skinMat = new THREE.MeshLambertMaterial({ color: preset.headColor });
  const clothMat = new THREE.MeshLambertMaterial({ color: preset.bodyColor });
  const armorMat = new THREE.MeshLambertMaterial({ color: preset.vestColor });
  const helmetMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(preset.vestColor).multiplyScalar(1.2).getHex(),
  });
  const visorMat = new THREE.MeshLambertMaterial({
    color: preset.visorColor,
    emissive: preset.visorColor,
    emissiveIntensity: 0.55,
  });
  const accentMat = new THREE.MeshLambertMaterial({
    color: preset.accentColor,
    emissive: preset.accentColor,
    emissiveIntensity: 0.18,
  });
  const pantsMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(preset.bodyColor).multiplyScalar(0.62).getHex(),
  });
  const pouchMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(preset.vestColor).multiplyScalar(0.7).getHex(),
  });
  const bootMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(preset.vestColor).multiplyScalar(0.85).getHex(),
  });
  const gloveMat = new THREE.MeshLambertMaterial({ color: 0x14161f });

  const root = new THREE.Group();
  root.name = 'remote-player-root';
  model.add(root);

  // ---- Pelvis / hips ----
  addBox(root, [0.7, 0.3, 0.42], armorMat, [0, 0.95, 0]);
  addBox(root, [0.76, 0.12, 0.46], accentMat, [0, 1.07, 0]);        // belt (wider → proud sides)
  addBox(root, [0.16, 0.1, 0.14], accentMat, [0, 1.07, -0.27]);     // buckle, proud of belt front

  const upperBody = new THREE.Group();
  upperBody.position.set(0, 1.22, 0);
  root.add(upperBody);
  // ---- Torso: chest plate + abdomen ----
  addBox(upperBody, [0.84, 0.66, 0.46], armorMat, [0, 0.08, 0]);
  addBox(upperBody, [0.7, 0.2, 0.42], clothMat, [0, -0.3, 0]);
  // Collar / neck guard — protrudes forward of the chest face
  addBox(upperBody, [0.5, 0.14, 0.06], accentMat, [0, 0.36, -0.25]);
  // Sternum strap down the centre
  addBox(upperBody, [0.08, 0.4, 0.06], accentMat, [0, 0.06, -0.25]);
  // Vest pouches — clearly standing off the chest
  addBox(upperBody, [0.2, 0.22, 0.1], pouchMat, [-0.17, -0.04, -0.26]);
  addBox(upperBody, [0.2, 0.22, 0.1], pouchMat, [0.17, -0.04, -0.26]);
  // Chunky shoulder pads sitting above the arm sockets
  addBox(upperBody, [0.32, 0.2, 0.42], armorMat, [-0.46, 0.32, 0]);
  addBox(upperBody, [0.32, 0.2, 0.42], armorMat, [0.46, 0.32, 0]);
  // Neck linking chest to head
  addBox(upperBody, [0.28, 0.18, 0.28], skinMat, [0, 0.5, 0]);

  const head = new THREE.Group();
  head.position.set(0, 0.74, 0);
  upperBody.add(head);
  // Skull (skin) + jaw
  addBox(head, [0.6, 0.56, 0.58], skinMat, [0, 0.0, 0]);
  addBox(head, [0.48, 0.16, 0.5], skinMat, [0, -0.32, 0.02]);
  // Combat helmet: dome (wider than head → clean overhang) + forward peak
  addBox(head, [0.7, 0.32, 0.7], helmetMat, [0, 0.28, 0.01]);
  addBox(head, [0.66, 0.1, 0.2], helmetMat, [0, 0.1, -0.34]);       // brim peak over the eyes
  // Ear / side protection — protrudes past the head sides
  addBox(head, [0.12, 0.3, 0.42], armorMat, [-0.34, 0.04, 0.02]);
  addBox(head, [0.12, 0.3, 0.42], armorMat, [0.34, 0.04, 0.02]);
  // Single clean glowing visor band, sitting proud of the face (no overlapping eye boxes)
  addBox(head, [0.5, 0.16, 0.06], visorMat, [0, -0.02, -0.31]);
  // Breather / chin guard, proud of the jaw
  addBox(head, [0.22, 0.12, 0.1], accentMat, [0, -0.27, -0.22]);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.5, 0.28, 0.02);
  upperBody.add(leftArm);
  addBox(leftArm, [0.26, 0.42, 0.3], clothMat, [0, -0.22, 0]);      // upper arm
  addBox(leftArm, [0.24, 0.36, 0.26], armorMat, [0, -0.58, 0.02]);  // forearm guard
  addBox(leftArm, [0.2, 0.18, 0.24], gloveMat, [0, -0.8, 0.0]);     // glove

  const rightArm = new THREE.Group();
  rightArm.position.set(0.5, 0.28, 0.02);
  upperBody.add(rightArm);
  addBox(rightArm, [0.26, 0.42, 0.3], clothMat, [0, -0.22, 0]);
  addBox(rightArm, [0.24, 0.36, 0.26], armorMat, [0, -0.58, 0.02]);
  addBox(rightArm, [0.2, 0.18, 0.24], gloveMat, [0, -0.8, 0.0]);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.2, 0.96, 0);
  root.add(leftLeg);
  addBox(leftLeg, [0.32, 0.46, 0.36], pantsMat, [0, -0.24, 0]);     // thigh
  addBox(leftLeg, [0.28, 0.1, 0.12], accentMat, [0, -0.46, -0.2]);  // knee pad, proud of shin front
  addBox(leftLeg, [0.3, 0.42, 0.32], pantsMat, [0, -0.66, 0]);      // shin
  addBox(leftLeg, [0.36, 0.2, 0.5], bootMat, [0, -0.88, -0.05]);    // boot

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.2, 0.96, 0);
  root.add(rightLeg);
  addBox(rightLeg, [0.32, 0.46, 0.36], pantsMat, [0, -0.24, 0]);
  addBox(rightLeg, [0.28, 0.1, 0.12], accentMat, [0, -0.46, -0.2]);
  addBox(rightLeg, [0.3, 0.42, 0.32], pantsMat, [0, -0.66, 0]);
  addBox(rightLeg, [0.36, 0.2, 0.5], bootMat, [0, -0.88, -0.05]);

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
