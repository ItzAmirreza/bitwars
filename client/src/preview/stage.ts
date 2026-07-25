/**
 * Offline render stage for the design preview harness.
 *
 * Lays subjects out in a grid, auto-frames each one from its bounding box, and
 * renders every cell into a single canvas. One canvas means one screenshot, so
 * a whole set of variants or camera angles costs one round trip instead of N.
 *
 * Lighting and the renderer colour profile come from `game/lightingRig`, so what
 * shows up here is what the game renders.
 */

import * as THREE from 'three';
import {
  applyRendererProfile,
  createLightRig,
  CLEAR_COLOR,
} from '../game/lightingRig';

export type ViewName = 'front' | 'back' | 'side' | 'threequarter' | 'top';

/** Camera direction per named view, in units of the subject's bounding radius. */
const VIEW_DIRECTIONS: Record<ViewName, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.15, 1),
  back: new THREE.Vector3(0, 0.15, -1),
  side: new THREE.Vector3(1, 0.15, 0),
  threequarter: new THREE.Vector3(0.85, 0.45, 0.95),
  top: new THREE.Vector3(0.001, 1, 0.001),
};

export interface StageCell {
  /** Drawn under the cell so shots are self-describing. */
  label: string;
  object: THREE.Object3D;
  /** Overrides the grid-wide view for this cell. */
  view?: ViewName;
  /** Extra orbit around Y applied after the view direction, in degrees. */
  yaw?: number;
  /** <1 pulls the camera in (subject fills more of the cell). */
  zoom?: number;
  /** Draw a ground plane for this cell so shadows have somewhere to land. */
  ground?: boolean;
  /**
   * Render through the first-person weapon-overlay camera instead of
   * auto-framing: 70° FOV at the origin looking down -Z, exactly what
   * `WeaponModel` uses. The object is expected to be pre-positioned at its
   * view-space anchor. Adds a centre reticle so sight alignment is checkable.
   */
  fpv?: boolean;
}

/** Matches the overlay camera in `WeaponModel`. */
const FPV_FOV = 70;

export interface StageOptions {
  cells: StageCell[];
  cellSize: number;
  cols: number;
  view: ViewName;
  /** Sun-relative backdrop colour; defaults to the game's clear colour. */
  background?: number;
  showGround: boolean;
}

/** Ground plate size as a multiple of the subject's bounding radius. */
const GROUND_RADIUS_SCALE = 5;

function frameCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  view: ViewName,
  yawDeg: number,
  zoom: number,
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    camera.position.set(2, 2, 2);
    camera.lookAt(0, 0, 0);
    return;
  }

  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dir = VIEW_DIRECTIONS[view].clone().normalize();
  if (yawDeg !== 0) {
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (yawDeg * Math.PI) / 180);
  }

  // Fit the bounding sphere to the *narrower* of the two FOVs so nothing is
  // clipped when the cell is not square.
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const fitDist = sphere.radius / Math.sin(Math.min(vFov, hFov) / 2);

  camera.position.copy(sphere.center).addScaledVector(dir, fitDist * zoom);
  camera.near = Math.max(0.01, fitDist * 0.01);
  camera.far = fitDist * 12 + sphere.radius * 4;
  camera.updateProjectionMatrix();
  camera.lookAt(sphere.center);
}

export interface RenderedStage {
  container: HTMLDivElement;
  width: number;
  height: number;
}

export function renderStage(opts: StageOptions): RenderedStage {
  const { cells, cellSize, cols, view, showGround } = opts;
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const width = cellSize * Math.min(cols, cells.length);
  const height = cellSize * rows;

  const container = document.createElement('div');
  container.id = 'preview-stage';
  container.style.cssText =
    `position:relative;width:${width}px;height:${height}px;background:#${(opts.background ?? CLEAR_COLOR).toString(16).padStart(6, '0')};`;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  applyRendererProfile(renderer);
  renderer.setSize(width, height);
  renderer.setScissorTest(true);
  if (opts.background !== undefined) renderer.setClearColor(opts.background);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  createLightRig(scene, 24);

  // Sized per cell from the subject's radius — a fixed huge plate swamps small
  // subjects and reads as a backdrop instead of a floor.
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: 0x4a4a50, shininess: 0 }),
  );
  ground.receiveShadow = true;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 500);
  const scratchBox = new THREE.Box3();
  const scratchSphere = new THREE.Sphere();

  cells.forEach((cell, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // WebGL's viewport origin is bottom-left; the grid reads top-left.
    const x = col * cellSize;
    const y = height - (row + 1) * cellSize;

    scene.add(cell.object);
    const wantsGround = cell.ground ?? showGround;
    if (wantsGround) {
      scratchBox.setFromObject(cell.object);
      scratchBox.getBoundingSphere(scratchSphere);
      const plate = Math.max(2, scratchSphere.radius * GROUND_RADIUS_SCALE);
      ground.scale.set(plate, 1, plate);
      ground.position.set(scratchSphere.center.x, scratchBox.min.y - 0.5, scratchSphere.center.z);
      scene.add(ground);
    }

    camera.aspect = 1;
    if (cell.fpv) {
      camera.fov = FPV_FOV;
      camera.near = 0.01;
      camera.far = 10;
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
      camera.updateProjectionMatrix();
    } else {
      camera.fov = 38;
      frameCamera(camera, cell.object, cell.view ?? view, cell.yaw ?? 0, cell.zoom ?? 1);
    }

    renderer.setViewport(x, y, cellSize, cellSize);
    renderer.setScissor(x, y, cellSize, cellSize);
    renderer.render(scene, camera);

    scene.remove(cell.object);
    if (wantsGround) scene.remove(ground);

    if (cell.fpv) {
      // Screen-centre reticle: the sights must sit on this when fully aimed.
      const reticle = document.createElement('div');
      reticle.style.cssText =
        `position:absolute;left:${x + cellSize / 2 - 11}px;top:${row * cellSize + cellSize / 2 - 11}px;`
        + 'width:22px;height:22px;pointer-events:none;'
        + 'background:linear-gradient(#f0405a,#f0405a) center/2px 22px no-repeat,'
        + 'linear-gradient(#f0405a,#f0405a) center/22px 2px no-repeat;';
      container.appendChild(reticle);
    }

    const tag = document.createElement('div');
    tag.textContent = cell.label;
    tag.style.cssText =
      `position:absolute;left:${x}px;top:${row * cellSize}px;width:${cellSize}px;` +
      'padding:6px 8px;font:600 13px ui-monospace,Menlo,monospace;color:#e8e8ec;' +
      'text-shadow:0 1px 0 #000;pointer-events:none;';
    container.appendChild(tag);
  });

  return { container, width, height };
}
