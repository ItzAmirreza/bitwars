import * as THREE from 'three';

export interface ProjectileRenderable {
  root: THREE.Group;
  shell: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  core: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
}

const PROJECTILE_BOX_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const WHITE = new THREE.Color(0xffffff);

export function createProjectileRenderable(
  size: number,
  colorHex: number,
): ProjectileRenderable {
  const baseColor = new THREE.Color(colorHex);
  const shellColor = baseColor.clone().lerp(WHITE, 0.12);
  const coreColor = baseColor.clone().lerp(WHITE, 0.58);

  const shell = new THREE.Mesh(
    PROJECTILE_BOX_GEOMETRY,
    new THREE.MeshBasicMaterial({
      color: shellColor,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
  const core = new THREE.Mesh(
    PROJECTILE_BOX_GEOMETRY,
    new THREE.MeshBasicMaterial({ color: coreColor }),
  );

  shell.renderOrder = 2;
  core.renderOrder = 3;

  const root = new THREE.Group();
  root.add(shell);
  root.add(core);

  const renderable = { root, shell, core };
  updateProjectileRenderable(renderable, size, 0);
  return renderable;
}

export function updateProjectileRenderable(
  renderable: ProjectileRenderable,
  size: number,
  motionStretch: number,
): void {
  const stretch = THREE.MathUtils.clamp(motionStretch, 0, 1);

  renderable.shell.scale.set(
    size * 1.12,
    size * 1.12,
    size * (1.15 + stretch * 0.55),
  );
  renderable.core.scale.set(
    size * 0.52,
    size * 0.52,
    size * (0.85 + stretch * 0.3),
  );
}

export function disposeProjectileRenderable(renderable: ProjectileRenderable): void {
  renderable.root.removeFromParent();
  renderable.shell.material.dispose();
  renderable.core.material.dispose();
}
