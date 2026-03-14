import * as THREE from 'three';
import { InterpolationBuffer } from './InterpolationBuffer';
import { BlockType } from './VoxelWorld';
import type { DynamicLightOptions } from './Engine';
import type { DbConnection } from '../module_bindings';
import type { AudioSystem } from './AudioSystem';
import type { VFX } from './VFX';
import type { FPSControls } from './FPSControls';
import type { VoxelWorld } from './VoxelWorld';
import type { PhysicsSystem } from './PhysicsSystem';
import type { SkySystem } from './SkySystem';

// ── Constants ──
const ENTITY_KIND_VEHICLE = 2;
const VEHICLE_TYPE_HELICOPTER = 0;
const VEHICLE_INPUT_INTERVAL_MS = 16;
const HELI_CAMERA_DISTANCE = 14;
const HELI_CAMERA_HEIGHT = 5.2;
const HELI_PILOT_PITCH_MIN = -0.62;
const HELI_PILOT_PITCH_MAX = 0.42;
const HELI_MOUNT_RANGE = 8.5;
const HELI_BREAKUP_GRAVITY = 22;

// Vehicle weapon definitions (client-side mirror of server VEHICLE_WEAPON_DEFS)
interface VehicleWeaponInfo {
  name: string;
  fireRate: number;
  maxAmmo: number;
  maxRange: number;
  projectileSpeed: number;
  gravity: number;
  radius: number;
  spread: { x: number; y: number };
  color: string;
  reloadTime: number;
}

export const VEHICLE_WEAPONS: VehicleWeaponInfo[] = [
  { name: 'MINIGUN', fireRate: 15.0, maxAmmo: 300, maxRange: 100, projectileSpeed: 0, gravity: 0, radius: 0, spread: { x: 0.035, y: 0.02 }, color: '#ffaa00', reloadTime: 3.0 },
  { name: 'ROCKETS', fireRate: 2.5, maxAmmo: 16, maxRange: 120, projectileSpeed: 80, gravity: 3.0, radius: 6.0, spread: { x: 0, y: 0 }, color: '#ff4400', reloadTime: 2.5 },
];

export const HELI_HEALTH_MAX = 1000;

type HelicopterBreakupPiece = {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  ttl: number;
};

/** Interface exposing only the Engine members the HelicopterManager needs. */
export interface HelicopterEngineContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  conn: DbConnection | null;
  localIdentity: string | null;
  controls: FPSControls;
  audio: AudioSystem;
  vfx: VFX;
  world: VoxelWorld;
  physics: PhysicsSystem;
  sky: SkySystem;
  health: number;
  elapsedTime: number;
  mountedVehicleId: number;
  addDynamicLight(options: DynamicLightOptions): string;
  removeDynamicLight(id: string): void;
  updateDynamicLight(id: string, patch: Partial<DynamicLightOptions>): void;
  applyExplosionCameraEffects(cx: number, cy: number, cz: number, radius: number, damage: number): void;
  disposeObjectMaterials(root: THREE.Object3D): void;
}

export default class HelicopterManager {
  // ── Helicopter entity maps ──
  readonly helicopters = new Map<number, THREE.Group>();
  readonly helicopterBuffers = new Map<number, InterpolationBuffer>();
  helicopterBreakupPieces: HelicopterBreakupPiece[] = [];
  private pendingHelicopterDestroyFallbacks = new Map<number, number>();
  private recentHelicopterBreakups = new Map<number, number>();
  suppressHelicopterDeleteFxUntil = 0;
  lastHelicopterSyncAt = 0;

  // ── Local pilot smooth chase state ──
  private localHeliSmoothedPos = new THREE.Vector3();
  private localHeliSmoothedYaw = 0;
  private localHeliSmoothedPitch = 0;
  private localHeliSmoothedInitialized = false;
  localHeliLastServerPos = new THREE.Vector3();
  localHeliLastServerVel = new THREE.Vector3();
  localHeliLastServerYaw = 0;
  localHeliLastServerPitch = 0;
  localHeliLastServerTime = 0;

  // ── Mounted camera state ──
  private mountedCameraPosition = new THREE.Vector3();
  private mountedCameraInitialized = false;

  // ── Vehicle pilot input state ──
  vehiclePilotYaw = 0;
  vehiclePilotPitch = 0;
  vehicleWeaponIndex = 0;
  lastVehicleFireAt = 0;
  vehicleAmmo: [number, number] = [300, 16];
  vehicleReloadingUntil: [number, number] = [0, 0];
  vehicleCameraDistance = HELI_CAMERA_DISTANCE;

  private lastVehicleInputUpdate = 0;

  // ── Light rig scratch vectors ──
  private helicopterLightRigs = new Map<number, {
    portId: string;
    starboardId: string;
    bellyId: string;
  }>();
  private readonly tmpHeliPort = new THREE.Vector3();
  private readonly tmpHeliStarboard = new THREE.Vector3();
  private readonly tmpHeliBelly = new THREE.Vector3();

  private engine: HelicopterEngineContext;

  constructor(engine: HelicopterEngineContext) {
    this.engine = engine;
  }

  // ── Pitch clamping constants (exposed for external callers) ──
  static readonly PILOT_PITCH_MIN = HELI_PILOT_PITCH_MIN;
  static readonly PILOT_PITCH_MAX = HELI_PILOT_PITCH_MAX;
  static readonly CAMERA_DISTANCE = HELI_CAMERA_DISTANCE;

  // ══════════════════════════════════════════════════════════════
  //  HELICOPTER MODEL
  // ══════════════════════════════════════════════════════════════

  createHelicopterModel(): THREE.Group {
    const heli = new THREE.Group();
    heli.name = 'helicopter-root';

    // ── Shared voxel-style material (matches map shading) ──
    // Uses vertex colors + per-face directional shading like VoxelWorld
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
    // Blade material keeps emissive glow (no vertex-color shading needed — thin flat pieces)
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0x8ff4ff, emissive: 0x12303a, emissiveIntensity: 0.3 });
    const tailBladeMat = new THREE.MeshLambertMaterial({ color: 0x93f2ff, emissive: 0x14323d, emissiveIntensity: 0.2 });

    // ── Per-face directional shading (same multipliers as VoxelWorld FACE_SHADING) ──
    //  +X  -X   +Y   -Y   +Z   -Z
    const FACE_SHADE = [0.85, 0.85, 1.0, 0.7, 0.9, 0.9];

    // Simple hash for subtle per-part color variation (like map's per-block hash)
    let _partSeed = 0;
    const partVariation = (): number => {
      _partSeed++;
      const h = ((_partSeed * 374761393) ^ (_partSeed * 668265263)) | 0;
      return ((((h ^ (h >> 13)) * 1274126177) ^ ((h >> 16))) & 0x7fffffff) / 0x7fffffff;
    };

    /**
     * Build a box with voxel-style per-face vertex-color shading.
     * Each of the 6 faces gets the base color multiplied by a directional shade factor,
     * plus a subtle random variation per part — matching how the map renders blocks.
     */
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

      // Subtle per-part variation (like VoxelWorld hash2d variation)
      const v = (partVariation() - 0.5) * 0.06;
      const br = Math.max(0, Math.min(1, c.r + v));
      const bg = Math.max(0, Math.min(1, c.g + v));
      const bb = Math.max(0, Math.min(1, c.b + v));

      for (let i = 0; i < posAttr.count; i++) {
        const nx = normalAttr.getX(i);
        const ny = normalAttr.getY(i);
        const nz = normalAttr.getZ(i);

        // Determine which face this vertex belongs to by dominant normal
        let shade = 0.85;
        if (nx > 0.5) shade = FACE_SHADE[0];       // +X
        else if (nx < -0.5) shade = FACE_SHADE[1];  // -X
        else if (ny > 0.5) shade = FACE_SHADE[2];   // +Y (top — brightest)
        else if (ny < -0.5) shade = FACE_SHADE[3];  // -Y (bottom — darkest)
        else if (nz > 0.5) shade = FACE_SHADE[4];   // +Z
        else if (nz < -0.5) shade = FACE_SHADE[5];  // -Z

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

    // Shorthand for non-glass parts
    const B = (
      parent: THREE.Object3D, size: [number, number, number],
      hex: number, pos: [number, number, number], rot?: [number, number, number],
    ) => shadedBox(parent, size, hex, pos, rot);

    // Shorthand for glass parts
    const G = (
      parent: THREE.Object3D, size: [number, number, number],
      hex: number, pos: [number, number, number], rot?: [number, number, number],
    ) => shadedBox(parent, size, hex, pos, rot, glassMat);

    // Helper for cylinder parts (mast, exhaust) — keep simple material
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
    const SHELL     = 0x4a4e52;  // main body (like Metal block)
    const SHELL_LT  = 0x585e64;  // lighter panels (like Stone)
    const SHELL_DK  = 0x33383c;  // darker panels
    const UNDER     = 0x2a2a2e;  // underside (like Asphalt)
    const DARK      = 0x1a1d20;  // darkest trim
    const ACCENT    = 0x4ad2ff;  // cyan accent
    const GLASS     = 0x83d8ff;  // cockpit glass
    const SKID      = 0x3a3632;  // landing gear (like Rubble)
    const EXHAUST   = 0x1a1d20;  // exhaust

    // =============================================
    // FUSELAGE — layered, cohesive body
    // =============================================
    const fuselage = new THREE.Group();
    fuselage.name = 'fuselage';
    heli.add(fuselage);

    // Main cabin — large central body
    B(fuselage, [5.0, 2.2, 2.8], SHELL, [0, 2.4, 0]);
    // Cabin roof (lighter — catches light like top face)
    B(fuselage, [4.4, 0.35, 2.6], SHELL_LT, [0, 3.55, 0]);
    // Cabin floor / underside (dark — bottom face shading)
    B(fuselage, [5.2, 0.3, 2.6], UNDER, [0, 1.25, 0]);

    // Nose section — tapers forward
    B(fuselage, [2.0, 1.8, 2.5], SHELL, [3.2, 2.5, 0]);
    // Nose taper (angled front — slightly lighter)
    B(fuselage, [1.2, 1.4, 2.2], SHELL_LT, [4.4, 2.55, 0], [0.12, 0, 0]);
    // Nose underside panel
    B(fuselage, [2.4, 0.3, 2.3], UNDER, [3.4, 1.55, 0]);

    // Cockpit windshield — glass
    G(fuselage, [1.6, 1.5, 2.3], GLASS, [4.0, 2.9, 0], [0.15, 0, 0]);
    // Cockpit side windows
    G(fuselage, [1.8, 0.9, 0.08], GLASS, [3.6, 2.9, -1.42]);
    G(fuselage, [1.8, 0.9, 0.08], GLASS, [3.6, 2.9, 1.42]);
    // Cabin side windows (two per side)
    G(fuselage, [0.9, 0.7, 0.08], GLASS, [1.0, 2.9, -1.42]);
    G(fuselage, [0.9, 0.7, 0.08], GLASS, [1.0, 2.9, 1.42]);
    G(fuselage, [0.9, 0.7, 0.08], GLASS, [-0.5, 2.9, -1.42]);
    G(fuselage, [0.9, 0.7, 0.08], GLASS, [-0.5, 2.9, 1.42]);

    // Rear fuselage transition (narrows toward tail — progressively darker)
    B(fuselage, [1.8, 1.6, 2.2], SHELL, [-2.8, 2.5, 0]);
    B(fuselage, [1.0, 1.2, 1.6], SHELL_DK, [-3.8, 2.5, 0]);

    // Engine cowling (top — lighter, catches sky)
    B(fuselage, [2.4, 0.7, 2.0], SHELL_DK, [-0.5, 3.75, 0]);
    // Engine intake scoops (dark recesses)
    B(fuselage, [0.8, 0.35, 0.5], DARK, [-0.2, 4.15, -0.9]);
    B(fuselage, [0.8, 0.35, 0.5], DARK, [-0.2, 4.15, 0.9]);

    // Exhaust pipes (cylinders)
    mkCyl(fuselage, 0.15, 0.12, 0.6, EXHAUST, [-1.9, 3.7, -0.7], [0, 0, Math.PI / 2]);
    mkCyl(fuselage, 0.15, 0.12, 0.6, EXHAUST, [-1.9, 3.7, 0.7], [0, 0, Math.PI / 2]);

    // =============================================
    // ACCENT DETAILS — stripes and trim
    // =============================================
    B(fuselage, [7.0, 0.15, 0.12], ACCENT, [0.3, 1.5, -1.42]);
    B(fuselage, [7.0, 0.15, 0.12], ACCENT, [0.3, 1.5, 1.42]);
    B(fuselage, [0.12, 0.8, 2.0], ACCENT, [5.0, 2.5, 0]);
    B(fuselage, [0.12, 1.0, 1.8], ACCENT, [-3.3, 2.5, 0]);

    // =============================================
    // TAIL BOOM — tapers, connected, shade gradient
    // =============================================
    const tail = new THREE.Group();
    tail.name = 'tail-section';
    tail.position.set(-4.3, 2.5, 0);
    heli.add(tail);

    // Tail segments get progressively darker toward the tip
    B(tail, [1.5, 0.9, 0.9], SHELL, [-0.3, 0, 0]);
    B(tail, [1.5, 0.75, 0.75], SHELL_DK, [-1.6, 0.05, 0]);
    B(tail, [1.5, 0.6, 0.6], SHELL_DK, [-2.8, 0.1, 0]);
    B(tail, [1.2, 0.5, 0.5], UNDER, [-3.8, 0.15, 0]);

    // Tail boom accent stripe
    B(tail, [4.5, 0.1, 0.08], ACCENT, [-2.0, 0.45, 0]);

    // Vertical stabilizer (tail fin — dark)
    B(tail, [0.9, 1.8, 0.2], DARK, [-4.2, 1.1, 0]);
    B(tail, [0.7, 0.12, 0.22], ACCENT, [-4.2, 2.0, 0]);

    // Horizontal stabilizers
    B(tail, [0.6, 0.15, 1.8], SHELL_DK, [-4.0, 0.2, 0]);
    B(tail, [0.4, 0.12, 0.12], ACCENT, [-4.0, 0.28, -0.95]);
    B(tail, [0.4, 0.12, 0.12], ACCENT, [-4.0, 0.28, 0.95]);

    // Ventral fin
    B(tail, [0.6, 0.7, 0.15], DARK, [-4.0, -0.5, 0]);

    // =============================================
    // TAIL ROTOR
    // =============================================
    const tailRotor = new THREE.Group();
    tailRotor.name = 'helicopter-tail-rotor';
    tailRotor.position.set(-4.3, 1.2, 0.14);
    tail.add(tailRotor);

    mkCyl(tailRotor, 0.08, 0.08, 0.12, DARK, [0, 0, 0], [Math.PI / 2, 0, 0]);

    // 4 actual blades at 90° intervals (rotated around Z axis — spins in the Y/X plane)
    for (let i = 0; i < 4; i++) {
      const bladeGroup = new THREE.Group();
      bladeGroup.rotation.z = (Math.PI / 2) * i;
      tailRotor.add(bladeGroup);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.04), tailBladeMat);
      blade.position.set(0, 0.42, 0);
      blade.name = 'tail-blade';
      blade.castShadow = true;
      bladeGroup.add(blade);
      // Blade tip accent
      const tip = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.08, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xb0f8ff, transparent: true, opacity: 0.9 }),
      );
      tip.position.set(0, 0.78, 0);
      bladeGroup.add(tip);
    }

    // Tail rotor blur disc
    const tailBlurMat = new THREE.MeshBasicMaterial({
      color: 0x8ff4ff,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const tailBlurDisc = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.82, 32), tailBlurMat);
    tailBlurDisc.name = 'tail-blur-disc';
    tailBlurDisc.rotation.x = Math.PI / 2; // face outward (Z axis)
    tailRotor.add(tailBlurDisc);

    // =============================================
    // LANDING SKIDS — shaded like rubble/metal
    // =============================================
    for (const side of [-1, 1]) {
      const z = side * 1.1;

      B(heli, [5.5, 0.15, 0.15], SKID, [0.5, 0.6, z]);            // runner
      B(heli, [0.15, 0.4, 0.15], SKID, [3.3, 0.8, z], [0, 0, -0.3]); // front upturn
      B(heli, [0.12, 1.0, 0.12], SKID, [2.0, 1.1, z], [0, 0, 0.08]); // front strut
      B(heli, [0.12, 1.0, 0.12], SKID, [-1.2, 1.1, z], [0, 0, -0.08]); // rear strut

      // Cross-braces
      B(heli, [0.1, 0.1, Math.abs(z) - 0.15], SKID, [2.0, 1.55, side * 0.55]);
      B(heli, [0.1, 0.1, Math.abs(z) - 0.15], SKID, [-1.2, 1.55, side * 0.55]);
    }

    // =============================================
    // MAIN ROTOR — with hub + blur disc
    // =============================================
    const mainRotor = new THREE.Group();
    mainRotor.name = 'helicopter-main-rotor';
    mainRotor.position.set(-0.3, 4.25, 0);
    heli.add(mainRotor);

    // Hub mast and plate
    mkCyl(mainRotor, 0.12, 0.15, 0.5, DARK, [0, -0.25, 0]);
    mkCyl(mainRotor, 0.35, 0.3, 0.18, DARK, [0, 0.02, 0]);

    // Blade tip glow material
    const tipGlowMat = new THREE.MeshBasicMaterial({
      color: 0xb0f8ff,
      transparent: true,
      opacity: 0.85,
    });

    for (let i = 0; i < 4; i++) {
      const bladeGroup = new THREE.Group();
      bladeGroup.rotation.y = (Math.PI / 2) * i;
      mainRotor.add(bladeGroup);

      // Inner blade segment — wider near hub with slight collective pitch
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 3.0), bladeMat);
      inner.position.set(0, 0, 1.8);
      inner.rotation.z = 0.03; // subtle pitch twist
      inner.name = 'main-blade';
      inner.castShadow = true;
      inner.receiveShadow = true;
      bladeGroup.add(inner);

      // Outer blade segment — tapers thinner
      const outer = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 3.2), bladeMat);
      outer.position.set(0, 0, 4.6);
      outer.rotation.z = 0.05; // more pitch at tip
      outer.name = 'main-blade';
      outer.castShadow = true;
      outer.receiveShadow = true;
      bladeGroup.add(outer);

      // Blade tip accent (small glowing cap)
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.14), tipGlowMat);
      tip.position.set(0, 0, 6.2);
      tip.name = 'main-blade';
      bladeGroup.add(tip);
    }

    // Main rotor blur disc — semi-transparent, shown when spinning fast
    const blurDiscMat = new THREE.MeshBasicMaterial({
      color: 0x8ff4ff,
      transparent: true,
      opacity: 0.0, // starts invisible
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mainBlurDisc = new THREE.Mesh(new THREE.RingGeometry(0.5, 6.4, 64), blurDiscMat);
    mainBlurDisc.name = 'main-blur-disc';
    mainBlurDisc.rotation.x = -Math.PI / 2; // lay flat in XZ plane
    mainRotor.add(mainBlurDisc);

    // =============================================
    // DETAIL — doors, panels, lights
    // =============================================
    B(fuselage, [0.06, 1.6, 0.06], DARK, [1.8, 2.4, -1.42]);
    B(fuselage, [0.06, 1.6, 0.06], DARK, [1.8, 2.4, 1.42]);
    B(fuselage, [0.06, 1.6, 0.06], DARK, [0.0, 2.4, -1.42]);
    B(fuselage, [0.06, 1.6, 0.06], DARK, [0.0, 2.4, 1.42]);

    // Navigation lights
    B(fuselage, [0.12, 0.12, 0.12], ACCENT, [5.05, 2.3, 0]);
    B(tail, [0.1, 0.1, 0.1], ACCENT, [-4.5, 2.0, 0]);
    B(fuselage, [0.18, 0.1, 0.18], ACCENT, [0, 1.18, 0]);

    // Rotate the entire visual model so its nose (built along +X) aligns
    // with the Three.js forward convention (-Z).  The outer 'heli' group
    // receives the server yaw on rotation.y; this inner wrapper adds a
    // fixed PI/2 offset that only affects the visual mesh, keeping the
    // math consistent with the camera and physics forward direction.
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
  //  ENTITY MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  getVehicleRow(vehicleId: number): any | null {
    if (!this.engine.conn || vehicleId === 0) return null;
    const table = (this.engine.conn.db as any).vehicle;
    if (!table) return null;
    for (const row of table.iter()) {
      if (Number((row as any).entityId) === vehicleId) return row;
    }
    return null;
  }

  findEntityRow(entityId: number): any | null {
    if (!this.engine.conn) return null;
    const table = (this.engine.conn.db as any).entity;
    if (!table) return null;
    for (const row of table.iter()) {
      if (Number((row as any).id) === entityId) return row;
    }
    return null;
  }

  /** Check if player is near any unoccupied helicopter (for ENTER prompt) */
  isNearVehicle(): boolean {
    const camPos = this.engine.camera.position;
    for (const [, mesh] of this.helicopters) {
      const dx = camPos.x - mesh.position.x;
      const dy = camPos.y - mesh.position.y;
      const dz = camPos.z - mesh.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= HELI_MOUNT_RANGE) return true;
    }
    return false;
  }

  ensureHelicopterMesh(entityId: number): THREE.Group {
    let mesh = this.helicopters.get(entityId);
    if (mesh) return mesh;

    mesh = this.createHelicopterModel();
    mesh.userData.entityId = entityId;
    mesh.userData.clientSpinAngle = 0;
    mesh.userData.smoothBlurT = 0;
    mesh.userData.currentOpacity = 1.0;
    // Store base opacity on each material so transparency fade can restore correctly
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.Material;
        if (!mat.userData) mat.userData = {};
        mat.userData.baseOpacity = mat.opacity;
      }
    });
    this.engine.scene.add(mesh);
    this.helicopters.set(entityId, mesh);
    this.helicopterBuffers.set(entityId, new InterpolationBuffer());
    this.ensureHelicopterLightRig(entityId, mesh);
    this.engine.audio.startHelicopterSound(entityId);
    return mesh;
  }

  scheduleHelicopterDestroyFallback(entityId: number): void {
    if (this.pendingHelicopterDestroyFallbacks.has(entityId)) return;
    const timer = window.setTimeout(() => {
      this.pendingHelicopterDestroyFallbacks.delete(entityId);
      const mesh = this.helicopters.get(entityId);
      if (!mesh) return;
      this.triggerHelicopterDestroyFx(entityId, {
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
      }, mesh.rotation.y);
    }, 120);
    this.pendingHelicopterDestroyFallbacks.set(entityId, timer);
  }

  triggerHelicopterDestroyFx(
    entityId: number,
    pos: { x: number; y: number; z: number },
    yaw: number,
    intensity = 1,
  ): void {
    const now = performance.now();
    const last = this.recentHelicopterBreakups.get(entityId) ?? -Infinity;
    if (now - last < 1100) {
      this.removeHelicopterMesh(entityId, true);
      return;
    }
    this.recentHelicopterBreakups.set(entityId, now);
    this.removeHelicopterMesh(entityId, true);
    this.spawnHelicopterBreakup(pos, yaw, intensity);
  }

  removeHelicopterMesh(entityId: number, destroyed = false): void {
    const timer = this.pendingHelicopterDestroyFallbacks.get(entityId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.pendingHelicopterDestroyFallbacks.delete(entityId);
    }
    this.removeHelicopterLightRig(entityId);
    this.engine.audio.stopHelicopterSound(entityId, destroyed);
    const mesh = this.helicopters.get(entityId);
    if (!mesh) return;
    this.engine.scene.remove(mesh);
    this.engine.disposeObjectMaterials(mesh);
    this.helicopters.delete(entityId);
    this.helicopterBuffers.delete(entityId);
  }

  spawnHelicopterBreakup(
    pos: { x: number; y: number; z: number },
    yaw: number,
    intensity = 1,
  ): void {
    const fxIntensity = THREE.MathUtils.clamp(intensity, 0.55, 1.8);
    const colorPool = [0x2a3138, 0x38434d, 0x4a5561, 0x191f24, 0x6b7685];
    const pieceCount = Math.floor(18 + fxIntensity * 8);
    const origin = new THREE.Vector3(pos.x, pos.y + 2.2, pos.z);
    const radial = new THREE.Vector3();

    this.engine.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 2.5, z: pos.z },
      color: 0xff7a32,
      intensity: 8.5 * fxIntensity,
      distance: 28 + 12 * fxIntensity,
      decay: 1.45,
      ttl: 0.22,
      kind: 'generic',
    });
    this.engine.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 1.4, z: pos.z },
      color: 0xff3a12,
      intensity: 5.8 * fxIntensity,
      distance: 20 + 8 * fxIntensity,
      decay: 1.8,
      ttl: 0.42,
      kind: 'generic',
    });

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
      this.engine.scene.add(mesh);

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

      this.helicopterBreakupPieces.push({
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
    this.engine.physics.spawnExplosionDebris(ringBlocks, pos.x, pos.y + 2.0, pos.z, blastRadius, blastPower);
    this.engine.vfx.emitExplosion(pos.x, pos.y + 2.0, pos.z, blastRadius);
    this.engine.vfx.emitExplosion(pos.x, pos.y + 2.8, pos.z, blastRadius * 0.75);
    this.engine.vfx.emitImpact(pos.x, pos.y + 1.4, pos.z);
    this.engine.vfx.emitImpact(pos.x + 1.1, pos.y + 2.3, pos.z - 0.6);
    this.engine.vfx.emitImpact(pos.x - 1.0, pos.y + 2.0, pos.z + 0.9);
    this.engine.audio.playExplosion({ position: { x: pos.x, y: pos.y + 2.0, z: pos.z } });
    this.engine.applyExplosionCameraEffects(pos.x, pos.y + 2.0, pos.z, blastRadius, 95 + fxIntensity * 40);
  }

  updateHelicopterEntity(entity: any): void {
    const id = Number(entity.id);
    if (!Number.isFinite(id) || id <= 0) return;

    const vehicle = this.getVehicleRow(id);
    if (!vehicle || Number(vehicle.vehicleType) !== VEHICLE_TYPE_HELICOPTER || !entity.active) {
      this.removeHelicopterMesh(id);
      return;
    }

    const mesh = this.ensureHelicopterMesh(id);
    const vel = entity.vel || { x: 0, y: 0, z: 0 };
    const rot = entity.rot || { yaw: 0, pitch: 0 };
    // For the local pilot, store the latest server snapshot for smooth chase (no InterpolationBuffer)
    if (id === this.engine.mountedVehicleId) {
      this.localHeliLastServerPos.set(Number(entity.pos.x), Number(entity.pos.y), Number(entity.pos.z));
      this.localHeliLastServerVel.set(Number(vel.x), Number(vel.y), Number(vel.z));
      this.localHeliLastServerYaw = Number(rot.yaw ?? 0);
      this.localHeliLastServerPitch = Number(rot.pitch ?? 0);
      this.localHeliLastServerTime = performance.now();
    }

    // Remote helicopters (and unmounted ones) still use InterpolationBuffer
    const buffer = this.helicopterBuffers.get(id);
    if (buffer) {
      buffer.push(
        new THREE.Vector3(entity.pos.x, entity.pos.y, entity.pos.z),
        new THREE.Vector3(vel.x, vel.y, vel.z),
        { yaw: Number(rot.yaw ?? 0), pitch: Number(rot.pitch ?? 0) },
      );
    } else {
      mesh.position.set(entity.pos.x, entity.pos.y, entity.pos.z);
      mesh.rotation.set(Number(rot.pitch ?? 0), Number(rot.yaw ?? 0), 0);
    }

    // Note: vehicle.rotorSpin is no longer used for visual rotation.
    // Client-side continuous spin (mesh.userData.clientSpinAngle) handles it
    // to avoid the 2π wrapping stutter from the server value.
  }

  rebuildHelicoptersFromServer(): void {
    if (!this.engine.conn) return;
    const entityTable = (this.engine.conn.db as any).entity;
    if (!entityTable) return;

    const active = new Set<number>();
    for (const entity of entityTable.iter()) {
      const e = entity as any;
      if (Number(e.kind) !== ENTITY_KIND_VEHICLE || Number(e.subtype) !== VEHICLE_TYPE_HELICOPTER) continue;
      const id = Number(e.id);
      active.add(id);
      this.updateHelicopterEntity(e);
    }

    for (const id of Array.from(this.helicopters.keys())) {
      if (!active.has(id)) this.removeHelicopterMesh(id);
    }
  }

  syncVehicleInput(): void {
    if (!this.engine.conn || !this.engine.localIdentity || this.engine.mountedVehicleId === 0) return;
    const now = performance.now();
    if (now - this.lastVehicleInputUpdate < VEHICLE_INPUT_INTERVAL_MS) return;
    this.lastVehicleInputUpdate = now;

    // Battlefield-style: W/S = forward/back thrust
    let forward = 0;
    if (this.engine.controls.moveForward) forward += 1;
    if (this.engine.controls.moveBackward) forward -= 1;

    // Q/E = strafe (decoupled from yaw)
    let strafe = 0;
    if (this.engine.controls.ePressed) strafe += 1;
    if (this.engine.controls.qPressed) strafe -= 1;

    // Space = ascend, Shift = descend
    let lift = 0;
    if (this.engine.controls.spacePressed) lift += 1;
    if (this.engine.controls.shiftHeld) lift -= 1;

    // A/D = yaw rotation only (no strafe component)
    let yaw = 0;
    if (this.engine.controls.moveRight) yaw += 1;
    if (this.engine.controls.moveLeft) yaw -= 1;

    this.engine.conn.reducers.updateVehicleInput({
      forward,
      strafe,
      lift,
      yaw,
      boosting: false, // No boost for helicopters
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  SHARED UTIL
  // ══════════════════════════════════════════════════════════════

  getGroundHeight(x: number, z: number, footY?: number): number {
    if (footY !== undefined) {
      const top = this.engine.world.getGroundHeightBelow(x, footY, z);
      return top >= 0 ? top + 1 : 0;
    }
    const top = this.engine.world.getHighestBlock(x, z);
    return top >= 0 ? top + 1 : 0;
  }

  // ══════════════════════════════════════════════════════════════
  //  VEHICLE CAMERA + OPACITY
  // ══════════════════════════════════════════════════════════════

  getMountedVehiclePose(): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    if (this.engine.mountedVehicleId === 0) return null;

    // Prefer the interpolated mesh position (smooth) over raw entity table (jumpy)
    // to avoid camera oscillation caused by discrete server snapshots.
    const heli = this.helicopters.get(this.engine.mountedVehicleId);
    if (heli) {
      return {
        x: heli.position.x,
        y: heli.position.y,
        z: heli.position.z,
        yaw: heli.rotation.y,
        pitch: heli.rotation.x,
      };
    }

    // Fallback: raw entity table (only used before mesh exists)
    const entity = this.findEntityRow(this.engine.mountedVehicleId);
    if (entity) {
      return {
        x: Number(entity.pos.x),
        y: Number(entity.pos.y),
        z: Number(entity.pos.z),
        yaw: Number(entity.rot?.yaw ?? 0),
        pitch: Number(entity.rot?.pitch ?? 0),
      };
    }

    return null;
  }

  /** Raw entity table pose for server sync (not smoothed). */
  getMountedVehiclePoseRaw(): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    if (this.engine.mountedVehicleId === 0) return null;
    const entity = this.findEntityRow(this.engine.mountedVehicleId);
    if (entity) {
      return {
        x: Number(entity.pos.x),
        y: Number(entity.pos.y),
        z: Number(entity.pos.z),
        yaw: Number(entity.rot?.yaw ?? 0),
        pitch: Number(entity.rot?.pitch ?? 0),
      };
    }
    return null;
  }

  syncMountedCameraToVehicle(delta: number): void {
    const pose = this.getMountedVehiclePose();
    if (!pose) return;

    const lookYaw = this.vehiclePilotYaw;
    const lookPitch = this.vehiclePilotPitch;
    const cosPitch = Math.cos(lookPitch);
    const fx = -Math.sin(lookYaw) * cosPitch;
    const fy = Math.sin(lookPitch);
    const fz = -Math.cos(lookYaw) * cosPitch;

    const camDist = this.vehicleCameraDistance;
    const camHeight = HELI_CAMERA_HEIGHT * (camDist / HELI_CAMERA_DISTANCE); // scale height proportionally

    const desired = new THREE.Vector3(
      pose.x - fx * camDist,
      pose.y + camHeight,
      pose.z - fz * camDist,
    );
    const minCamY = this.getGroundHeight(desired.x, desired.z, desired.y) + 1.2;
    if (desired.y < minCamY) desired.y = minCamY;

    if (!this.mountedCameraInitialized) {
      this.mountedCameraPosition.copy(desired);
      this.mountedCameraInitialized = true;
    } else {
      // Frame-rate independent exponential lerp — use a high factor since the
      // helicopter mesh position is already smoothed. Double-smoothing with a
      // low factor creates compounded latency that feels sluggish/stuttery.
      const lerpFactor = 1 - Math.pow(1 - 0.72, delta * 60);
      this.mountedCameraPosition.lerp(desired, lerpFactor);
    }

    this.engine.camera.position.copy(this.mountedCameraPosition);
    this.engine.camera.lookAt(
      pose.x + fx * 18,
      pose.y + 2.2 + fy * 18,
      pose.z + fz * 18,
    );
    this.engine.controls.resetVelocity();

    // Make helicopter semi-transparent when it's between camera and crosshair
    this.updateMountedHelicopterOpacity(pose, camDist);
  }

  private updateMountedHelicopterOpacity(
    pose: { x: number; y: number; z: number },
    camDist: number,
  ): void {
    const heli = this.helicopters.get(this.engine.mountedVehicleId);
    if (!heli) return;

    // Compute vector from camera to helicopter center
    const dx = pose.x - this.engine.camera.position.x;
    const dy = (pose.y + 1.5) - this.engine.camera.position.y; // center of heli is ~1.5 above pivot
    const dz = pose.z - this.engine.camera.position.z;
    const distToHeli = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distToHeli < 0.01) { this.setHelicopterOpacity(heli, 0.15); return; }

    // Dot product between camera forward and cam->heli direction
    const camDir = new THREE.Vector3();
    this.engine.camera.getWorldDirection(camDir);
    const dot = (dx / distToHeli) * camDir.x + (dy / distToHeli) * camDir.y + (dz / distToHeli) * camDir.z;

    // If helicopter is behind camera, full opacity
    if (dot < 0) { this.setHelicopterOpacity(heli, 1.0); return; }

    // Angle between camera forward and heli direction
    // dot = cos(angle); dot=1 means heli is directly in front
    // Make transparent when heli is roughly in front (dot > ~0.7, i.e. <45 degrees)
    // More transparent the closer we are zoomed in
    const distFactor = 1 - Math.max(0, Math.min(1, (camDist - 6) / 18)); // 0 at far, 1 at close
    const angleFactor = Math.max(0, (dot - 0.5) / 0.5); // 0 at 60deg off-center, 1 at dead center
    const fadeAmount = distFactor * angleFactor;

    // Lerp opacity: 1.0 (fully opaque) when not in the way, 0.15 (very transparent) when directly blocking
    const targetOpacity = 1.0 - fadeAmount * 0.85;
    this.setHelicopterOpacity(heli, targetOpacity);
  }

  private setHelicopterOpacity(heli: THREE.Group, opacity: number): void {
    const prev = heli.userData.currentOpacity ?? 1.0;
    // Smooth transition
    const smoothed = prev + (opacity - prev) * 0.15;
    if (Math.abs(smoothed - prev) < 0.001 && Math.abs(smoothed - opacity) < 0.01) {
      heli.userData.currentOpacity = opacity;
    } else {
      heli.userData.currentOpacity = smoothed;
    }
    const op = heli.userData.currentOpacity as number;
    const isTransparent = op < 0.99;

    heli.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.Material;
        if (isTransparent) {
          mat.transparent = true;
          mat.opacity = op * ((mat as any).userData?.baseOpacity ?? 1.0);
          mat.depthWrite = op > 0.5;
        } else {
          mat.opacity = (mat as any).userData?.baseOpacity ?? 1.0;
          // Only restore non-transparent if the material wasn't originally transparent
          mat.transparent = ((mat as any).userData?.baseOpacity ?? 1.0) < 1.0;
          mat.depthWrite = true;
        }
        mat.needsUpdate = true;
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  LIGHT RIG
  // ══════════════════════════════════════════════════════════════

  ensureHelicopterLightRig(entityId: number, mesh: THREE.Group): void {
    if (this.helicopterLightRigs.has(entityId)) return;

    const portId = this.engine.addDynamicLight({
      kind: 'helicopter',
      type: 'point',
      position: mesh.position.clone(),
      color: 0xff3d3d,
      intensity: 0.85,
      distance: 14,
      decay: 1.9,
    });
    const starboardId = this.engine.addDynamicLight({
      kind: 'helicopter',
      type: 'point',
      position: mesh.position.clone(),
      color: 0x4cff83,
      intensity: 0.85,
      distance: 14,
      decay: 1.9,
    });
    const bellyId = this.engine.addDynamicLight({
      kind: 'helicopter',
      type: 'point',
      position: mesh.position.clone(),
      color: 0xaee7ff,
      intensity: 1.1,
      distance: 18,
      decay: 1.8,
    });

    this.helicopterLightRigs.set(entityId, { portId, starboardId, bellyId });
  }

  removeHelicopterLightRig(entityId: number): void {
    const rig = this.helicopterLightRigs.get(entityId);
    if (!rig) return;

    this.engine.removeDynamicLight(rig.portId);
    this.engine.removeDynamicLight(rig.starboardId);
    this.engine.removeDynamicLight(rig.bellyId);
    this.helicopterLightRigs.delete(entityId);
  }

  updateHelicopterLightRig(entityId: number, mesh: THREE.Group): void {
    const rig = this.helicopterLightRigs.get(entityId);
    if (!rig) return;

    const sunVisibility = this.engine.sky.getSunVisibility();
    const nightFactor = THREE.MathUtils.clamp(1 - sunVisibility, 0, 1);
    const navPulse = 0.75 + 0.25 * Math.sin(this.engine.elapsedTime * 7.5 + entityId);

    // Coordinates rotated by PI/2 around Y to match the orient wrapper:
    // original (x,y,z) → (z, y, -x)
    this.tmpHeliPort.set(-1.44, 2.38, -5.0).applyMatrix4(mesh.matrixWorld);
    this.tmpHeliStarboard.set(1.44, 2.38, -5.0).applyMatrix4(mesh.matrixWorld);
    this.tmpHeliBelly.set(0, 1.18, 0.1).applyMatrix4(mesh.matrixWorld);

    this.engine.updateDynamicLight(rig.portId, {
      position: this.tmpHeliPort,
      intensity: 0.18 + nightFactor * 0.92,
      distance: 10 + nightFactor * 8,
    });
    this.engine.updateDynamicLight(rig.starboardId, {
      position: this.tmpHeliStarboard,
      intensity: 0.18 + nightFactor * 0.92,
      distance: 10 + nightFactor * 8,
    });
    this.engine.updateDynamicLight(rig.bellyId, {
      position: this.tmpHeliBelly,
      intensity: (0.15 + nightFactor * 1.2) * navPulse,
      distance: 8 + nightFactor * 14,
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  RESET LOCAL PILOT SMOOTHING
  // ══════════════════════════════════════════════════════════════

  resetLocalPilotSmoothing(): void {
    this.localHeliSmoothedInitialized = false;
    this.localHeliLastServerTime = 0;
    this.mountedCameraInitialized = false;
  }

  // ══════════════════════════════════════════════════════════════
  //  PER-FRAME UPDATE (extracted from animate())
  // ══════════════════════════════════════════════════════════════

  updatePerFrame(delta: number): void {
    const heliRot = { yaw: 0, pitch: 0 };
    for (const [id, mesh] of this.helicopters) {
      if (id === this.engine.mountedVehicleId) {
        // ── LOCAL PILOT: Dead-reckoning with drag-matched prediction ──
        // Each frame we advance the smoothed position using velocity (dead reckoning),
        // then apply a fast correction toward the server's actual predicted position.
        // The prediction applies the same drag as the server (0.992/tick) so when new
        // snapshots arrive, the correction is tiny → virtually zero stutter.
        if (this.localHeliLastServerTime > 0) {
          const now = performance.now();
          const timeSinceUpdate = (now - this.localHeliLastServerTime) / 1000;

          // Predict where the server helicopter is RIGHT NOW, applying drag to velocity.
          // Server applies drag=0.992 per tick (dt=0.033s), so per-second drag = 0.992^(1/0.033) ≈ 0.992^30.3
          // We approximate continuous drag: vel * drag^(t/dt) where dt=0.033, drag=0.992
          // Simplified: effective velocity decays as vel * 0.992^(t/0.033)
          const dragPerTick = 0.992;
          const tickDt = 0.033;
          const dragFactor = Math.pow(dragPerTick, timeSinceUpdate / tickDt);

          // Drag-corrected velocity for position integration:
          // integral of vel*drag^(t/dt) from 0 to T = vel * dt/ln(drag) * (drag^(T/dt) - 1)
          // This gives the exact displacement with continuous exponential drag
          const lnDrag = Math.log(dragPerTick);
          const posIntegral = lnDrag !== 0 ? (tickDt / lnDrag) * (dragFactor - 1) : timeSinceUpdate;

          const predictedX = this.localHeliLastServerPos.x + this.localHeliLastServerVel.x * posIntegral;
          const predictedY = this.localHeliLastServerPos.y + this.localHeliLastServerVel.y * posIntegral;
          const predictedZ = this.localHeliLastServerPos.z + this.localHeliLastServerVel.z * posIntegral;

          if (!this.localHeliSmoothedInitialized) {
            // First frame: snap to predicted position
            this.localHeliSmoothedPos.set(predictedX, predictedY, predictedZ);
            this.localHeliSmoothedYaw = this.localHeliLastServerYaw;
            this.localHeliSmoothedPitch = this.localHeliLastServerPitch;
            this.localHeliSmoothedInitialized = true;
          } else {
            // Dead-reckon: advance smoothed position using drag-decayed velocity
            const currentVelX = this.localHeliLastServerVel.x * dragFactor;
            const currentVelY = this.localHeliLastServerVel.y * dragFactor;
            const currentVelZ = this.localHeliLastServerVel.z * dragFactor;
            this.localHeliSmoothedPos.x += currentVelX * delta;
            this.localHeliSmoothedPos.y += currentVelY * delta;
            this.localHeliSmoothedPos.z += currentVelZ * delta;

            // Error correction: fast blend toward predicted position
            // Since prediction now closely matches server physics, the error is tiny.
            // We use aggressive correction (40% per frame at 60fps) so any remaining
            // drift is absorbed within 2-3 frames (~33-50ms).
            const correctionRate = 1 - Math.pow(0.001, delta);
            const errX = predictedX - this.localHeliSmoothedPos.x;
            const errY = predictedY - this.localHeliSmoothedPos.y;
            const errZ = predictedZ - this.localHeliSmoothedPos.z;
            this.localHeliSmoothedPos.x += errX * correctionRate;
            this.localHeliSmoothedPos.y += errY * correctionRate;
            this.localHeliSmoothedPos.z += errZ * correctionRate;

            // Shortest-path yaw smoothing (aggressive)
            let dyaw = this.localHeliLastServerYaw - this.localHeliSmoothedYaw;
            if (dyaw > Math.PI) dyaw -= 2 * Math.PI;
            if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
            this.localHeliSmoothedYaw += dyaw * correctionRate;

            this.localHeliSmoothedPitch += (this.localHeliLastServerPitch - this.localHeliSmoothedPitch) * correctionRate;
          }

          mesh.position.copy(this.localHeliSmoothedPos);
          mesh.rotation.set(this.localHeliSmoothedPitch, this.localHeliSmoothedYaw, 0);
        } else {
          // No server data yet - fallback to entity table
          const entity = this.findEntityRow(id);
          if (entity) {
            mesh.position.set(Number(entity.pos.x), Number(entity.pos.y), Number(entity.pos.z));
            mesh.rotation.set(Number(entity.rot?.pitch ?? 0), Number(entity.rot?.yaw ?? 0), 0);
          }
        }
      } else {
        // ── REMOTE HELICOPTERS: Use InterpolationBuffer as before ──
        const buffer = this.helicopterBuffers.get(id);
        if (buffer && buffer.hasData()) {
          buffer.sample(mesh.position, heliRot);
          mesh.rotation.set(heliRot.pitch, heliRot.yaw, 0);
        }
      }

      // Banking/roll animation — derive velocity from mesh position delta (not raw entity table)
      // This avoids jitter from discrete 30Hz entity.vel updates
      const prevPos = mesh.userData.prevFramePos as THREE.Vector3 | undefined;
      if (prevPos && delta > 0) {
        const derivedVelX = (mesh.position.x - prevPos.x) / delta;
        const derivedVelZ = (mesh.position.z - prevPos.z) / delta;
        // Store horizontal speed for idle hover animation
        mesh.userData.derivedHSpeed = Math.sqrt(derivedVelX * derivedVelX + derivedVelZ * derivedVelZ);
        const yaw = mesh.rotation.y;
        // Project derived velocity onto helicopter's local right axis
        const rightX = Math.cos(yaw);
        const rightZ = -Math.sin(yaw);
        const lateralSpeed = derivedVelX * rightX + derivedVelZ * rightZ;
        // Bank proportional to lateral speed (max ~15 degrees)
        const targetRoll = -lateralSpeed * 0.04;
        const maxRoll = 0.26; // ~15 degrees
        const clampedRoll = Math.max(-maxRoll, Math.min(maxRoll, targetRoll));
        // Smooth roll with FRI lerp
        const prevRoll = mesh.userData.smoothRoll ?? 0;
        const rollLerp = 1 - Math.pow(0.05, delta);
        const smoothRoll = prevRoll + (clampedRoll - prevRoll) * rollLerp;
        mesh.userData.smoothRoll = smoothRoll;
        mesh.rotation.z = smoothRoll;
      }
      // Store current position for next frame's velocity derivation
      if (!mesh.userData.prevFramePos) {
        mesh.userData.prevFramePos = mesh.position.clone();
      } else {
        (mesh.userData.prevFramePos as THREE.Vector3).copy(mesh.position);
      }

      // ── IDLE HOVER ANIMATION ──
      // Subtle organic movement applied to the orient wrapper (visual only,
      // does not affect network position or physics).  Layered sine waves at
      // incommensurate frequencies produce a non-repeating, alive feel.
      // The effect fades out proportionally to speed so it's only visible
      // when the helicopter is hovering or nearly stationary.
      const orientWrapper = mesh.getObjectByName('helicopter-orient-wrapper');
      if (orientWrapper) {
        // Use horizontal speed computed in the banking block above
        const hSpeed = (mesh.userData.derivedHSpeed as number) ?? 0;
        // Fade idle animation: full at 0 speed, gone by 6 units/s
        const idleBlend = Math.max(0, 1 - hSpeed / 6);
        // Use entityId as a per-helicopter phase offset so they don't all sway in sync
        const phase = id * 1.7;
        const t = this.engine.elapsedTime;

        // Vertical bob — two overlapping waves
        const bobY = (Math.sin(t * 1.1 + phase) * 0.14
                    + Math.sin(t * 2.3 + phase * 0.6) * 0.08
                    + Math.sin(t * 3.7 + phase * 1.3) * 0.035) * idleBlend;
        // Lateral drift
        const driftX = (Math.sin(t * 0.7 + phase + 1.0) * 0.10
                      + Math.sin(t * 1.9 + phase * 0.8) * 0.05
                      + Math.sin(t * 2.6 + phase * 1.4) * 0.025) * idleBlend;
        const driftZ = (Math.sin(t * 0.9 + phase + 2.0) * 0.08
                      + Math.sin(t * 1.5 + phase * 1.1) * 0.04
                      + Math.sin(t * 2.9 + phase * 0.5) * 0.02) * idleBlend;

        // Rotation sway (radians)
        const swayPitch = (Math.sin(t * 0.8 + phase + 0.5) * 0.035
                         + Math.sin(t * 1.7 + phase * 0.9) * 0.018
                         + Math.sin(t * 2.8 + phase * 1.1) * 0.008) * idleBlend;
        const swayRoll  = (Math.sin(t * 0.6 + phase + 3.0) * 0.04
                         + Math.sin(t * 1.3 + phase * 0.7) * 0.02
                         + Math.sin(t * 2.4 + phase * 0.3) * 0.01) * idleBlend;
        const swayYaw   = (Math.sin(t * 0.5 + phase + 4.0) * 0.025
                         + Math.sin(t * 1.1 + phase * 1.2) * 0.012
                         + Math.sin(t * 2.1 + phase * 0.9) * 0.006) * idleBlend;

        // Apply to orient wrapper (additive to its fixed PI/2 yaw)
        orientWrapper.position.set(driftX, bobY, driftZ);
        orientWrapper.rotation.set(swayPitch, Math.PI / 2 + swayYaw, swayRoll);
      }

      // ── CLIENT-SIDE CONTINUOUS ROTOR SPIN ──
      // Instead of chasing the server's wrapping rotor_spin (which stutters when it
      // wraps at 2π), we maintain a purely client-side continuous angle and compute
      // the spin rate from vehicle state.
      //
      // Spin rate formula (mirrors server lib.rs:3833):
      //   Piloted: 10.0 + (|forward| + |strafe|) * 4.0 + |lift| * 2.0
      //   Idle:    2.4
      let spinRate = 2.4; // idle spin rate (unpiloted)
      if (id === this.engine.mountedVehicleId) {
        // Local pilot — compute exact rate from current inputs
        let fwd = 0;
        if (this.engine.controls.moveForward) fwd += 1;
        if (this.engine.controls.moveBackward) fwd -= 1;
        let strafe = 0;
        if (this.engine.controls.ePressed) strafe += 1;
        if (this.engine.controls.qPressed) strafe -= 1;
        let lift = 0;
        if (this.engine.controls.spacePressed) lift += 1;
        if (this.engine.controls.shiftHeld) lift -= 1;
        spinRate = 10.0 + (Math.abs(fwd) + Math.abs(strafe)) * 4.0 + Math.abs(lift) * 2.0;
      } else {
        // Remote helicopter — check if piloted
        const vRow = this.getVehicleRow(id);
        if (vRow && vRow.pilotIdentity) {
          // Piloted, approximate from server inputs
          const af = Math.abs(Number(vRow.inputForward ?? 0));
          const as_ = Math.abs(Number(vRow.inputStrafe ?? 0));
          const al = Math.abs(Number(vRow.inputLift ?? 0));
          spinRate = 10.0 + (af + as_) * 4.0 + al * 2.0;
        }
      }

      // Accumulate continuous angle (never wraps → no stutter)
      const prevAngle = (mesh.userData.clientSpinAngle as number) ?? 0;
      const newAngle = prevAngle + spinRate * delta;
      mesh.userData.clientSpinAngle = newAngle;

      const mainRotor = mesh.getObjectByName('helicopter-main-rotor');
      if (mainRotor) mainRotor.rotation.y = newAngle;
      const tailRotor = mesh.getObjectByName('helicopter-tail-rotor');
      if (tailRotor) tailRotor.rotation.z = newAngle * 3.4;

      // ── BLUR DISC FADING ──
      // When spinning fast, fade in translucent disc + fade out individual blades.
      // This eliminates the "wagon wheel" aliasing at high RPM.
      const BLUR_FADE_START = 5.0;  // spin rate where blur begins appearing
      const BLUR_FADE_FULL  = 10.0; // spin rate where blur is fully opaque, blades invisible
      const blurT = Math.max(0, Math.min(1, (spinRate - BLUR_FADE_START) / (BLUR_FADE_FULL - BLUR_FADE_START)));
      // Smooth the blur transition
      const prevBlurT = (mesh.userData.smoothBlurT as number) ?? 0;
      const blurLerp = 1 - Math.pow(0.02, delta);
      const smoothBlurT = prevBlurT + (blurT - prevBlurT) * blurLerp;
      mesh.userData.smoothBlurT = smoothBlurT;

      const bladeOpacity = 1.0 - smoothBlurT;
      const discOpacity = smoothBlurT * 0.13; // subtle disc even at full blur

      // Main rotor: fade blades + show disc
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

      // Tail rotor: same treatment
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

      // ── HELICOPTER AUDIO UPDATE ──
      // Feed position, spin rate, and speed to the spatial audio loop each frame
      const heliSpeed = (mesh.userData.derivedHSpeed as number) ?? 0;
      this.engine.audio.updateHelicopterSound(
        id, mesh.position, spinRate, heliSpeed,
        id === this.engine.mountedVehicleId,
      );

      mesh.updateMatrixWorld();
      this.updateHelicopterLightRig(id, mesh);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  BREAKUP PIECE PHYSICS (extracted from animate())
  // ══════════════════════════════════════════════════════════════

  updateBreakupPieces(delta: number): void {
    for (let i = this.helicopterBreakupPieces.length - 1; i >= 0; i--) {
      const piece = this.helicopterBreakupPieces[i]!;
      piece.ttl -= delta;
      piece.vel.y -= HELI_BREAKUP_GRAVITY * delta;
      piece.mesh.position.addScaledVector(piece.vel, delta);
      piece.mesh.rotation.x += piece.angVel.x * delta;
      piece.mesh.rotation.y += piece.angVel.y * delta;
      piece.mesh.rotation.z += piece.angVel.z * delta;

      const groundY = this.getGroundHeight(piece.mesh.position.x, piece.mesh.position.z, piece.mesh.position.y);
      if (piece.mesh.position.y <= groundY + 0.25) {
        piece.mesh.position.y = groundY + 0.25;
        piece.vel.x *= 0.6;
        piece.vel.z *= 0.6;
        piece.vel.y *= -0.22;
        piece.angVel.multiplyScalar(0.65);
      }

      if (piece.ttl <= 0) {
        this.engine.scene.remove(piece.mesh);
        piece.mesh.geometry.dispose();
        if (Array.isArray(piece.mesh.material)) {
          for (const mat of piece.mesh.material) mat.dispose();
        } else {
          piece.mesh.material.dispose();
        }
        this.helicopterBreakupPieces.splice(i, 1);
      }
    }
  }
}
