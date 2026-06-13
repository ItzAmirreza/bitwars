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
  const displayName = username.length > 16 ? `${username.slice(0, 16)}...` : username;
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.imageSmoothingEnabled = false;

  const bgX = 16;
  const bgY = 6;
  const bgW = w - 32;
  const bgH = h - 12;
  ctx2d.fillStyle = 'rgba(6, 12, 22, 0.9)';
  ctx2d.fillRect(bgX, bgY, bgW, bgH);

  ctx2d.strokeStyle = '#76ff03';
  ctx2d.lineWidth = 3;
  ctx2d.strokeRect(bgX, bgY, bgW, bgH);

  ctx2d.font = 'bold 24px "Press Start 2P", monospace';
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  ctx2d.fillStyle = '#000000';
  ctx2d.fillText(displayName, w / 2 + 2, h / 2 + 2);
  ctx2d.fillStyle = '#76ff03';
  ctx2d.fillText(displayName, w / 2, h / 2);

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

export function createRemotePlayerModel(presetValue: number): RemotePlayerRig {
  const preset = getCharacterPreset(presetValue);
  const model = new THREE.Group();

  const bodyMat = new THREE.MeshLambertMaterial({ color: preset.bodyColor });
  const vestMat = new THREE.MeshLambertMaterial({ color: preset.vestColor });
  const headMat = new THREE.MeshLambertMaterial({ color: preset.headColor });
  const visorMat = new THREE.MeshLambertMaterial({
    color: preset.visorColor,
    emissive: preset.visorColor,
    emissiveIntensity: 0.45,
  });
  const accentMat = new THREE.MeshLambertMaterial({
    color: preset.accentColor,
    emissive: preset.accentColor,
    emissiveIntensity: 0.2,
  });
  const legMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(preset.bodyColor).multiplyScalar(0.68).getHex(),
  });
  const bootMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(preset.vestColor).multiplyScalar(0.82).getHex(),
  });

  const root = new THREE.Group();
  root.name = 'remote-player-root';
  model.add(root);

  addBox(root, [0.68, 0.2, 0.34], vestMat, [0, 0.96, 0]);
  addBox(root, [0.58, 0.08, 0.34], accentMat, [0, 1.04, 0]);

  const upperBody = new THREE.Group();
  upperBody.position.set(0, 1.22, 0);
  root.add(upperBody);
  addBox(upperBody, [0.82, 0.82, 0.4], vestMat, [0, 0, 0]);
  addBox(upperBody, [0.88, 0.16, 0.44], accentMat, [0, 0.12, 0.02]);
  addBox(upperBody, [0.74, 0.16, 0.34], bodyMat, [0, -0.32, 0]);
  addBox(upperBody, [0.22, 0.18, 0.24], bodyMat, [-0.44, 0.24, 0]);
  addBox(upperBody, [0.22, 0.18, 0.24], bodyMat, [0.44, 0.24, 0]);

  const head = new THREE.Group();
  head.position.set(0, 0.72, 0);
  upperBody.add(head);
  addBox(head, [0.58, 0.58, 0.58], headMat, [0, 0, 0]);
  addBox(head, [0.64, 0.12, 0.64], bodyMat, [0, 0.27, 0]);
  addBox(head, [0.5, 0.18, 0.08], visorMat, [0, 0.04, -0.29]);
  addBox(head, [0.34, 0.06, 0.08], accentMat, [0, -0.14, -0.29]);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.48, 0.24, 0.02);
  upperBody.add(leftArm);
  addBox(leftArm, [0.28, 0.16, 0.28], bodyMat, [0, -0.02, 0]);
  addBox(leftArm, [0.26, 0.42, 0.26], bodyMat, [0, -0.3, 0]);
  addBox(leftArm, [0.24, 0.34, 0.24], vestMat, [0, -0.66, 0.02]);
  addBox(leftArm, [0.16, 0.16, 0.2], headMat, [0, -0.9, -0.02]);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.48, 0.24, 0.02);
  upperBody.add(rightArm);
  addBox(rightArm, [0.28, 0.16, 0.28], bodyMat, [0, -0.02, 0]);
  addBox(rightArm, [0.26, 0.42, 0.26], bodyMat, [0, -0.3, 0]);
  addBox(rightArm, [0.24, 0.34, 0.24], vestMat, [0, -0.66, 0.02]);
  addBox(rightArm, [0.16, 0.16, 0.2], headMat, [0, -0.9, -0.02]);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.21, 0.96, 0);
  root.add(leftLeg);
  addBox(leftLeg, [0.3, 0.46, 0.3], legMat, [0, -0.23, 0]);
  addBox(leftLeg, [0.28, 0.42, 0.28], legMat, [0, -0.66, 0]);
  addBox(leftLeg, [0.34, 0.16, 0.42], bootMat, [0, -0.87, -0.02]);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.21, 0.96, 0);
  root.add(rightLeg);
  addBox(rightLeg, [0.3, 0.46, 0.3], legMat, [0, -0.23, 0]);
  addBox(rightLeg, [0.28, 0.42, 0.28], legMat, [0, -0.66, 0]);
  addBox(rightLeg, [0.34, 0.16, 0.42], bootMat, [0, -0.87, -0.02]);

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
