import * as THREE from 'three';
import { VoxelWorld, BlockType, BLOCK_COLORS, WORLD_X, WORLD_Y, WORLD_Z, CHUNK, packChunkId, unpackChunkId } from './VoxelWorld';
import { FPSControls } from './FPSControls';
import { WeaponSystem, WEAPONS } from './Weapons';
import { AudioSystem } from './AudioSystem';
import { VFX } from './VFX';
import { WeaponModel } from './WeaponModel';
import { PostFX } from './PostFX';
import { PhysicsSystem } from './PhysicsSystem';
import { ProjectileManager } from './ProjectileManager';
import { SkySystem } from './SkySystem';
import { InterpolationBuffer } from './InterpolationBuffer';
import { getCharacterPreset, normalizeCharacterPreset } from '../characterPresets';
import type { ProjectileImpact } from './ProjectileManager';
import type { DbConnection } from '../module_bindings';
import type { GameSettings } from '../store';

// ── Chunk streaming config ──
const VIEW_DISTANCE = 24; // chunks (384 blocks)
const UNLOAD_BUFFER = 4; // extra chunks before unloading
const CHUNKS_PER_REQUEST = 8; // smooth request cadence to avoid frame spikes
const CHUNK_STREAM_INTERVAL_FRAMES = 2;
const CHUNK_REBUILD_BUDGET_MOVING = 2;
const CHUNK_REBUILD_BUDGET_IDLE = 6;
const CHUNK_REBUILD_BUDGET_BOOTSTRAP = 14;
const CHUNK_REQUEST_TIMEOUT_MS = 2000;
const NUM_CHUNKS_Y = Math.ceil(WORLD_Y / CHUNK);
const STARTUP_READY_RADIUS = 2;
const ENTITY_KIND_VEHICLE = 2;
const VEHICLE_TYPE_HELICOPTER = 0;
const VEHICLE_INPUT_INTERVAL_MS = 16;
const MAX_ACTIVE_LANTERN_LIGHTS = 6;
const MAX_ACTIVE_LANTERN_GLOWS = 180;
const LANTERN_LIGHT_REFRESH_INTERVAL = 0.25;
const LANTERN_LIGHT_MAX_DISTANCE = 36;
const LANTERN_LIGHT_KEEP_DISTANCE = 56;
const LANTERN_GLOW_MAX_DISTANCE = 190;
const HELI_CAMERA_DISTANCE = 14;
const HELI_CAMERA_HEIGHT = 5.2;
const HELI_PILOT_PITCH_MIN = -0.62;
const HELI_PILOT_PITCH_MAX = 0.42;
const HELI_MOUNT_RANGE = 8.5;
const HELI_HEALTH_MAX = 1000;

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
  reloadTime: number; // reload duration in seconds
}
const VEHICLE_WEAPONS: VehicleWeaponInfo[] = [
  { name: 'MINIGUN', fireRate: 15.0, maxAmmo: 300, maxRange: 100, projectileSpeed: 0, gravity: 0, radius: 0, spread: { x: 0.035, y: 0.02 }, color: '#ffaa00', reloadTime: 3.0 },
  { name: 'ROCKETS', fireRate: 2.5, maxAmmo: 16, maxRange: 120, projectileSpeed: 80, gravity: 3.0, radius: 6.0, spread: { x: 0, y: 0 }, color: '#ff4400', reloadTime: 2.5 },
];
const HELI_BREAKUP_GRAVITY = 22;

type HelicopterBreakupPiece = {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  ttl: number;
};

type ChunkOffset = { dx: number; dz: number; d2: number };
const STREAM_OFFSETS: ChunkOffset[] = (() => {
  const offsets: ChunkOffset[] = [];
  for (let dz = -VIEW_DISTANCE; dz <= VIEW_DISTANCE; dz++) {
    for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > VIEW_DISTANCE * VIEW_DISTANCE) continue;
      offsets.push({ dx, dz, d2 });
    }
  }
  offsets.sort((a, b) => a.d2 - b.d2);
  return offsets;
})();

const STARTUP_OFFSETS: ChunkOffset[] = (() => {
  const offsets: ChunkOffset[] = [];
  for (let dz = -STARTUP_READY_RADIUS; dz <= STARTUP_READY_RADIUS; dz++) {
    for (let dx = -STARTUP_READY_RADIUS; dx <= STARTUP_READY_RADIUS; dx++) {
      offsets.push({ dx, dz, d2: dx * dx + dz * dz });
    }
  }
  offsets.sort((a, b) => a.d2 - b.d2);
  return offsets;
})();

export interface DynamicLightOptions {
  type?: 'point' | 'spot';
  position: THREE.Vector3 | { x: number; y: number; z: number };
  color?: THREE.ColorRepresentation;
  intensity: number;
  distance: number;
  decay?: number;
  castShadow?: boolean;
  ttl?: number;
  direction?: THREE.Vector3 | { x: number; y: number; z: number };
  angle?: number;
  penumbra?: number;
  kind?: 'generic' | 'lantern' | 'helicopter';
}

export interface EngineState {
  weapon: number;
  loadout: [number, number, number];
  ammo: number;
  maxAmmo: number;
  weaponName: string;
  weaponColor: string;
  fps: number;
  locked: boolean;
  playerCount: number;
  health: number;
  kills: number;
  deaths: number;
  hitMarker: boolean;
  hitMarkerType: 'block' | 'player' | 'none';
  timeOfDay: string;
  weather: string;
  heading: number;
  isReloading: boolean;
  worldReady: boolean;
  worldLoadProgress: number;
  mountedVehicleName: string | null;
  vehicleAltitude: number;
  // Vehicle weapon HUD fields
  vehicleHealth: number;
  vehicleMaxHealth: number;
  vehicleWeapon: number;
  vehicleWeaponName: string;
  vehicleAmmo: number;
  vehicleMaxAmmo: number;
  vehicleSpeed: number;
  vehicleReloading: boolean;
  nearVehicle: boolean;
}

export class Engine {
  // Core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Systems
  private world: VoxelWorld;
  private controls: FPSControls;
  private weapons: WeaponSystem;
  private audio: AudioSystem;
  private vfx: VFX;
  private weaponModel: WeaponModel;
  private postfx: PostFX;
  private physics: PhysicsSystem;
  private projectileManager: ProjectileManager;

  // Server-authoritative grenade visuals (from GrenadeProjectile table)
  private grenadeVisuals: Map<bigint, {
    mesh: THREE.Mesh;
    light: THREE.PointLight | null;
    pos: THREE.Vector3;   // last known server position
    vel: THREE.Vector3;   // last known server velocity
    lastUpdateTime: number; // performance.now() of last server update
    trailTimer: number;    // accumulated time since last trail particle
  }> = new Map();

  // Lighting & Sky
  private sun: THREE.DirectionalLight;
  private moon: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private ambientLight: THREE.AmbientLight;
  private sky: SkySystem;

  // Dynamic runtime lights (gameplay/cinematics)
  private dynamicLights = new Map<string, {
    light: THREE.PointLight | THREE.SpotLight;
    target?: THREE.Object3D;
    ttl: number | null;
    kind: 'generic' | 'lantern' | 'helicopter';
    baseIntensity: number;
    phase: number;
  }>();
  private dynamicLightSeq = 0;
  private lanternPositionsByChunk = new Map<number, Array<{ x: number; y: number; z: number }>>();
  private activeLanternLights = new Map<string, string>();
  private lanternLightKeyById = new Map<string, string>();
  private lanternGlowTexture: THREE.CanvasTexture | null = null;
  private lanternGlowPoints: THREE.Points | null = null;
  private lanternGlowPositions = new Float32Array(MAX_ACTIVE_LANTERN_GLOWS * 3);
  private lanternGlowColors = new Float32Array(MAX_ACTIVE_LANTERN_GLOWS * 3);
  private lanternRefreshTimer = 0;
  private helicopterLightRigs = new Map<number, {
    portId: string;
    starboardId: string;
    bellyId: string;
  }>();
  private readonly tmpHeliPort = new THREE.Vector3();
  private readonly tmpHeliStarboard = new THREE.Vector3();
  private readonly tmpHeliBelly = new THREE.Vector3();

  // State
  private clock: THREE.Clock;
  private container: HTMLElement;
  private conn: DbConnection | null;
  private onStateChange: (state: EngineState) => void;
  private username: string | null;

  private frameCount = 0;
  private fpsTime = 0;
  private currentFps = 0;
  private animationId = 0;
  private mouseDown = false;
  private lastPositionUpdate = 0;
  private otherPlayers: Map<string, THREE.Group> = new Map();
  private interpBuffers: Map<string, InterpolationBuffer> = new Map();
  private localIdentity: string | null = null;
  private mountedVehicleId = 0;
  private lastVehicleInputUpdate = 0;
  private health = 100;
  private spawnProtected = false;
  private kills = 0;
  private deaths = 0;
  private hitMarkerTimer = 0;
  private hitMarkerType: 'block' | 'player' | 'none' = 'none';
  private lastWeaponIndex = 0;
  private prevKills = 0;
  private prevDeaths = 0;
  private lowHealthHeartbeatTimer = 0;
  private elapsedTime = 0;
  private baseFov = 75;
  private wasSliding = false;
  private relockAfterOverlay = false;
  chatOpen = false;
  private loadoutMenuOpen = false;
  private lastLocalWeaponSwitchAt = 0;
  private audioForward = new THREE.Vector3();
  private audioUp = new THREE.Vector3();

  // Chunk streaming
  private lastPlayerCx = -1;
  private lastPlayerCz = -1;
  private pendingChunkRequests = new Map<number, number>();
  private queuedChunkRequests = new Set<number>();
  private chunkRequestQueue: number[] = [];
  private bootstrapRequestQueue: number[] = [];
  private bootstrapQueued = new Set<number>();
  private bootstrapActive = true;
  private startupWorldReady = false;
  private startupProgressPrev = 0;
  private startupProgressStallTime = 0;
  private chunkLoadFrame = 0;
  private helicopters = new Map<number, THREE.Group>();
  private helicopterBuffers = new Map<number, InterpolationBuffer>();
  private helicopterBreakupPieces: HelicopterBreakupPiece[] = [];
  private pendingHelicopterDestroyFallbacks = new Map<number, number>();
  private recentHelicopterBreakups = new Map<number, number>();
  private suppressHelicopterDeleteFxUntil = 0;
  private lastHelicopterSyncAt = 0;
  // Smooth chase state for local pilot helicopter (bypasses InterpolationBuffer)
  private localHeliSmoothedPos = new THREE.Vector3();
  private localHeliSmoothedYaw = 0;
  private localHeliSmoothedPitch = 0;
  private localHeliSmoothedInitialized = false;
  private localHeliLastServerPos = new THREE.Vector3();
  private localHeliLastServerVel = new THREE.Vector3();
  private localHeliLastServerYaw = 0;
  private localHeliLastServerPitch = 0;
  private localHeliLastServerTime = 0; // performance.now() when last server snapshot received
  private mountedCameraPosition = new THREE.Vector3();
  private mountedCameraInitialized = false;
  private vehiclePilotYaw = 0;
  private vehiclePilotPitch = 0;
  private vehicleWeaponIndex = 0;
  private lastVehicleFireAt = 0;
  private vehicleAmmo: [number, number] = [300, 16]; // client-predicted ammo [minigun, rockets]
  private vehicleReloadingUntil: [number, number] = [0, 0]; // performance.now() timestamp when reload finishes per weapon
  private vehicleCameraDistance = HELI_CAMERA_DISTANCE; // adjustable via scroll wheel

  constructor(
    container: HTMLElement,
    conn: DbConnection | null,
    onStateChange: (state: EngineState) => void,
    localIdentity: string | null = null,
    username: string | null = null,
  ) {
    this.container = container;
    this.conn = conn;
    this.onStateChange = onStateChange;
    this.localIdentity = localIdentity;
    this.username = username;
    this.clock = new THREE.Clock();

    const w = container.clientWidth;
    const h = container.clientHeight;

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x5a5856);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    // ── Camera ──
    this.camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 800);

    // ── Scene ──
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x5a5856, 200, 500);

    // ── Lighting ──
    this.hemiLight = new THREE.HemisphereLight(0x8a8a95, 0x2a2218, 0.8);
    this.scene.add(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight(0x505058, 0.5);
    this.scene.add(this.ambientLight);

    this.sun = new THREE.DirectionalLight(0xffe0b0, 2.5);
    this.sun.position.set(50, 80, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.camera.left = -80;
    this.sun.shadow.camera.right = 80;
    this.sun.shadow.camera.top = 80;
    this.sun.shadow.camera.bottom = -80;
    this.sun.shadow.bias = 0;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x9bb4ff, 0.35);
    this.moon.position.set(-40, 60, -25);
    this.moon.castShadow = false;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    // ── Sky system (procedural sky, dynamic lighting, weather) ──
    this.sky = new SkySystem(this.scene, this.sun, this.moon, this.hemiLight, this.ambientLight);
    this.loadEnvironmentFromServer();

    // ── Voxel world (250×48×250) ──
    this.world = new VoxelWorld(WORLD_X, WORLD_Y, WORLD_Z);
    this.loadWorldFromServer();
    this.world.rebuildDirtyChunks(this.scene, 24);

    // ── Ground plane ──
    const groundGeo = new THREE.PlaneGeometry(2048, 2048);
    const groundMat = new THREE.MeshPhongMaterial({
      color: 0x4a4642,
      emissive: new THREE.Color(0x0d1422),
      emissiveIntensity: 0.26,
      shininess: 4,
      specular: new THREE.Color(0x111111),
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(WORLD_X / 2, -0.01, WORLD_Z / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // ── Spawn at world center ──
    const spawnX = WORLD_X / 2, spawnZ = WORLD_Z / 2;
    const spawnY = this.getGroundHeight(spawnX, spawnZ) + 2;
    this.camera.position.set(spawnX, spawnY, spawnZ);

    // ── Controls ──
    this.controls = new FPSControls(this.camera, container, WORLD_X, WORLD_Z);

    // ── Weapons ──
    this.weapons = new WeaponSystem(this.camera, this.world);
    this.weapons.setOtherPlayers(this.otherPlayers);
    this.weapons.setVehicles(this.helicopters);

    // ── Audio ──
    this.audio = new AudioSystem();
    this.audio.setOcclusionSampler((x: number, y: number, z: number) => this.world.getBlock(x, y, z) !== 0);
    this.audio.setListenerPose(this.camera.position, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });

    // ── VFX ──
    this.vfx = new VFX(this.scene, this.camera);

    // ── Physics ──
    this.physics = new PhysicsSystem(this.scene, this.world, this.vfx, this.audio);

    // ── Projectiles ──
    this.projectileManager = new ProjectileManager(
      this.scene, this.world, this.weapons, this.vfx, this.otherPlayers,
      (impact) => this.handleProjectileImpact(impact),
    );

    // ── Weapon Model ──
    this.weaponModel = new WeaponModel(w / h);

    // ── PostFX ──
    this.postfx = new PostFX();

    // ── Server sync ──
    this.setupServerListeners();

    // ── Input ──
    container.addEventListener('mousedown', this.onMouseDown);
    container.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousemove', this.onVehicleMouseMove);
    document.addEventListener('wheel', this.onVehicleWheel, { passive: true });
    window.addEventListener('resize', this.onResize);

    this.animate();
  }

  // ── SETTINGS ──

  updateSettings(settings: GameSettings): void {
    this.controls.sensitivity = settings.sensitivity;
    this.baseFov = settings.fov;
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setMasterVolume(settings.masterVolume);
    this.sun.castShadow = settings.shadowsEnabled;
    this.moon.castShadow = false;
    this.postfx.enabled = settings.postFXEnabled;
    this.controls.setSprintToggle(settings.sprintToggle);

    // Graphics quality presets
    if (settings.graphicsQuality === 'low') {
      this.renderer.setPixelRatio(1);
      this.sun.shadow.mapSize.set(512, 512);
    } else if (settings.graphicsQuality === 'medium') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      this.sun.shadow.mapSize.set(1024, 1024);
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.sun.shadow.mapSize.set(2048, 2048);
    }
  }

  /** Toggle fly mode (admin) */
  toggleFly(): void {
    this.controls.flyMode = !this.controls.flyMode;
  }

  /** Toggle chat mode — disables game keyboard input */
  setChatOpen(open: boolean): void {
    if (this.chatOpen === open) return;

    const hadOverlayOpen = this.chatOpen || this.loadoutMenuOpen;

    this.chatOpen = open;
    this.controls.inputEnabled = !(this.chatOpen || this.loadoutMenuOpen);
    this.weapons.setInputEnabled(!(this.chatOpen || this.loadoutMenuOpen));
    this.mouseDown = false;

    if (open) {
      if (!hadOverlayOpen) {
        this.relockAfterOverlay = this.controls.locked;
        if (this.controls.locked) this.controls.unlock();
      }
      this.controls.releaseAllInput();
      return;
    }

    if (!(this.chatOpen || this.loadoutMenuOpen)
      && this.relockAfterOverlay
      && !this.controls.locked
    ) {
      this.controls.lock();
    }

    if (!(this.chatOpen || this.loadoutMenuOpen)) {
      this.relockAfterOverlay = false;
    }
  }

  /** Toggle loadout menu mode — pauses gameplay input */
  setLoadoutMenuOpen(open: boolean): void {
    if (this.loadoutMenuOpen === open) return;

    const hadOverlayOpen = this.chatOpen || this.loadoutMenuOpen;

    this.loadoutMenuOpen = open;
    this.controls.inputEnabled = !(this.chatOpen || this.loadoutMenuOpen);
    this.weapons.setInputEnabled(!(this.chatOpen || this.loadoutMenuOpen));
    this.mouseDown = false;

    if (open) {
      if (!hadOverlayOpen) {
        this.relockAfterOverlay = this.controls.locked;
        if (this.controls.locked) this.controls.unlock();
      }
      this.controls.releaseAllInput();
      return;
    }

    if (!(this.chatOpen || this.loadoutMenuOpen)
      && this.relockAfterOverlay
      && !this.controls.locked
    ) {
      this.controls.lock();
    }

    if (!(this.chatOpen || this.loadoutMenuOpen)) {
      this.relockAfterOverlay = false;
    }
  }

  getLoadout(): [number, number, number] {
    return this.weapons.loadout;
  }

  setLoadout(loadout: [number, number, number], preferredWeapon?: number): boolean {
    const changed = this.weapons.setLoadout(loadout, preferredWeapon);
    if (!changed) return false;

    const weaponIdx = this.weapons.currentWeapon;
    this.weaponModel.switchWeapon(weaponIdx);
    this.lastWeaponIndex = weaponIdx;
    this.noteLocalWeaponSwitch();
    return true;
  }

  // ── INPUT ──

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && this.controls.locked) {
      this.mouseDown = true;
      if (this.mountedVehicleId !== 0) this.tryVehicleFire();
      else this.tryFire();
    }
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
  };
  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.chatOpen || this.loadoutMenuOpen) return;
    if (e.code === 'KeyF') {
      if (this.conn) this.conn.reducers.interactVehicle({});
      return;
    }
    if (e.code === 'KeyR') {
      if (this.mountedVehicleId !== 0) {
        this.startVehicleReload();
        return;
      }
      this.weapons.reload(); // Client prediction
      this.audio.playReload(this.localAudioSource(-0.15));
      // Server-authoritative reload
      if (this.conn) this.conn.reducers.reloadWeapon({});
    }
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      if (this.mountedVehicleId !== 0) {
        // Vehicle weapon switching: 1=Minigun, 2=Rockets
        const slot = parseInt(e.code.charAt(5), 10) - 1;
        if (slot >= 0 && slot < VEHICLE_WEAPONS.length && slot !== this.vehicleWeaponIndex) {
          this.vehicleWeaponIndex = slot;
          this.audio.playSwitch(this.localAudioSource(-0.1));
          // Sync to server
          if (this.conn) this.conn.reducers.switchVehicleWeapon({ weaponIndex: slot });
        }
        return;
      }
      const slot = parseInt(e.code.charAt(5), 10) - 1;
      const idx = this.weapons.switchToSlot(slot);
      if (idx !== this.lastWeaponIndex) {
        this.weaponModel.switchWeapon(idx);
        this.audio.playSwitch(this.localAudioSource(-0.1));
        this.lastWeaponIndex = idx;
        this.noteLocalWeaponSwitch();
      }
    }
  };

  private onVehicleMouseMove = (event: MouseEvent): void => {
    if (this.mountedVehicleId === 0 || !this.controls.locked) return;
    this.vehiclePilotYaw -= event.movementX * this.controls.sensitivity;
    this.vehiclePilotPitch -= event.movementY * this.controls.sensitivity;
    this.vehiclePilotPitch = Math.max(HELI_PILOT_PITCH_MIN, Math.min(HELI_PILOT_PITCH_MAX, this.vehiclePilotPitch));
    // Wrap to [-PI, PI]
    if (this.vehiclePilotYaw > Math.PI) this.vehiclePilotYaw -= Math.PI * 2;
    if (this.vehiclePilotYaw < -Math.PI) this.vehiclePilotYaw += Math.PI * 2;
  };
  private onVehicleWheel = (e: WheelEvent): void => {
    if (this.mountedVehicleId === 0) return;
    const ZOOM_MIN = 6;
    const ZOOM_MAX = 30;
    const ZOOM_STEP = 2;
    if (e.deltaY > 0) {
      this.vehicleCameraDistance = Math.min(ZOOM_MAX, this.vehicleCameraDistance + ZOOM_STEP);
    } else if (e.deltaY < 0) {
      this.vehicleCameraDistance = Math.max(ZOOM_MIN, this.vehicleCameraDistance - ZOOM_STEP);
    }
  };

  private toVec3(v: THREE.Vector3 | { x: number; y: number; z: number }): THREE.Vector3 {
    return v instanceof THREE.Vector3 ? v : new THREE.Vector3(v.x, v.y, v.z);
  }

  /** Runtime light source API for gameplay objects and cinematics. Returns light id. */
  addDynamicLight(options: DynamicLightOptions): string {
    const id = `dyn-${++this.dynamicLightSeq}`;
    const type = options.type ?? 'point';
    const color = options.color ?? 0xffffff;
    const decay = options.decay ?? 2;
    const kind = options.kind ?? 'generic';
    const phase = Math.random() * Math.PI * 2;

    if (type === 'spot') {
      const light = new THREE.SpotLight(
        color,
        options.intensity,
        options.distance,
        options.angle ?? Math.PI / 6,
        options.penumbra ?? 0.35,
        decay,
      );
      light.castShadow = options.castShadow ?? false;
      light.position.copy(this.toVec3(options.position));
      const target = new THREE.Object3D();
      const direction = this.toVec3(options.direction ?? { x: 0, y: -1, z: 0 }).normalize();
      target.position.copy(light.position).add(direction);
      light.target = target;
      this.scene.add(target);
      this.scene.add(light);
      this.dynamicLights.set(id, {
        light,
        target,
        ttl: options.ttl ?? null,
        kind,
        baseIntensity: options.intensity,
        phase,
      });
      return id;
    }

    const light = new THREE.PointLight(color, options.intensity, options.distance, decay);
    light.castShadow = options.castShadow ?? false;
    light.position.copy(this.toVec3(options.position));
    this.scene.add(light);
    this.dynamicLights.set(id, {
      light,
      ttl: options.ttl ?? null,
      kind,
      baseIntensity: options.intensity,
      phase,
    });
    return id;
  }

  updateDynamicLight(id: string, patch: Partial<DynamicLightOptions>): void {
    const entry = this.dynamicLights.get(id);
    if (!entry) return;
    const light = entry.light;

    if (patch.position) light.position.copy(this.toVec3(patch.position));
    if (patch.color !== undefined) light.color.set(patch.color);
    if (patch.intensity !== undefined) {
      light.intensity = patch.intensity;
      entry.baseIntensity = patch.intensity;
    }
    if (patch.distance !== undefined) light.distance = patch.distance;
    if (patch.decay !== undefined) light.decay = patch.decay;
    if (patch.castShadow !== undefined) light.castShadow = patch.castShadow;
    if (patch.ttl !== undefined) entry.ttl = patch.ttl;
    if (patch.kind !== undefined) entry.kind = patch.kind;

    if (light instanceof THREE.SpotLight) {
      if (patch.angle !== undefined) light.angle = patch.angle;
      if (patch.penumbra !== undefined) light.penumbra = patch.penumbra;
      if (patch.direction && entry.target) {
        const dir = this.toVec3(patch.direction).normalize();
        entry.target.position.copy(light.position).add(dir);
        entry.target.updateMatrixWorld();
      }
    }
  }

  removeDynamicLight(id: string): void {
    const entry = this.dynamicLights.get(id);
    if (!entry) return;
    const lanternKey = this.lanternLightKeyById.get(id);
    if (lanternKey) {
      this.activeLanternLights.delete(lanternKey);
      this.lanternLightKeyById.delete(id);
    }
    this.scene.remove(entry.light);
    if (entry.target) {
      this.scene.remove(entry.target);
      if (entry.light instanceof THREE.SpotLight) entry.light.target = entry.light;
    }
    entry.light.dispose();
    this.dynamicLights.delete(id);
  }

  private updateDynamicLights(delta: number): void {
    const sunVisibility = this.sky.getSunVisibility();
    const lanternVisibility = this.getLanternVisibilityFromSun(sunVisibility);

    this.lanternRefreshTimer -= delta;
    if (this.lanternRefreshTimer <= 0) {
      this.lanternRefreshTimer = LANTERN_LIGHT_REFRESH_INTERVAL;
      this.refreshLanternLights(lanternVisibility);
    }

    for (const [id, entry] of this.dynamicLights) {
      if (entry.kind === 'lantern') {
        const glow = 0.94 + 0.06 * Math.sin(this.elapsedTime * 2.4 + entry.phase);
        const targetIntensity = entry.baseIntensity * lanternVisibility * glow;
        const blend = Math.min(1, delta * 5.5);
        entry.light.intensity += (targetIntensity - entry.light.intensity) * blend;
      }

      if (entry.ttl === null) continue;
      entry.ttl -= delta;
      if (entry.ttl <= 0) this.removeDynamicLight(id);
    }
  }

  private getLanternVisibilityFromSun(sunVisibility: number): number {
    // Keep lanterns fully off during most of daytime.
    // Fade-in starts near dusk and reaches full at night.
    const t = THREE.MathUtils.clamp((0.24 - sunVisibility) / 0.2, 0, 1);
    return t * t * (3 - 2 * t);
  }

  private clearLanternLightsForChunk(chunkId: number): void {
    const positions = this.lanternPositionsByChunk.get(chunkId);
    if (!positions) return;
    for (const pos of positions) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      const id = this.activeLanternLights.get(key);
      if (!id) continue;
      this.removeDynamicLight(id);
    }
    this.lanternPositionsByChunk.delete(chunkId);
  }

  private syncLanternLightsForChunk(cx: number, cy: number, cz: number, chunkBlocks?: Uint8Array): void {
    const chunkId = packChunkId(cx, cy, cz);
    this.clearLanternLightsForChunk(chunkId);

    const baseX = cx * CHUNK;
    const baseY = cy * CHUNK;
    const baseZ = cz * CHUNK;
    const positions: { x: number; y: number; z: number }[] = [];

    for (let lx = 0; lx < CHUNK; lx++) {
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lz = 0; lz < CHUNK; lz++) {
          const wx = baseX + lx;
          const wy = baseY + ly;
          const wz = baseZ + lz;
          const localIdx = lx + ly * CHUNK + lz * CHUNK * CHUNK;
          const blockType = chunkBlocks
            ? chunkBlocks[localIdx]
            : this.world.getBlock(wx, wy, wz);
          if (blockType !== BlockType.Lantern) continue;

          positions.push({ x: wx, y: wy, z: wz });
        }
      }
    }

    if (positions.length > 0) this.lanternPositionsByChunk.set(chunkId, positions);
    this.lanternRefreshTimer = 0;
  }

  private refreshLanternLights(lanternVisibility: number): void {
    if (lanternVisibility <= 0.001) {
      for (const id of Array.from(this.activeLanternLights.values())) this.removeDynamicLight(id);
      this.activeLanternLights.clear();
      this.clearLanternGlows();
      return;
    }

    const addDistance2 = LANTERN_LIGHT_MAX_DISTANCE * LANTERN_LIGHT_MAX_DISTANCE;
    const keepDistance2 = LANTERN_LIGHT_KEEP_DISTANCE * LANTERN_LIGHT_KEEP_DISTANCE;
    const chunkRadius = Math.ceil(LANTERN_LIGHT_KEEP_DISTANCE / CHUNK) + 1;
    const playerCx = Math.floor(THREE.MathUtils.clamp(this.camera.position.x, 0, WORLD_X - 1) / CHUNK);
    const playerCy = Math.floor(THREE.MathUtils.clamp(this.camera.position.y, 0, WORLD_Y - 1) / CHUNK);
    const playerCz = Math.floor(THREE.MathUtils.clamp(this.camera.position.z, 0, WORLD_Z - 1) / CHUNK);
    const addCandidates: Array<{ key: string; x: number; y: number; z: number; d2: number }> = [];
    const keepCandidates = new Map<string, { key: string; x: number; y: number; z: number; d2: number }>();

    for (const [chunkId, positions] of this.lanternPositionsByChunk) {
      const [cx, cy, cz] = unpackChunkId(chunkId);
      if (Math.abs(cx - playerCx) > chunkRadius) continue;
      if (Math.abs(cy - playerCy) > chunkRadius) continue;
      if (Math.abs(cz - playerCz) > chunkRadius) continue;

      for (const pos of positions) {
        const dx = pos.x + 0.5 - this.camera.position.x;
        const dy = pos.y + 0.6 - this.camera.position.y;
        const dz = pos.z + 0.5 - this.camera.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;

        const candidate = {
          key: `${pos.x},${pos.y},${pos.z}`,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          d2,
        };

        if (d2 <= keepDistance2) keepCandidates.set(candidate.key, candidate);
        if (d2 <= addDistance2) addCandidates.push(candidate);
      }
    }

    if (keepCandidates.size === 0 && addCandidates.length === 0) {
      for (const id of Array.from(this.activeLanternLights.values())) this.removeDynamicLight(id);
      this.activeLanternLights.clear();
      this.clearLanternGlows();
      return;
    }

    addCandidates.sort((a, b) => a.d2 - b.d2);
    const candidateByKey = new Map<string, { key: string; x: number; y: number; z: number; d2: number }>();
    for (const c of addCandidates) candidateByKey.set(c.key, c);
    for (const [k, c] of keepCandidates) {
      if (!candidateByKey.has(k)) candidateByKey.set(k, c);
    }

    const wanted = new Set<string>();
    const count = Math.min(MAX_ACTIVE_LANTERN_LIGHTS, candidateByKey.size);

    for (const key of this.activeLanternLights.keys()) {
      if (wanted.size >= count) break;
      if (!keepCandidates.has(key)) continue;
      wanted.add(key);
    }

    for (let i = 0; i < addCandidates.length && wanted.size < count; i++) {
      wanted.add(addCandidates[i]!.key);
    }

    for (const key of wanted) {
      const c = candidateByKey.get(key);
      if (!c) continue;

      const hash = ((c.x * 73856093) ^ (c.y * 19349663) ^ (c.z * 83492791)) >>> 0;
      const warmJitter = hash % 3;
      const color = warmJitter === 0 ? 0xffba63 : warmJitter === 1 ? 0xffca7f : 0xffa94f;

      let id = this.activeLanternLights.get(c.key);
      if (!id || !this.dynamicLights.has(id)) {
        id = this.addDynamicLight({
          kind: 'lantern',
          type: 'point',
          position: { x: c.x + 0.5, y: c.y + 0.62, z: c.z + 0.5 },
          color,
          intensity: 4.8 * lanternVisibility,
          distance: 28,
          decay: 1.45,
        });
        this.activeLanternLights.set(c.key, id);
        this.lanternLightKeyById.set(id, c.key);
      } else {
        this.updateDynamicLight(id, {
          position: { x: c.x + 0.5, y: c.y + 0.62, z: c.z + 0.5 },
          color,
          intensity: 4.8 * lanternVisibility,
          distance: 28,
          decay: 1.45,
        });
      }
    }

    for (const [key, id] of Array.from(this.activeLanternLights.entries())) {
      if (wanted.has(key)) continue;
      this.removeDynamicLight(id);
      this.activeLanternLights.delete(key);
    }

    this.refreshLanternGlows(lanternVisibility);
  }

  private createLanternGlowTexture(): THREE.CanvasTexture {
    if (this.lanternGlowTexture) return this.lanternGlowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      this.lanternGlowTexture = tex;
      return tex;
    }

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 240, 180, 1.0)');
    gradient.addColorStop(0.25, 'rgba(255, 200, 110, 0.8)');
    gradient.addColorStop(0.55, 'rgba(255, 150, 70, 0.45)');
    gradient.addColorStop(1, 'rgba(255, 120, 30, 0.0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.lanternGlowTexture = tex;
    return tex;
  }

  private ensureLanternGlowPoints(): void {
    if (this.lanternGlowPoints) return;
    const texture = this.createLanternGlowTexture();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.lanternGlowPositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.lanternGlowColors, 3));
    geometry.setDrawRange(0, 0);

    const material = new THREE.PointsMaterial({
      map: texture,
      size: 6.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      fog: true,
      alphaTest: 0.02,
    });

    this.lanternGlowPoints = new THREE.Points(geometry, material);
    this.lanternGlowPoints.renderOrder = 3;
    this.scene.add(this.lanternGlowPoints);
  }

  private clearLanternGlows(): void {
    if (!this.lanternGlowPoints) return;
    this.lanternGlowPoints.geometry.setDrawRange(0, 0);
    const posAttr = this.lanternGlowPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = this.lanternGlowPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  private refreshLanternGlows(lanternVisibility: number): void {
    this.ensureLanternGlowPoints();
    if (!this.lanternGlowPoints) return;

    if (lanternVisibility <= 0.001) {
      this.clearLanternGlows();
      return;
    }

    const maxGlowD2 = LANTERN_GLOW_MAX_DISTANCE * LANTERN_GLOW_MAX_DISTANCE;
    const chunkRadius = Math.ceil(LANTERN_GLOW_MAX_DISTANCE / CHUNK) + 1;
    const playerCx = Math.floor(THREE.MathUtils.clamp(this.camera.position.x, 0, WORLD_X - 1) / CHUNK);
    const playerCy = Math.floor(THREE.MathUtils.clamp(this.camera.position.y, 0, WORLD_Y - 1) / CHUNK);
    const playerCz = Math.floor(THREE.MathUtils.clamp(this.camera.position.z, 0, WORLD_Z - 1) / CHUNK);

    const farNearest: Array<{ x: number; y: number; z: number; d2: number }> = [];
    let worstD2 = -1;
    let worstIndex = -1;

    for (const [chunkId, positions] of this.lanternPositionsByChunk) {
      const [cx, cy, cz] = unpackChunkId(chunkId);
      if (Math.abs(cx - playerCx) > chunkRadius) continue;
      if (Math.abs(cy - playerCy) > chunkRadius) continue;
      if (Math.abs(cz - playerCz) > chunkRadius) continue;

      for (const pos of positions) {
        const dx = pos.x + 0.5 - this.camera.position.x;
        const dy = pos.y + 0.72 - this.camera.position.y;
        const dz = pos.z + 0.5 - this.camera.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxGlowD2) continue;

        const candidate = { x: pos.x, y: pos.y, z: pos.z, d2 };
        if (farNearest.length < MAX_ACTIVE_LANTERN_GLOWS) {
          farNearest.push(candidate);
          if (d2 > worstD2) {
            worstD2 = d2;
            worstIndex = farNearest.length - 1;
          }
          continue;
        }

        if (worstIndex >= 0 && d2 < worstD2) {
          farNearest[worstIndex] = candidate;
          worstD2 = farNearest[0]!.d2;
          worstIndex = 0;
          for (let i = 1; i < farNearest.length; i++) {
            if (farNearest[i]!.d2 > worstD2) {
              worstD2 = farNearest[i]!.d2;
              worstIndex = i;
            }
          }
        }
      }
    }

    farNearest.sort((a, b) => a.d2 - b.d2);

    let outCount = 0;
    for (let i = 0; i < farNearest.length && outCount < MAX_ACTIVE_LANTERN_GLOWS; i++) {
      const c = farNearest[i]!;

      const dist = Math.sqrt(c.d2);
      const nearFade = 1 - THREE.MathUtils.clamp(dist / LANTERN_GLOW_MAX_DISTANCE, 0, 1);
      const pulse = 0.9 + 0.1 * Math.sin(this.elapsedTime * 2.2 + i * 0.7);
      const alpha = (0.04 + nearFade * 0.56) * lanternVisibility * pulse;
      const hash = ((c.x * 928371 + c.z * 364479 + c.y * 1129) >>> 0) % 3;
      const baseR = hash === 0 ? 1.0 : hash === 1 ? 0.98 : 0.95;
      const baseG = hash === 0 ? 0.80 : hash === 1 ? 0.73 : 0.62;
      const baseB = hash === 0 ? 0.45 : hash === 1 ? 0.35 : 0.22;

      const p = outCount * 3;
      this.lanternGlowPositions[p] = c.x + 0.5;
      this.lanternGlowPositions[p + 1] = c.y + 0.72;
      this.lanternGlowPositions[p + 2] = c.z + 0.5;

      this.lanternGlowColors[p] = baseR * alpha;
      this.lanternGlowColors[p + 1] = baseG * alpha;
      this.lanternGlowColors[p + 2] = baseB * alpha;
      outCount++;
    }

    const geometry = this.lanternGlowPoints.geometry;
    geometry.setDrawRange(0, outCount);
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  private ensureHelicopterLightRig(entityId: number, mesh: THREE.Group): void {
    if (this.helicopterLightRigs.has(entityId)) return;

    const portId = this.addDynamicLight({
      kind: 'helicopter',
      type: 'point',
      position: mesh.position.clone(),
      color: 0xff3d3d,
      intensity: 0.85,
      distance: 14,
      decay: 1.9,
    });
    const starboardId = this.addDynamicLight({
      kind: 'helicopter',
      type: 'point',
      position: mesh.position.clone(),
      color: 0x4cff83,
      intensity: 0.85,
      distance: 14,
      decay: 1.9,
    });
    const bellyId = this.addDynamicLight({
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

  private removeHelicopterLightRig(entityId: number): void {
    const rig = this.helicopterLightRigs.get(entityId);
    if (!rig) return;

    this.removeDynamicLight(rig.portId);
    this.removeDynamicLight(rig.starboardId);
    this.removeDynamicLight(rig.bellyId);
    this.helicopterLightRigs.delete(entityId);
  }

  private updateHelicopterLightRig(entityId: number, mesh: THREE.Group): void {
    const rig = this.helicopterLightRigs.get(entityId);
    if (!rig) return;

    const sunVisibility = this.sky.getSunVisibility();
    const nightFactor = THREE.MathUtils.clamp(1 - sunVisibility, 0, 1);
    const navPulse = 0.75 + 0.25 * Math.sin(this.elapsedTime * 7.5 + entityId);

    // Coordinates rotated by PI/2 around Y to match the orient wrapper:
    // original (x,y,z) → (z, y, -x)
    this.tmpHeliPort.set(-1.44, 2.38, -5.0).applyMatrix4(mesh.matrixWorld);
    this.tmpHeliStarboard.set(1.44, 2.38, -5.0).applyMatrix4(mesh.matrixWorld);
    this.tmpHeliBelly.set(0, 1.18, 0.1).applyMatrix4(mesh.matrixWorld);

    this.updateDynamicLight(rig.portId, {
      position: this.tmpHeliPort,
      intensity: 0.18 + nightFactor * 0.92,
      distance: 10 + nightFactor * 8,
    });
    this.updateDynamicLight(rig.starboardId, {
      position: this.tmpHeliStarboard,
      intensity: 0.18 + nightFactor * 0.92,
      distance: 10 + nightFactor * 8,
    });
    this.updateDynamicLight(rig.bellyId, {
      position: this.tmpHeliBelly,
      intensity: (0.15 + nightFactor * 1.2) * navPulse,
      distance: 8 + nightFactor * 14,
    });
  }

  private playRemoteWeaponAudio(weaponIdx: number, origin: THREE.Vector3, direction: THREE.Vector3): void {
    const spatial = {
      position: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
    };

    if (weaponIdx === 0) this.audio.playRifle(spatial);
    else if (weaponIdx === 1) this.audio.playShotgun(spatial);
    else if (weaponIdx === 2) this.audio.playRPGLaunch(spatial);
    else if (weaponIdx === 3) this.audio.playMachineGun(spatial);
    else if (weaponIdx === 4) this.audio.playGrenadeLaunch(spatial);
    // Vehicle weapons (100+ namespace)
    else if (weaponIdx === 100) this.audio.playMachineGun(spatial); // Minigun
    else if (weaponIdx === 101) this.audio.playRPGLaunch(spatial);  // Rockets
  }

  private localAudioSource(heightOffset = 0): {
    position: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    getPosition: () => { x: number; y: number; z: number };
    getDirection: () => { x: number; y: number; z: number };
  } {
    const getDirection = (): { x: number; y: number; z: number } => {
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      return { x: forward.x, y: forward.y, z: forward.z };
    };
    const getPosition = (): { x: number; y: number; z: number } => ({
      x: this.camera.position.x,
      y: this.camera.position.y + heightOffset,
      z: this.camera.position.z,
    });
    const direction = getDirection();
    const position = getPosition();

    return {
      position,
      direction,
      getPosition,
      getDirection,
    };
  }

  private noteLocalWeaponSwitch(): void {
    this.lastLocalWeaponSwitchAt = performance.now();
    this.lastPositionUpdate = 0;
    this.sendPositionUpdate();
  }

  private getServerCurrentWeapon(): number | undefined {
    if (!this.conn || !this.localIdentity) return undefined;

    for (const row of this.conn.db.player.iter()) {
      const player = row as any;
      if (player.identity.toHexString() !== this.localIdentity) continue;
      return player.currentWeapon as number;
    }

    return undefined;
  }

  private applyLoadoutRow(row: any): void {
    if (!this.username) return;
    if (row.username !== this.username) return;

    const slot1 = Number(row.slot1);
    const slot2 = Number(row.slot2);
    const slot3 = Number(row.slot3);
    if (![slot1, slot2, slot3].every((v) => Number.isInteger(v))) return;

    this.setLoadout([slot1, slot2, slot3], this.getServerCurrentWeapon());
  }

  // ── FIRE ──

  private tryFire(): void {
    if (this.mountedVehicleId !== 0) return;
    if (this.health <= 0) return; // Dead — cannot fire
    if (this.spawnProtected) return; // Spawn protected — cannot fire yet
    if (this.weapons.weapon.ammo <= 0) {
      this.audio.playEmpty(this.localAudioSource(-0.1));
      return;
    }

    const result = this.weapons.fire();
    if (!result) return;

    const isRifle = result.weaponIndex === 0;
    const isShotgun = result.weaponIndex === 1;
    const isRPG = result.weaponIndex === 2;
    const isMachineGun = result.weaponIndex === 3;
    const isGrenade = result.weaponIndex === 4;

    // Audio (always plays on fire)
    const localShotAudio = this.localAudioSource(-0.1);
    if (isRifle) this.audio.playRifle(localShotAudio);
    else if (isShotgun) this.audio.playShotgun(localShotAudio);
    else if (isRPG) this.audio.playRPGLaunch(localShotAudio);
    else if (isMachineGun) this.audio.playMachineGun(localShotAudio);
    else if (isGrenade) this.audio.playGrenadeLaunch(localShotAudio);

    // Muzzle flash + shake + recoil (always)
    this.vfx.emitMuzzleFlash();
    this.vfx.shake(isGrenade ? 0.55 : isRPG ? 0.5 : isShotgun ? 0.8 : isMachineGun ? 0.25 : 0.3);
    this.weaponModel.triggerRecoil(WEAPONS[result.weaponIndex].recoil);

    if (result.isProjectile) {
      // ── PROJECTILE PATH ──
      if (result.weaponIndex === 4) {
        // Grenade launcher: server-authoritative. Don't spawn local projectile.
        // Just sync fire to server; the GrenadeProjectile table row will render it.
        this.syncFireToServer(result);
        return;
      }
      // Spawn projectile, sync fire (ammo deduction only, no hits)
      const spawned = this.projectileManager.spawnLocal(result.weaponIndex, result.origin, result.direction);
      if (!spawned) {
        WEAPONS[result.weaponIndex].ammo++;
        return;
      }
      this.syncFireToServer(result);
      return;
    }

    // ── HITSCAN PATH (unchanged) ──

    // Tracer (hitscan primaries)
    if ((isRifle || isMachineGun) && result.tracerEnd) {
      const from = this.camera.position.clone()
        .add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion));
      this.vfx.emitTracer(from, result.tracerEnd, isMachineGun ? 0x99eeff : 0x88bbff);
    }

    // Block hit
    if (result.hitPos) {
      const hitAudioPos = { x: result.hitPos.x + 0.5, y: result.hitPos.y + 0.5, z: result.hitPos.z + 0.5 };
      this.audio.playBlockBreak({ position: hitAudioPos });
      this.hitMarkerTimer = 0.15;
      this.hitMarkerType = 'block';

      // Debris particles (cap for perf)
      const blocks = result.destroyedBlocks;
      const max = isGrenade ? 24 : isRPG ? 15 : isShotgun ? 8 : blocks.length;
      const sampled = blocks.length > max
        ? blocks.sort(() => Math.random() - 0.5).slice(0, max) : blocks;
      for (const b of sampled) {
        this.vfx.emitBlockDebris(b.x, b.y, b.z, BLOCK_COLORS[b.blockType] || 0x808080);
      }
      this.vfx.emitImpact(result.hitPos.x, result.hitPos.y, result.hitPos.z);

      // Explosion
      if (WEAPONS[result.weaponIndex].radius > 0) {
        const explosionRadius = WEAPONS[result.weaponIndex].radius;
        const explosionDamage = WEAPONS[result.weaponIndex].damage;
        this.vfx.emitExplosion(result.hitPos.x, result.hitPos.y, result.hitPos.z, explosionRadius);
        const explosionAudioPos = { x: result.hitPos.x + 0.5, y: result.hitPos.y + 0.5, z: result.hitPos.z + 0.5 };
        if (isRPG || isGrenade) {
          setTimeout(() => this.audio.playExplosion({ position: explosionAudioPos }), 80);
        } else {
          this.audio.playExplosion({ position: explosionAudioPos });
        }
        this.applyExplosionCameraEffects(
          result.hitPos.x,
          result.hitPos.y,
          result.hitPos.z,
          explosionRadius,
          explosionDamage,
        );
      }
    }

    // Player hit marker
    if (result.hitPlayerIds.length > 0) {
      this.hitMarkerTimer = 0.2;
      this.hitMarkerType = 'player';
      this.audio.playHitMarker();
    }

    // Server sync: unified fire_weapon reducer with hit players and blocks
    this.syncFireToServer(result);

    // Explosion physics: knockback + flying debris + force on existing falling blocks
    if (result.hitPos && WEAPONS[result.weaponIndex].radius > 0) {
      const w = WEAPONS[result.weaponIndex];
      const hx = result.hitPos.x, hy = result.hitPos.y, hz = result.hitPos.z;

      // Player knockback (rocket jumping etc.)
      this.applyExplosionKnockback(hx, hy, hz, w.radius, w.damage);

      // Spawn destroyed blocks as flying physics debris
      if (result.destroyedBlocks.length > 0) {
        this.physics.spawnExplosionDebris(result.destroyedBlocks, hx, hy, hz, w.radius, w.damage * 0.2);
      }

      // Push already-falling blocks
      this.physics.applyExplosionForce(hx, hy, hz, w.radius * 2, w.damage * 1.5);
    }

    // Rebuild affected chunks
    this.world.rebuildDirtyChunks(this.scene);
  }

  // ── VEHICLE RELOAD ──

  private startVehicleReload(): void {
    const idx = this.vehicleWeaponIndex;
    const wep = VEHICLE_WEAPONS[idx];
    if (!wep) return;

    // Already reloading this weapon?
    const now = performance.now();
    if (this.vehicleReloadingUntil[idx] > now) return;

    // Already full?
    if (this.vehicleAmmo[idx] >= wep.maxAmmo) return;

    // Start reload timer
    this.vehicleReloadingUntil[idx] = now + wep.reloadTime * 1000;

    // Play reload sound
    this.audio.playReload(this.localAudioSource(-0.15));

    // Tell server to reload (server applies instantly; client waits for timer)
    if (this.conn) this.conn.reducers.reloadVehicleWeapon({});
  }

  private tickVehicleReload(): void {
    const now = performance.now();
    for (let i = 0; i < VEHICLE_WEAPONS.length; i++) {
      if (this.vehicleReloadingUntil[i] > 0 && now >= this.vehicleReloadingUntil[i]) {
        // Reload timer expired — client-predict ammo refill
        this.vehicleAmmo[i] = VEHICLE_WEAPONS[i].maxAmmo;
        this.vehicleReloadingUntil[i] = 0;
      }
    }
  }

  // ── VEHICLE FIRE ──

  private tryVehicleFire(): void {
    if (this.mountedVehicleId === 0) return;
    if (this.health <= 0) return;
    if (!this.conn) return;

    const wep = VEHICLE_WEAPONS[this.vehicleWeaponIndex];
    if (!wep) return;

    // Fire rate cooldown
    const now = performance.now();
    const cooldown = 1000 / wep.fireRate;
    if (now - this.lastVehicleFireAt < cooldown) return;

    // Block firing while reloading
    if (this.vehicleReloadingUntil[this.vehicleWeaponIndex] > now) return;

    // Ammo check (client prediction) — auto-reload when empty
    if (this.vehicleAmmo[this.vehicleWeaponIndex] <= 0) {
      this.startVehicleReload();
      return;
    }

    this.lastVehicleFireAt = now;
    this.vehicleAmmo[this.vehicleWeaponIndex]--; // Client prediction

    // Compute fire origin and direction from pilot aim (camera look direction)
    const lookYaw = this.vehiclePilotYaw;
    const lookPitch = this.vehiclePilotPitch;
    const cosPitch = Math.cos(lookPitch);
    const dir = new THREE.Vector3(
      -Math.sin(lookYaw) * cosPitch,
      Math.sin(lookPitch),
      -Math.cos(lookYaw) * cosPitch,
    ).normalize();

    // Apply spread for minigun
    if (wep.spread.x > 0 || wep.spread.y > 0) {
      dir.x += (Math.random() - 0.5) * wep.spread.x * 2;
      dir.y += (Math.random() - 0.5) * wep.spread.y * 2;
      dir.z += (Math.random() - 0.5) * wep.spread.x * 2;
      dir.normalize();
    }

    // Origin: helicopter position (nose area)
    const pose = this.getMountedVehiclePose();
    if (!pose) return;
    const origin = new THREE.Vector3(
      pose.x + dir.x * 3.5,
      pose.y + 1.0,
      pose.z + dir.z * 3.5,
    );

    const isHitscan = wep.projectileSpeed === 0;

    if (!isHitscan) {
      // ── PROJECTILE PATH (Rockets) ──
      // Spawn client-side vehicle projectile using RPG config for visuals
      const spawned = this.projectileManager.spawnLocalVehicle(
        2, origin, dir,
        this.vehicleWeaponIndex, this.mountedVehicleId,
      );
      if (spawned) {
        // Visual uses RPG projectile config; destruction shape handled by vehicle oblate spheroid
      }

      // Sync to server
      this.syncVehicleFireToServer(origin, dir, [], [], []);

      // Audio + VFX
      this.audio.playRPGLaunch(this.localAudioSource(-0.1));
      this.vfx.emitMuzzleFlashAt(origin, dir, 0xff4400);
      this.vfx.shake(0.6);
      return;
    }

    // ── HITSCAN PATH (Minigun) ──
    const hit = this.weapons.raycastVoxels(origin, dir, wep.maxRange);

    const destroyed: { x: number; y: number; z: number; blockType: number }[] = [];
    const tracerEnd = hit
      ? new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
      : origin.clone().add(dir.clone().multiplyScalar(wep.maxRange));

    if (hit) {
      if (wep.radius > 0) {
        // Explosive hitscan (shouldn't happen for minigun, but handle it)
        const r = wep.radius;
        const r2 = r * r;
        for (let bx = Math.floor(hit.x - r); bx <= Math.ceil(hit.x + r); bx++) {
          for (let by = Math.floor(hit.y - r); by <= Math.ceil(hit.y + r); by++) {
            for (let bz = Math.floor(hit.z - r); bz <= Math.ceil(hit.z + r); bz++) {
              const ddx = bx - hit.x, ddy = by - hit.y, ddz = bz - hit.z;
              if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) {
                const bt = this.world.getBlock(bx, by, bz);
                if (bt !== 0) {
                  this.weapons.trackPendingDestruction(bx, by, bz, bt);
                  this.world.setBlock(bx, by, bz, 0);
                  destroyed.push({ x: bx, y: by, z: bz, blockType: bt });
            }
          }
            }
          }
        }
      } else {
        // Single block destruction (minigun)
        const bt = this.world.getBlock(hit.x, hit.y, hit.z);
        if (bt !== 0) {
          this.weapons.trackPendingDestruction(hit.x, hit.y, hit.z, bt);
          this.world.setBlock(hit.x, hit.y, hit.z, 0);
          destroyed.push({ x: hit.x, y: hit.y, z: hit.z, blockType: bt });
        }
      }
    }

    // Player hit detection
    const hitPlayerIds = this.weapons.raycastPlayers(origin, dir, wep.maxRange);
    const hitVehicleIds = this.weapons.raycastVehicles(origin, dir, wep.maxRange);

    // VFX: tracer + muzzle flash
    this.vfx.emitTracer(origin, tracerEnd, 0xffaa00);
    this.vfx.emitMuzzleFlashAt(origin, dir, 0xffaa00);

    // VFX: impact
    if (hit) {
      this.vfx.emitImpact(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      this.hitMarkerTimer = 0.12;
      this.hitMarkerType = 'block';

      // Debris particles
      const max = 4;
      const sampled = destroyed.length > max
        ? destroyed.sort(() => Math.random() - 0.5).slice(0, max) : destroyed;
      for (const b of sampled) {
        this.vfx.emitBlockDebris(b.x, b.y, b.z, BLOCK_COLORS[b.blockType] || 0x808080);
      }
    }

    // Player hit marker
    if (hitPlayerIds.length > 0) {
      this.hitMarkerTimer = 0.2;
      this.hitMarkerType = 'player';
      this.audio.playHitMarker();
    }

    // Audio: minigun burst
    this.audio.playMachineGun(this.localAudioSource(-0.1));
    this.vfx.shake(0.15);

    // Sync to server
    this.syncVehicleFireToServer(
      origin,
      dir,
      hitPlayerIds,
      hitVehicleIds,
      destroyed.map((b) => ({ x: b.x, y: b.y, z: b.z })),
    );

    // Rebuild affected chunks
    this.world.rebuildDirtyChunks(this.scene);
  }

  /** Sync vehicle weapon fire to server */
  private syncVehicleFireToServer(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    hitPlayerIds: string[],
    hitVehicleIds: number[],
    hitBlocks: { x: number; y: number; z: number }[],
  ): void {
    if (!this.conn) return;

    // Convert hex player IDs to Identity objects
    const hitPlayerIdentities: any[] = [];
    for (const hexId of hitPlayerIds) {
      for (const p of this.conn.db.player.iter()) {
        if ((p as any).identity.toHexString() === hexId) {
          hitPlayerIdentities.push((p as any).identity);
          break;
        }
      }
    }

    this.conn.reducers.fireVehicleWeapon({
      origin: { x: origin.x, y: origin.y, z: origin.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
      hitPlayers: hitPlayerIdentities,
      hitVehicles: hitVehicleIds.map((id) => BigInt(id)),
      hitBlocks: hitBlocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
    });
  }
  private handleProjectileImpact(impact: ProjectileImpact): void {
    const w = WEAPONS[impact.weaponIndex];
    const effectiveRadius = impact.isVehicle ? 6.0 : w.radius;

    // Audio
    this.audio.playBlockBreak({
      position: {
        x: impact.hitPos.x + 0.5,
        y: impact.hitPos.y + 0.5,
        z: impact.hitPos.z + 0.5,
      },
    });
    if (effectiveRadius > 0) {
      setTimeout(() => this.audio.playExplosion({
        position: {
          x: impact.hitPos.x + 0.5,
          y: impact.hitPos.y + 0.5,
          z: impact.hitPos.z + 0.5,
        },
      }), 80);
    }

    // Hit marker
    if (impact.hitPlayerIds.length > 0) {
      this.hitMarkerTimer = 0.2;
      this.hitMarkerType = 'player';
      this.audio.playHitMarker();
    } else if (impact.destroyedBlocks.length > 0) {
      this.hitMarkerTimer = 0.2;
      this.hitMarkerType = 'block';
    }

    // Block debris VFX (cap for perf)
    const blocks = impact.destroyedBlocks;
    const max = 15;
    const sampled = blocks.length > max
      ? blocks.sort(() => Math.random() - 0.5).slice(0, max) : blocks;
    for (const b of sampled) {
      this.vfx.emitBlockDebris(b.x, b.y, b.z, BLOCK_COLORS[b.blockType] || 0x808080);
    }

    // Impact + explosion VFX
    this.vfx.emitImpact(impact.hitPos.x, impact.hitPos.y, impact.hitPos.z);
    if (effectiveRadius > 0) {
      this.vfx.emitExplosion(impact.hitPos.x, impact.hitPos.y, impact.hitPos.z, effectiveRadius);
      this.applyExplosionCameraEffects(impact.hitPos.x, impact.hitPos.y, impact.hitPos.z, effectiveRadius, impact.isVehicle ? 45 : w.damage);
    }

    // Explosion physics: knockback + flying debris + force on existing falling blocks
    if (effectiveRadius > 0) {
      const hx = impact.hitPos.x, hy = impact.hitPos.y, hz = impact.hitPos.z;
      const effectiveDamage = impact.isVehicle ? 45 : w.damage;

      // Player knockback (rocket jumping etc.)
      this.applyExplosionKnockback(hx, hy, hz, effectiveRadius, effectiveDamage);

      // Spawn destroyed blocks as flying physics debris
      if (impact.destroyedBlocks.length > 0) {
        this.physics.spawnExplosionDebris(impact.destroyedBlocks, hx, hy, hz, effectiveRadius, effectiveDamage * 0.2);
      }

      // Push already-falling blocks
      this.physics.applyExplosionForce(hx, hy, hz, effectiveRadius * 2, effectiveDamage * 1.5);
    }

    // Rebuild affected chunks
    this.world.rebuildDirtyChunks(this.scene);

    // Server sync: route to correct reducer
    if (impact.isVehicle) {
      this.syncVehicleImpactToServer(impact);
    } else {
      this.syncImpactToServer(impact);
    }
  }

  // ── EXPLOSION KNOCKBACK ──

  /** Apply local camera feedback from explosions based on proximity and blast strength */
  private applyExplosionCameraEffects(
    cx: number, cy: number, cz: number,
    radius: number, damage: number,
  ): void {
    const dx = this.camera.position.x - cx;
    const dy = this.camera.position.y - cy;
    const dz = this.camera.position.z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const maxEffectDist = radius * 11 + 10;
    if (dist >= maxEffectDist) return;

    const proximity = 1 - dist / maxEffectDist;
    const shaped = proximity * proximity;
    const weaponPower = THREE.MathUtils.clamp(damage / 90, 0.55, 1.4);

    // Keep explosion shake readable but not overwhelming at any distance.
    const shake = (0.03 + shaped * 0.65 + proximity * 0.12) * weaponPower;
    this.vfx.shake(Math.min(0.8, shake));
  }

  /** Apply explosion knockback to the local player based on distance from blast center */
  private applyExplosionKnockback(
    cx: number, cy: number, cz: number,
    radius: number, damage: number,
  ): void {
    const px = this.camera.position.x;
    const py = this.camera.position.y;
    const pz = this.camera.position.z;

    // Use body center instead of camera eye so side blasts stay mostly horizontal.
    const bodyY = py - 0.9;

    const dx = px - cx;
    const dy = bodyY - cy;
    const dz = pz - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Slightly wider than destruction radius, but not excessive.
    const maxDist = radius * 3.4;
    if (dist >= maxDist || dist < 0.01) return;

    const proximity = 1 - dist / maxDist;
    const falloff = proximity * proximity;
    const coreBoost = 1 + proximity * 0.35;

    const baseKnockback = damage * (0.2 + radius * 0.022);
    const knockback = baseKnockback * falloff * coreBoost;

    // Radial impulse away from blast center (realistic directionality).
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;

    // Small ground-coupling lift only when explosion is below the body center.
    const belowFactor = THREE.MathUtils.clamp((bodyY - cy) / (radius + 1.2), 0, 1);
    const updraft = knockback * 0.12 * belowFactor;

    this.controls.applyImpulse(
      nx * knockback,
      ny * knockback + updraft,
      nz * knockback,
    );
  }

  // ── SERVER SYNC ──

  /** Load already-subscribed world chunks from server */
  private loadWorldFromServer(): void {
    if (!this.conn) return;
    const count = this.rehydrateSubscribedChunks();
    console.log(`[BitWars] Loaded ${count} world chunks from server`);
  }

  private rehydrateSubscribedChunks(maxNewChunks = Number.POSITIVE_INFINITY): number {
    if (!this.conn || maxNewChunks <= 0) return 0;
    let loaded = 0;
    for (const chunk of this.conn.db.world_chunk.iter() as Iterable<any>) {
      const cx = chunk.cx as number;
      const cy = chunk.cy as number;
      const cz = chunk.cz as number;
      if (this.world.isChunkLoaded(cx, cy, cz)) continue;

      const data = chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data);
      const decoded = VoxelWorld.rleDecodeChunk(data);
      this.world.loadChunk(cx, cy, cz, decoded);
      this.syncLanternLightsForChunk(cx, cy, cz, decoded);
      this.pendingChunkRequests.delete(packChunkId(cx, cy, cz));
      loaded++;
      if (loaded >= maxNewChunks) break;
    }
    return loaded;
  }

  /** Request chunks near the player that aren't loaded yet */
  private updateChunkLoading(): void {
    if (!this.conn) return;

    this.reapPendingChunkRequests();

    const [cx, cz] = this.getLoadAnchorChunk();

    const playerMoved = cx !== this.lastPlayerCx || cz !== this.lastPlayerCz;
    if (playerMoved) {
      this.lastPlayerCx = cx;
      this.lastPlayerCz = cz;
      this.rebuildChunkRequestQueue(cx, cz);
    }

    if (!this.startupWorldReady) {
      this.prioritizeStartupArea(cx, cz);
    }

    if (this.bootstrapActive) {
      this.fillBootstrapQueue(cx, cz);
      if (this.bootstrapRequestQueue.length === 0) {
        this.bootstrapActive = false;
      }
    }

    if (!playerMoved
      && this.chunkRequestQueue.length === 0
      && this.bootstrapRequestQueue.length === 0
      && this.pendingChunkRequests.size === 0
    ) {
      this.rebuildChunkRequestQueue(cx, cz);
    }

    // Request missing chunks in small batches to spread decode/meshing cost across frames
    const batch: number[] = [];
    while (batch.length < CHUNKS_PER_REQUEST && (this.bootstrapRequestQueue.length > 0 || this.chunkRequestQueue.length > 0)) {
      const fromBootstrap = this.bootstrapRequestQueue.length > 0;
      const id = fromBootstrap ? this.bootstrapRequestQueue.shift()! : this.chunkRequestQueue.shift()!;
      if (fromBootstrap) this.bootstrapQueued.delete(id);
      else this.queuedChunkRequests.delete(id);
      if (this.pendingChunkRequests.has(id)) continue;
      const [rcx, rcy, rcz] = unpackChunkId(id);
      if (this.world.isChunkLoaded(rcx, rcy, rcz)) continue;
      this.pendingChunkRequests.set(id, performance.now());
      batch.push(id);
    }
    if (batch.length > 0) {
      this.conn.reducers.requestChunks({ chunkIds: batch });
    }

    // Unload chunks that are too far away (only check when player moved)
    if (playerMoved) {
      const unloadDist = VIEW_DISTANCE + UNLOAD_BUFFER;
      for (const chunkId of this.world.getLoadedChunkIds()) {
        const [lcx, , lcz] = unpackChunkId(chunkId);
        const dx = lcx - cx;
        const dz = lcz - cz;
        if (dx * dx + dz * dz > unloadDist * unloadDist) {
          const [ucx, ucy, ucz] = unpackChunkId(chunkId);
          this.clearLanternLightsForChunk(chunkId);
          this.world.unloadChunk(ucx, ucy, ucz, this.scene);
        }
      }
    }
  }

  private prioritizeStartupArea(cx: number, cz: number): void {
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);

    for (let i = STARTUP_OFFSETS.length - 1; i >= 0; i--) {
      const { dx, dz } = STARTUP_OFFSETS[i];
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncx >= maxCx || ncz < 0 || ncz >= maxCz) continue;
      for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
        const id = packChunkId(ncx, cy, ncz);
        if (this.pendingChunkRequests.has(id)) continue;
        if (this.world.isChunkLoaded(ncx, cy, ncz)) continue;
        if (this.bootstrapQueued.has(id)) continue;
        this.bootstrapRequestQueue.unshift(id);
        this.bootstrapQueued.add(id);
      }
    }
  }

  private reapPendingChunkRequests(): void {
    if (this.pendingChunkRequests.size === 0) return;
    const now = performance.now();
    const retry: number[] = [];

    for (const [id, requestedAt] of this.pendingChunkRequests) {
      const [cx, cy, cz] = unpackChunkId(id);
      if (this.world.isChunkLoaded(cx, cy, cz)) {
        this.pendingChunkRequests.delete(id);
        continue;
      }

      if (now - requestedAt > CHUNK_REQUEST_TIMEOUT_MS) {
        this.pendingChunkRequests.delete(id);
        if (!this.bootstrapQueued.has(id) && !this.queuedChunkRequests.has(id)) {
          retry.push(id);
        }
      }
    }

    if (retry.length === 0) return;

    if (!this.startupWorldReady) {
      for (let i = retry.length - 1; i >= 0; i--) {
        const id = retry[i]!;
        this.bootstrapRequestQueue.unshift(id);
        this.bootstrapQueued.add(id);
      }
      return;
    }

    this.chunkRequestQueue.push(...retry);
    for (const id of retry) this.queuedChunkRequests.add(id);
  }

  private getStartupLoadProgress(): number {
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);
    const [cx, cz] = this.getLoadAnchorChunk();

    let total = 0;
    let ready = 0;

    for (const { dx, dz } of STARTUP_OFFSETS) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncx >= maxCx || ncz < 0 || ncz >= maxCz) continue;
      total++;
      if (this.world.isStartupColumnReady(ncx, ncz, NUM_CHUNKS_Y)) ready++;
    }

    if (total === 0) return 1;
    return ready / total;
  }

  private rebuildChunkRequestQueue(cx: number, cz: number): void {
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);

    this.chunkRequestQueue.length = 0;
    this.queuedChunkRequests.clear();

    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const lookLen = Math.hypot(look.x, look.z);
    const lookX = lookLen > 0.0001 ? look.x / lookLen : 0;
    const lookZ = lookLen > 0.0001 ? look.z / lookLen : -1;

    const forward: number[] = [];
    const side: number[] = [];
    const behind: number[] = [];

    for (const { dx, dz } of STREAM_OFFSETS) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncx >= maxCx || ncz < 0 || ncz >= maxCz) continue;

      const ringLen = Math.hypot(dx, dz);
      const dot = ringLen > 0.0001 ? (dx / ringLen) * lookX + (dz / ringLen) * lookZ : 1;

      const bucket = dot > 0.25 ? forward : dot > -0.35 ? side : behind;
      for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
        const id = packChunkId(ncx, cy, ncz);
        if (this.pendingChunkRequests.has(id)) continue;
        if (this.world.isChunkLoaded(ncx, cy, ncz)) continue;
        bucket.push(id);
      }
    }

    this.chunkRequestQueue.push(...forward, ...side, ...behind);
    for (const id of this.chunkRequestQueue) this.queuedChunkRequests.add(id);
  }

  private fillBootstrapQueue(cx: number, cz: number): void {
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);

    let added = 0;
    for (const { dx, dz } of STREAM_OFFSETS) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncx >= maxCx || ncz < 0 || ncz >= maxCz) continue;

      for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
        const id = packChunkId(ncx, cy, ncz);
        if (this.pendingChunkRequests.has(id)) continue;
        if (this.world.isChunkLoaded(ncx, cy, ncz)) continue;
        if (this.bootstrapQueued.has(id)) continue;
        this.bootstrapRequestQueue.push(id);
        this.bootstrapQueued.add(id);
        added++;
      }

      if (added >= CHUNKS_PER_REQUEST * 4) break;
    }
  }

  private getLoadAnchorChunk(): [number, number] {
    let x = this.camera.position.x;
    let z = this.camera.position.z;

    if (this.conn && this.localIdentity) {
      for (const player of this.conn.db.player.iter()) {
        const p = player as any;
        if (p.identity.toHexString() !== this.localIdentity) continue;
        if (Number.isFinite(p.pos?.x) && Number.isFinite(p.pos?.z)) {
          x = p.pos.x;
          z = p.pos.z;
        }
        break;
      }
    }

    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      x = WORLD_X * 0.5;
      z = WORLD_Z * 0.5;
    }

    const clampedX = Math.max(0, Math.min(WORLD_X - 1, x));
    const clampedZ = Math.max(0, Math.min(WORLD_Z - 1, z));
    return [Math.floor(clampedX / CHUNK), Math.floor(clampedZ / CHUNK)];
  }

  private ensureSpawnGroundReady(): void {
    const [cx, cz] = this.getLoadAnchorChunk();
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);
    if (cx < 0 || cx >= maxCx || cz < 0 || cz >= maxCz) return;

    let hasGroundMesh = false;
    for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
      if (this.world.hasChunkMesh(cx, cy, cz)) {
        hasGroundMesh = true;
        break;
      }
    }
    if (hasGroundMesh) return;

    for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
      if (this.world.isChunkLoaded(cx, cy, cz)) {
        this.world.markChunkDirty(cx, cy, cz);
      }
    }
    this.world.rebuildDirtyChunks(this.scene, CHUNK_REBUILD_BUDGET_BOOTSTRAP);
  }

  /** Load initial environment state from server */
  private loadEnvironmentFromServer(): void {
    if (!this.conn) return;
    const db = this.conn.db as any;
    if (!db.world_environment) return;
    for (const env of db.world_environment.iter()) {
      this.sky.setEnvironment({
        timeOfDay: env.timeOfDay as number,
        weather: env.weather as number,
        windSpeed: env.windSpeed as number,
        cloudDensity: env.cloudDensity as number,
        fogDensity: env.fogDensity as number,
      });
      break; // Single row
    }
  }

  /** Apply environment update from server */
  private applyEnvironmentUpdate(env: any): void {
    this.sky.setEnvironment({
      timeOfDay: env.timeOfDay as number,
      weather: env.weather as number,
      windSpeed: env.windSpeed as number,
      cloudDensity: env.cloudDensity as number,
      fogDensity: env.fogDensity as number,
    });
  }

  /** Send fire event to server with hit players/vehicles and destroyed blocks */
  private syncFireToServer(result: {
    weaponIndex: number;
    destroyedBlocks: { x: number; y: number; z: number }[];
    hitPlayerIds: string[];
    hitVehicleIds: number[];
    origin: THREE.Vector3;
    direction: THREE.Vector3;
  }): void {
    if (!this.conn) return;

    // Convert hex player IDs to Identity objects
    const hitPlayerIdentities: any[] = [];
    for (const hexId of result.hitPlayerIds) {
      // Find the player in the DB by matching hex identity
      for (const p of this.conn.db.player.iter()) {
        if ((p as any).identity.toHexString() === hexId) {
          hitPlayerIdentities.push((p as any).identity);
          break;
        }
      }
    }

    this.conn.reducers.fireWeapon({
      origin: { x: result.origin.x, y: result.origin.y, z: result.origin.z },
      direction: { x: result.direction.x, y: result.direction.y, z: result.direction.z },
      weapon: result.weaponIndex,
      hitPlayers: hitPlayerIdentities,
      hitVehicles: result.hitVehicleIds.map((id) => BigInt(id)),
      hitBlocks: result.destroyedBlocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
    });
  }

  /** Send projectile impact to server for damage/block validation */
  private syncImpactToServer(impact: ProjectileImpact): void {
    if (!this.conn) return;

    // Convert hex player IDs to Identity objects
    const hitPlayerIdentities: any[] = [];
    for (const hexId of impact.hitPlayerIds) {
      for (const p of this.conn.db.player.iter()) {
        if ((p as any).identity.toHexString() === hexId) {
          hitPlayerIdentities.push((p as any).identity);
          break;
        }
      }
    }

    this.conn.reducers.projectileImpact({
      shotOrigin: { x: impact.origin.x, y: impact.origin.y, z: impact.origin.z },
      impactPos: { x: impact.hitPos.x, y: impact.hitPos.y, z: impact.hitPos.z },
      direction: { x: impact.direction.x, y: impact.direction.y, z: impact.direction.z },
      weapon: impact.weaponIndex,
      travelTimeMs: Math.round(impact.travelTimeMs),
      hitPlayers: hitPlayerIdentities,
      hitVehicles: impact.hitVehicleIds.map((id) => BigInt(id)),
      hitBlocks: impact.destroyedBlocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
    });
  }

  private syncVehicleImpactToServer(impact: ProjectileImpact): void {
    if (!this.conn) return;

    // Convert hex player IDs to Identity objects
    const hitPlayerIdentities: any[] = [];
    for (const hexId of impact.hitPlayerIds) {
      for (const p of this.conn.db.player.iter()) {
        if ((p as any).identity.toHexString() === hexId) {
          hitPlayerIdentities.push((p as any).identity);
          break;
        }
      }
    }

    this.conn.reducers.vehicleProjectileImpact({
      shotOrigin: { x: impact.origin.x, y: impact.origin.y, z: impact.origin.z },
      impactPos: { x: impact.hitPos.x, y: impact.hitPos.y, z: impact.hitPos.z },
      direction: { x: impact.direction.x, y: impact.direction.y, z: impact.direction.z },
      vehicleWeapon: impact.vehicleWeaponIndex,
      travelTimeMs: Math.round(impact.travelTimeMs),
      hitPlayers: hitPlayerIdentities,
      hitVehicles: impact.hitVehicleIds.map((id) => BigInt(id)),
      hitBlocks: impact.destroyedBlocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
      sourceVehicleId: BigInt(impact.sourceVehicleId),
    });
  }

  private setupServerListeners(): void {
    if (!this.conn) return;

    // New chunks arriving (lazy generation or subscription change)
    this.conn.db.world_chunk.onInsert((_ctx: unknown, chunk: any) => {
      const cx = chunk.cx as number, cy = chunk.cy as number, cz = chunk.cz as number;
      const data = chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data);
      const decoded = VoxelWorld.rleDecodeChunk(data);
      this.world.loadChunk(cx, cy, cz, decoded);
      this.syncLanternLightsForChunk(cx, cy, cz, decoded);
      const id = packChunkId(cx, cy, cz);
      this.pendingChunkRequests.delete(id);
      this.queuedChunkRequests.delete(id);
      this.bootstrapQueued.delete(id);
    });

    // Chunk deletion (map reset)
    this.conn.db.world_chunk.onDelete((_ctx: unknown, chunk: any) => {
      const cx = chunk.cx as number, cy = chunk.cy as number, cz = chunk.cz as number;
      const id = packChunkId(cx, cy, cz);
      this.pendingChunkRequests.delete(id);
      this.queuedChunkRequests.delete(id);
      this.bootstrapQueued.delete(id);
      this.clearLanternLightsForChunk(id);
      this.world.unloadChunk(cx, cy, cz, this.scene);
    });

    // World chunk updates (block destruction synced via chunk data)
    this.conn.db.world_chunk.onUpdate((_ctx: unknown, old: unknown, chunk: any) => {
      const cx = chunk.cx as number, cy = chunk.cy as number, cz = chunk.cz as number;
      const newData = chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data);
      const newDecoded = VoxelWorld.rleDecodeChunk(newData);

      // Decode old chunk to find which blocks changed from solid→air
      const oldChunk = old as any;
      const oldData = oldChunk.data instanceof Uint8Array ? oldChunk.data : new Uint8Array(oldChunk.data);
      const oldDecoded = VoxelWorld.rleDecodeChunk(oldData);

      for (let lz = 0; lz < 16; lz++) {
        for (let ly = 0; ly < 16; ly++) {
          for (let lx = 0; lx < 16; lx++) {
            const localIdx = lx + ly * 16 + lz * 16 * 16;
            if (oldDecoded[localIdx] !== 0 && newDecoded[localIdx] === 0) {
              const gx = cx * 16 + lx, gy = cy * 16 + ly, gz = cz * 16 + lz;
              const key = `${gx},${gy},${gz}`;
              // Only emit VFX if this wasn't a client-predicted destruction
              if (!this.weapons.isPendingDestruction(key)) {
                this.vfx.emitImpact(gx, gy, gz);
              }
              this.weapons.confirmDestruction(key);
            }
          }
        }
      }

      // Apply authoritative chunk data (naturally corrects any rejected predictions)
      this.world.loadChunk(cx, cy, cz, newDecoded);
      this.syncLanternLightsForChunk(cx, cy, cz, newDecoded);
      this.pendingChunkRequests.delete(packChunkId(cx, cy, cz));
    });

    // DetachEvent: server-authoritative structural collapse → spawn falling blocks
    this.conn.db.detach_event.onInsert((_ctx: unknown, event: any) => {
      const createdAtMs = (event.createdAt && typeof event.createdAt.toMillis === 'function')
        ? Number(event.createdAt.toMillis())
        : Date.now();

      this.physics.spawnFromDetachEvent({
        eventId: Number(event.id ?? 0),
        blocksX: event.blocksX as ArrayLike<number>,
        blocksY: event.blocksY as ArrayLike<number>,
        blocksZ: event.blocksZ as ArrayLike<number>,
        blockTypes: event.blockTypes as ArrayLike<number>,
        motionMode: Number(event.motionMode ?? 0),
        pivot: {
          x: Number(event.pivot?.x ?? 0),
          y: Number(event.pivot?.y ?? 0),
          z: Number(event.pivot?.z ?? 0),
        },
        axis: {
          x: Number(event.axis?.x ?? 0),
          y: Number(event.axis?.y ?? 1),
          z: Number(event.axis?.z ?? 0),
        },
        drift: {
          x: Number(event.drift?.x ?? 0),
          y: Number(event.drift?.y ?? -0.5),
          z: Number(event.drift?.z ?? 0),
        },
        fractureOrigin: {
          x: Number(event.fractureOrigin?.x ?? 0),
          y: Number(event.fractureOrigin?.y ?? 0),
          z: Number(event.fractureOrigin?.z ?? 0),
        },
        fractureDir: {
          x: Number(event.fractureDir?.x ?? 1),
          y: Number(event.fractureDir?.y ?? 0),
          z: Number(event.fractureDir?.z ?? 0),
        },
        angAccel: Number(event.angAccel ?? 0.3),
        initialAngVel: Number(event.initialAngVel ?? 0),
        gravityScale: Number(event.gravityScale ?? 1),
        fractureSpeed: Number(event.fractureSpeed ?? 4),
        lifetimeMs: Number(event.lifetimeMs ?? 5000),
        createdAtMs,
      });
    });

    // Player tracking
    this.conn.db.player.onUpdate((_ctx: unknown, _old: unknown, player: any) => {
      const id = player.identity.toHexString();

      if (this.localIdentity && id === this.localIdentity) {
        const wasMounted = this.mountedVehicleId !== 0;
        const prevMountedId = this.mountedVehicleId;
        const serverWeapon = Number(player.currentWeapon);
        const localSwitchAgeMs = performance.now() - this.lastLocalWeaponSwitchAt;
        if (
          Number.isInteger(serverWeapon)
          && localSwitchAgeMs > 180
          && this.weapons.setCurrentWeapon(serverWeapon)
        ) {
          this.weaponModel.switchWeapon(serverWeapon);
          this.lastWeaponIndex = serverWeapon;
        }

        // Detect server-side teleportation (large position jump)
        const sp = player.pos;
        const cp = this.camera.position;
        const tdx = sp.x - cp.x, tdy = sp.y - cp.y, tdz = sp.z - cp.z;
        if (tdx * tdx + tdy * tdy + tdz * tdz > 100) {
          this.camera.position.set(sp.x, sp.y, sp.z);
          this.controls.resetVelocity();
        }

        const oldHealth = this.health;
        this.health = player.health;
        this.spawnProtected = !!player.spawnProtected;
        this.kills = player.kills;
        this.deaths = player.deaths;
        this.mountedVehicleId = Number(player.mountedVehicleId ?? 0);
        if (wasMounted !== (this.mountedVehicleId !== 0)) {
          this.mountedCameraInitialized = false;
          if (this.mountedVehicleId !== 0) {
            const pose = this.getMountedVehiclePose();
            if (pose) {
              this.vehiclePilotYaw = pose.yaw;
              this.vehiclePilotPitch = Math.max(HELI_PILOT_PITCH_MIN, Math.min(HELI_PILOT_PITCH_MAX, pose.pitch));
            }
            // Reset vehicle weapon state on mount
            this.vehicleWeaponIndex = 0;
            this.lastVehicleFireAt = 0;
            this.vehicleReloadingUntil[0] = 0;
            this.vehicleReloadingUntil[1] = 0;
            this.vehicleCameraDistance = HELI_CAMERA_DISTANCE;
            // Reset smooth chase state for local pilot
            this.localHeliSmoothedInitialized = false;
            this.localHeliLastServerTime = 0;
            const vRow = this.getVehicleRow(this.mountedVehicleId);
            if (vRow) {
              this.vehicleAmmo[0] = Number(vRow.weaponAmmoPrimary ?? VEHICLE_WEAPONS[0].maxAmmo);
              this.vehicleAmmo[1] = Number(vRow.weaponAmmoSecondary ?? VEHICLE_WEAPONS[1].maxAmmo);
            } else {
              this.vehicleAmmo[0] = VEHICLE_WEAPONS[0].maxAmmo;
              this.vehicleAmmo[1] = VEHICLE_WEAPONS[1].maxAmmo;
            }
          } else {
            // Dismounting — restore helicopter opacity to full
            const prevHeli = this.helicopters.get(prevMountedId);
            if (prevHeli) this.setHelicopterOpacity(prevHeli, 1.0);
            // Reset smooth chase state
            this.localHeliSmoothedInitialized = false;
            this.localHeliLastServerTime = 0;
          }
        }
        if (player.health < oldHealth) {
          const dmgRatio = (oldHealth - player.health) / 100;
          this.postfx.triggerDamage(0.3 + dmgRatio * 0.7);
          this.audio.playDamage(this.localAudioSource(-0.2));
          this.vfx.shake(0.5 + dmgRatio);
        }
        // Respawn: health went from 0 to positive — play respawn audio
        if (oldHealth <= 0 && player.health > 0) {
          this.audio.playRespawn(this.localAudioSource(-0.2));
        }
        return;
      }

      if (this.shouldRenderRemotePlayer(player)) {
        const pvel = player.vel || { x: 0, y: 0, z: 0 };
        this.updateOtherPlayer(
          id,
          player.pos,
          pvel,
          player.rot,
          player.username,
          Number(player.characterPreset ?? 0),
          Number(player.currentWeapon ?? 0),
        );
      } else {
        this.removeOtherPlayer(id);
      }
    });

    this.conn.db.player.onInsert((_ctx: unknown, player: any) => {
      const id = player.identity.toHexString();
      if (id === this.localIdentity) return;
      if (this.shouldRenderRemotePlayer(player)) {
        const pvel = player.vel || { x: 0, y: 0, z: 0 };
        this.updateOtherPlayer(
          id,
          player.pos,
          pvel,
          player.rot,
          player.username,
          Number(player.characterPreset ?? 0),
          Number(player.currentWeapon ?? 0),
        );
      }
    });

    this.conn.db.player.onDelete((_ctx: unknown, player: any) => {
      this.removeOtherPlayer(player.identity.toHexString());
    });

    // Render players already online when Engine starts
    for (const player of this.conn.db.player.iter()) {
      const p = player as any;
      const id = p.identity.toHexString();
      if (id === this.localIdentity) continue;
      if (p.username && this.shouldRenderRemotePlayer(p)) {
        const pvel = p.vel || { x: 0, y: 0, z: 0 };
        this.updateOtherPlayer(
          id,
          p.pos,
          pvel,
          p.rot,
          p.username,
          Number(p.characterPreset ?? 0),
          Number(p.currentWeapon ?? 0),
        );
      }
    }

    // Remote shot events: render tracers or spawn projectiles for other players
    this.conn.db.shot_event.onInsert((_ctx: unknown, shot: any) => {
      const shooterId = shot.shooter.toHexString();
      if (shooterId === this.localIdentity) return; // Skip our own shots

      const weaponIdx = shot.weapon as number;
      const origin = new THREE.Vector3(shot.origin.x, shot.origin.y, shot.origin.z);
      const dir = new THREE.Vector3(shot.direction.x, shot.direction.y, shot.direction.z);

      // Vehicle weapons use 100+ namespace
      if (weaponIdx >= 100) {
        const vehWeaponIdx = weaponIdx - 100; // 0=minigun, 1=rockets
        const vw = VEHICLE_WEAPONS[vehWeaponIdx];
        if (!vw) return;

        this.playRemoteWeaponAudio(weaponIdx, origin, dir);

        if (vw.projectileSpeed > 0) {
          // Rocket: spawn projectile (reuse RPG config index 2 for visual)
          let approxAgeMs = 0;
          const firedAt = shot.firedAt;
          if (firedAt && typeof firedAt.toMillis === 'function') {
            const firedAtMs = Number(firedAt.toMillis());
            if (Number.isFinite(firedAtMs)) {
              approxAgeMs = Math.max(0, Math.min(3000, Date.now() - firedAtMs));
            }
          }
          const firedAtPerf = performance.now() - approxAgeMs;
          this.projectileManager.spawnRemote(2, origin, dir, firedAtPerf, shooterId);
          // Muzzle flash at launch point
          this.vfx.emitMuzzleFlashAt(origin, dir, 0xff4400);
        } else {
          // Hitscan (minigun): tracer + muzzle flash + impact
          const hasHit = shot.hasHit as boolean;
          const hitPos = shot.hitPos;
          const end = hasHit && hitPos
            ? new THREE.Vector3(hitPos.x, hitPos.y, hitPos.z)
            : origin.clone().add(dir.clone().normalize().multiplyScalar(vw.maxRange));
          this.vfx.emitTracer(origin, end, 0xffaa00);
          this.vfx.emitMuzzleFlashAt(origin, dir, 0xffaa00);

          if (hasHit && hitPos) {
            this.vfx.emitImpact(hitPos.x, hitPos.y, hitPos.z);
          }
        }
        return;
      }

      // Infantry weapons
      const w = WEAPONS[weaponIdx];
      if (!w) return;

      this.playRemoteWeaponAudio(weaponIdx, origin, dir);

      if (isFinite(w.projectile.speed)) {
        // Grenade launcher: server-authoritative. Skip client projectile spawn.
        // The GrenadeProjectile table row handles rendering.
        if (weaponIdx === 4) return;

        // Projectile weapon: spawn flying projectile with timestamp-based catch-up
        let approxAgeMs = 0;
        const firedAt = shot.firedAt;
        if (firedAt && typeof firedAt.toMillis === 'function') {
          const firedAtMs = Number(firedAt.toMillis());
          if (Number.isFinite(firedAtMs)) {
            approxAgeMs = Math.max(0, Math.min(3000, Date.now() - firedAtMs));
          }
        }
        const firedAtPerf = performance.now() - approxAgeMs;
        this.projectileManager.spawnRemote(weaponIdx, origin, dir, firedAtPerf, shooterId);
      } else {
        // Hitscan: render instant tracer + impact VFX at hit position
        const hasHit = shot.hasHit as boolean;
        const hitPos = shot.hitPos;
      const end = hasHit && hitPos
          ? new THREE.Vector3(hitPos.x, hitPos.y, hitPos.z)
          : origin.clone().add(dir.clone().normalize().multiplyScalar(w.range));
        this.vfx.emitTracer(origin, end, parseInt(w.color.replace('#', ''), 16));

        if (hasHit && hitPos) {
          this.vfx.emitImpact(hitPos.x, hitPos.y, hitPos.z);
          this.audio.playBlockBreak({
            position: {
              x: hitPos.x + 0.5,
              y: hitPos.y + 0.5,
              z: hitPos.z + 0.5,
            },
          });
        }
      }
    });

    // Remote explosion events: render VFX for all clients
    const explosionTable = (this.conn.db as any).explosion_event;
    if (explosionTable) {
      explosionTable.onInsert((_ctx: unknown, explosion: any) => {
        const originId = explosion.origin.toHexString();

        const x = explosion.pos.x as number;
        const y = explosion.pos.y as number;
        const z = explosion.pos.z as number;
        const radius = explosion.radius as number;
        const weaponIdx = explosion.weapon as number;

        // Remove corresponding remote projectile when authoritative impact arrives.
        this.projectileManager.resolveRemoteImpact(originId, weaponIdx, { x, y, z }, radius);

        // Skip if we are the originator (we already played local VFX) —
        // EXCEPT for grenades (weapon 4) which are server-authoritative and have no local VFX
        if (originId === this.localIdentity && weaponIdx !== 4) return;

        // VFX: explosion particles + impact
        this.vfx.emitExplosion(x, y, z, radius);
        this.vfx.emitImpact(x, y, z);

        // Local reaction to blast proximity
        const dx = this.camera.position.x - x;
        const dy = this.camera.position.y - y;
        const dz = this.camera.position.z - z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const audibleDist = radius * 16 + 24;
        if (dist <= audibleDist) {
          this.audio.playExplosion({ position: { x, y, z } });
        }

        // Knockback from remote explosions
        const dmg = WEAPONS[weaponIdx]?.damage ?? 50;
        this.applyExplosionCameraEffects(x, y, z, radius, dmg);
        this.applyExplosionKnockback(x, y, z, radius, dmg);

        // Flying block debris from server-provided destroyed blocks
        const destroyedBlocks: any[] = explosion.destroyedBlocks ?? [];
        if (destroyedBlocks.length > 0) {
          const blocks = destroyedBlocks.map((b: any) => ({
            x: b.x as number,
            y: b.y as number,
            z: b.z as number,
            blockType: b.blockType as number,
          }));
          this.physics.spawnExplosionDebris(blocks, x, y, z, radius, dmg * 0.2);
        }

        // Push already-falling blocks near the blast
        this.physics.applyExplosionForce(x, y, z, radius * 2, dmg * 1.5);
      });
    }

    // Environment sync (time of day + weather)
    const db = this.conn.db as any;
    if (db.entity) {
      db.entity.onInsert((_ctx: unknown, entity: any) => {
        if (Number(entity.kind) !== ENTITY_KIND_VEHICLE) return;
        this.updateHelicopterEntity(entity);
      });
      db.entity.onUpdate((_ctx: unknown, _old: unknown, entity: any) => {
        if (Number(entity.kind) !== ENTITY_KIND_VEHICLE) return;
        this.updateHelicopterEntity(entity);
      });
      db.entity.onDelete((_ctx: unknown, entity: any) => {
        const id = Number(entity.id);
        if (Number(entity.kind) !== ENTITY_KIND_VEHICLE || !Number.isFinite(id)) return;
        if (performance.now() < this.suppressHelicopterDeleteFxUntil) {
          this.removeHelicopterMesh(id);
          return;
        }
        this.scheduleHelicopterDestroyFallback(id);
      });
      this.rebuildHelicoptersFromServer();
    }

    if (db.vehicle) {
      const refresh = (_ctx: unknown, row: any) => {
        const id = Number(row.entityId);
        const entity = this.findEntityRow(id);
        if (entity && Number(entity.kind) === ENTITY_KIND_VEHICLE) {
          this.updateHelicopterEntity(entity);
        }
      };
      db.vehicle.onInsert(refresh);
      db.vehicle.onUpdate(refresh);
      db.vehicle.onDelete((_ctx: unknown, row: any) => {
        const entityId = Number(row.entityId);
        if (!Number.isFinite(entityId) || entityId <= 0) return;
        if (performance.now() < this.suppressHelicopterDeleteFxUntil) {
          this.removeHelicopterMesh(entityId);
          return;
        }
        this.scheduleHelicopterDestroyFallback(entityId);
      });
    }

    if (db.vehicle_destroy_event) {
      db.vehicle_destroy_event.onInsert((_ctx: unknown, event: any) => {
        if (Number(event.vehicleType) !== VEHICLE_TYPE_HELICOPTER) return;
        const entityId = Number(event.entityId);
        if (!Number.isFinite(entityId) || entityId <= 0) return;

        const timer = this.pendingHelicopterDestroyFallbacks.get(entityId);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          this.pendingHelicopterDestroyFallbacks.delete(entityId);
        }

        this.triggerHelicopterDestroyFx(entityId, {
          x: Number(event.pos.x),
          y: Number(event.pos.y),
          z: Number(event.pos.z),
        }, Number(event.rot?.yaw ?? 0), 1.4);
      });
    }

    if (db.world_environment) {
      db.world_environment.onUpdate((_ctx: unknown, _old: unknown, env: any) => {
        this.applyEnvironmentUpdate(env);
      });
      db.world_environment.onInsert((_ctx: unknown, env: any) => {
        this.applyEnvironmentUpdate(env);
      });
    }

    // Map reset detection via WorldConfig round_number change
    const worldConfigTable = (this.conn.db as any).world_config;
    if (worldConfigTable) {
      worldConfigTable.onUpdate((_ctx: unknown, _old: unknown, config: any) => {
        console.log(`[BitWars] Map reset! New round #${config.roundNumber}`);
        this.world.clearAll(this.scene);
        for (const chunkId of Array.from(this.lanternPositionsByChunk.keys())) {
          this.clearLanternLightsForChunk(chunkId);
        }
        this.lanternPositionsByChunk.clear();
        this.activeLanternLights.clear();
        this.lanternLightKeyById.clear();
        this.lanternRefreshTimer = 0;
        this.clearLanternGlows();
        this.pendingChunkRequests.clear();
        this.queuedChunkRequests.clear();
        this.chunkRequestQueue.length = 0;
        this.bootstrapRequestQueue.length = 0;
        this.bootstrapQueued.clear();
        this.suppressHelicopterDeleteFxUntil = performance.now() + 1500;
        for (const timer of this.pendingHelicopterDestroyFallbacks.values()) {
          window.clearTimeout(timer);
        }
        this.pendingHelicopterDestroyFallbacks.clear();
        this.recentHelicopterBreakups.clear();
        for (const id of Array.from(this.helicopters.keys())) this.removeHelicopterMesh(id);
        for (const piece of this.helicopterBreakupPieces) {
          this.scene.remove(piece.mesh);
          piece.mesh.geometry.dispose();
          if (Array.isArray(piece.mesh.material)) {
            for (const mat of piece.mesh.material) mat.dispose();
          } else {
            piece.mesh.material.dispose();
          }
        }
        this.helicopterBreakupPieces.length = 0;
        this.bootstrapActive = true;
        this.startupWorldReady = false;
        this.startupProgressPrev = 0;
        this.startupProgressStallTime = 0;
        const sx = WORLD_X * 0.5;
        const sz = WORLD_Z * 0.5;
        this.camera.position.set(sx, Math.max(this.camera.position.y, 6), sz);
        this.controls.resetVelocity();
        this.lastPlayerCx = -1;
        this.lastPlayerCz = -1;
        this.rehydrateSubscribedChunks();
        this.rebuildHelicoptersFromServer();
        // Chunk streaming will re-request nearby chunks on next frame
      });
    }

    // Server-authoritative ammo sync
    this.conn.db.player_weapon_state.onInsert((_ctx: unknown, state: any) => {
      this.syncAmmoFromServer(state);
    });
    this.conn.db.player_weapon_state.onUpdate((_ctx: unknown, _old: unknown, state: any) => {
      this.syncAmmoFromServer(state);
    });

    // Persistent loadout sync
    if (db.player_loadout) {
      db.player_loadout.onInsert((_ctx: unknown, row: any) => {
        this.applyLoadoutRow(row);
      });
      db.player_loadout.onUpdate((_ctx: unknown, _old: unknown, row: any) => {
        this.applyLoadoutRow(row);
      });

      for (const row of db.player_loadout.iter()) {
        this.applyLoadoutRow(row);
      }
    }

    // Server-authoritative grenade projectiles: render from GrenadeProjectile table
    const grenadeTable = (this.conn.db as any).grenade_projectile;
    if (grenadeTable) {
      grenadeTable.onInsert((_ctx: unknown, g: any) => {
        const id = BigInt(g.id);
        if (this.grenadeVisuals.has(id)) return;

        const cfg = WEAPONS[4].projectile;
        const geo = new THREE.SphereGeometry(cfg.size, 8, 6);
        const mat = new THREE.MeshBasicMaterial({ color: cfg.lightColor });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
        this.scene.add(mesh);

        let light: THREE.PointLight | null = null;
        if (cfg.lightIntensity > 0) {
          light = new THREE.PointLight(cfg.lightColor, cfg.lightIntensity, cfg.lightRange);
          light.position.copy(mesh.position);
          this.scene.add(light);
        }

        this.grenadeVisuals.set(id, {
          mesh,
          light,
          pos: new THREE.Vector3(g.pos.x, g.pos.y, g.pos.z),
          vel: new THREE.Vector3(g.vel.x, g.vel.y, g.vel.z),
          lastUpdateTime: performance.now(),
          trailTimer: 0,
        });
      });

      grenadeTable.onUpdate((_ctx: unknown, _old: any, g: any) => {
        const id = BigInt(g.id);
        const vis = this.grenadeVisuals.get(id);
        if (!vis) return;
        vis.pos.set(g.pos.x, g.pos.y, g.pos.z);
        vis.vel.set(g.vel.x, g.vel.y, g.vel.z);
        vis.lastUpdateTime = performance.now();
        // Snap mesh to server position on each update
        vis.mesh.position.copy(vis.pos);
        if (vis.light) vis.light.position.copy(vis.pos);
      });

      grenadeTable.onDelete((_ctx: unknown, g: any) => {
        const id = BigInt(g.id);
        const vis = this.grenadeVisuals.get(id);
        if (!vis) return;
        this.scene.remove(vis.mesh);
        vis.mesh.geometry.dispose();
        (vis.mesh.material as THREE.Material).dispose();
        if (vis.light) {
          this.scene.remove(vis.light);
          vis.light.dispose();
        }
        this.grenadeVisuals.delete(id);
      });

      // Bootstrap: render any grenades already in the table
      for (const g of grenadeTable.iter()) {
        const id = BigInt(g.id);
        if (this.grenadeVisuals.has(id)) continue;

        const cfg = WEAPONS[4].projectile;
        const geo = new THREE.SphereGeometry(cfg.size, 8, 6);
        const mat = new THREE.MeshBasicMaterial({ color: cfg.lightColor });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
        this.scene.add(mesh);

        let light: THREE.PointLight | null = null;
        if (cfg.lightIntensity > 0) {
          light = new THREE.PointLight(cfg.lightColor, cfg.lightIntensity, cfg.lightRange);
          light.position.copy(mesh.position);
          this.scene.add(light);
        }

        this.grenadeVisuals.set(id, {
          mesh,
          light,
          pos: new THREE.Vector3(g.pos.x, g.pos.y, g.pos.z),
          vel: new THREE.Vector3(g.vel.x, g.vel.y, g.vel.z),
          lastUpdateTime: performance.now(),
          trailTimer: 0,
        });
      }
    }
  }

  /** Update local ammo from server weapon state */
  private syncAmmoFromServer(state: any): void {
    if (!this.conn) return;
    // Only sync our own weapon state
    if (!this.localIdentity || state.identity.toHexString() !== this.localIdentity) return;

    // Update local weapon ammo from server state
    WEAPONS[0].ammo = state.ammoRifle;
    WEAPONS[1].ammo = state.ammoShotgun;
    WEAPONS[2].ammo = state.ammoRpg;
    WEAPONS[3].ammo = state.ammoMachineGun;
    WEAPONS[4].ammo = state.ammoGrenade;
  }

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

  private createHelicopterModel(): THREE.Group {
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

  private normalizeWeaponIndex(value: number): number {
    if (!Number.isFinite(value)) return 0;
    const idx = Math.floor(value);
    if (idx < 0 || idx >= WEAPONS.length) return 0;
    return idx;
  }

  private getVehicleRow(vehicleId: number): any | null {
    if (!this.conn || vehicleId === 0) return null;
    const table = (this.conn.db as any).vehicle;
    if (!table) return null;
    for (const row of table.iter()) {
      if (Number((row as any).entityId) === vehicleId) return row;
    }
    return null;
  }

  private findEntityRow(entityId: number): any | null {
    if (!this.conn) return null;
    const table = (this.conn.db as any).entity;
    if (!table) return null;
    for (const row of table.iter()) {
      if (Number((row as any).id) === entityId) return row;
    }
    return null;
  }

  /** Check if player is near any unoccupied helicopter (for ENTER prompt) */
  private isNearVehicle(): boolean {
    const camPos = this.camera.position;
    for (const [, mesh] of this.helicopters) {
      const dx = camPos.x - mesh.position.x;
      const dy = camPos.y - mesh.position.y;
      const dz = camPos.z - mesh.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= HELI_MOUNT_RANGE) return true;
    }
    return false;
  }

  private ensureHelicopterMesh(entityId: number): THREE.Group {
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
    this.scene.add(mesh);
    this.helicopters.set(entityId, mesh);
    this.helicopterBuffers.set(entityId, new InterpolationBuffer());
    this.ensureHelicopterLightRig(entityId, mesh);
    return mesh;
  }

  private scheduleHelicopterDestroyFallback(entityId: number): void {
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

  private triggerHelicopterDestroyFx(
    entityId: number,
    pos: { x: number; y: number; z: number },
    yaw: number,
    intensity = 1,
  ): void {
    const now = performance.now();
    const last = this.recentHelicopterBreakups.get(entityId) ?? -Infinity;
    if (now - last < 1100) {
      this.removeHelicopterMesh(entityId);
      return;
    }
    this.recentHelicopterBreakups.set(entityId, now);
    this.removeHelicopterMesh(entityId);
    this.spawnHelicopterBreakup(pos, yaw, intensity);
  }

  private removeHelicopterMesh(entityId: number): void {
    const timer = this.pendingHelicopterDestroyFallbacks.get(entityId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.pendingHelicopterDestroyFallbacks.delete(entityId);
    }
    this.removeHelicopterLightRig(entityId);
    const mesh = this.helicopters.get(entityId);
    if (!mesh) return;
    this.scene.remove(mesh);
    this.disposeObjectMaterials(mesh);
    this.helicopters.delete(entityId);
    this.helicopterBuffers.delete(entityId);
  }

  private spawnHelicopterBreakup(
    pos: { x: number; y: number; z: number },
    yaw: number,
    intensity = 1,
  ): void {
    const fxIntensity = THREE.MathUtils.clamp(intensity, 0.55, 1.8);
    const colorPool = [0x2a3138, 0x38434d, 0x4a5561, 0x191f24, 0x6b7685];
    const pieceCount = Math.floor(18 + fxIntensity * 8);
    const origin = new THREE.Vector3(pos.x, pos.y + 2.2, pos.z);
    const radial = new THREE.Vector3();

    this.addDynamicLight({
      type: 'point',
      position: { x: pos.x, y: pos.y + 2.5, z: pos.z },
      color: 0xff7a32,
      intensity: 8.5 * fxIntensity,
      distance: 28 + 12 * fxIntensity,
      decay: 1.45,
      ttl: 0.22,
      kind: 'generic',
    });
    this.addDynamicLight({
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
      this.scene.add(mesh);

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
    this.physics.spawnExplosionDebris(ringBlocks, pos.x, pos.y + 2.0, pos.z, blastRadius, blastPower);
    this.vfx.emitExplosion(pos.x, pos.y + 2.0, pos.z, blastRadius);
    this.vfx.emitExplosion(pos.x, pos.y + 2.8, pos.z, blastRadius * 0.75);
    this.vfx.emitImpact(pos.x, pos.y + 1.4, pos.z);
    this.vfx.emitImpact(pos.x + 1.1, pos.y + 2.3, pos.z - 0.6);
    this.vfx.emitImpact(pos.x - 1.0, pos.y + 2.0, pos.z + 0.9);
    this.audio.playExplosion({ position: { x: pos.x, y: pos.y + 2.0, z: pos.z } });
    this.applyExplosionCameraEffects(pos.x, pos.y + 2.0, pos.z, blastRadius, 95 + fxIntensity * 40);
  }

  private updateHelicopterEntity(entity: any): void {
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
    if (id === this.mountedVehicleId) {
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

  private rebuildHelicoptersFromServer(): void {
    if (!this.conn) return;
    const entityTable = (this.conn.db as any).entity;
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

  private syncVehicleInput(): void {
    if (!this.conn || !this.localIdentity || this.mountedVehicleId === 0) return;
    const now = performance.now();
    if (now - this.lastVehicleInputUpdate < VEHICLE_INPUT_INTERVAL_MS) return;
    this.lastVehicleInputUpdate = now;

    // Battlefield-style: W/S = forward/back thrust
    let forward = 0;
    if (this.controls.moveForward) forward += 1;
    if (this.controls.moveBackward) forward -= 1;

    // Q/E = strafe (decoupled from yaw)
    let strafe = 0;
    if (this.controls.ePressed) strafe += 1;
    if (this.controls.qPressed) strafe -= 1;

    // Space = ascend, Shift = descend
    let lift = 0;
    if (this.controls.spacePressed) lift += 1;
    if (this.controls.shiftHeld) lift -= 1;

    // A/D = yaw rotation only (no strafe component)
    let yaw = 0;
    if (this.controls.moveRight) yaw += 1;
    if (this.controls.moveLeft) yaw -= 1;

    this.conn.reducers.updateVehicleInput({
      forward,
      strafe,
      lift,
      yaw,
      boosting: false, // No boost for helicopters
    });
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
      this.disposeObjectMaterials(existingGun);
    }

    const gun = this.createRemoteWeaponModel(weaponIndex, presetValue);
    mount.add(gun);
  }

  private disposeObjectMaterials(root: THREE.Object3D): void {
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

  // ── OTHER PLAYERS ──

  private updateOtherPlayer(
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
      this.scene.add(group);
      this.otherPlayers.set(id, group);
      this.interpBuffers.set(id, new InterpolationBuffer());
    } else {
      if (group.userData.characterPreset !== normalizedPreset) {
        const existingModel = group.getObjectByName('remote-player-model');
        if (existingModel) {
          group.remove(existingModel);
          this.disposeObjectMaterials(existingModel);
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

  private removeOtherPlayer(id: string): void {
    const g = this.otherPlayers.get(id);
    if (g) {
      const nametagTexture = g.userData.nametagTexture as THREE.CanvasTexture | undefined;
      if (nametagTexture) nametagTexture.dispose();
      const nametag = g.getObjectByName('remote-player-nametag');
      if (nametag instanceof THREE.Sprite) nametag.material.dispose();
      const model = g.getObjectByName('remote-player-model');
      if (model) this.disposeObjectMaterials(model);
      this.scene.remove(g);
      this.otherPlayers.delete(id);
    }
    this.interpBuffers.delete(id);
  }

  private shouldRenderRemotePlayer(player: any): boolean {
    return player.online && player.health > 0 && !player.spawnProtected;
  }

  // ── HELPERS ──

  private getGroundHeight(x: number, z: number, footY?: number): number {
    if (footY !== undefined) {
      const top = this.world.getGroundHeightBelow(x, footY, z);
      return top >= 0 ? top + 1 : 0;
    }
    const top = this.world.getHighestBlock(x, z);
    return top >= 0 ? top + 1 : 0;
  }

  private sendPositionUpdate(): void {
    if (!this.conn) return;
    if (this.health <= 0) return; // Dead — don't send position updates
    const now = performance.now();
    // Adaptive rate: 30Hz when moving/shooting, 10Hz when idle
    const vel = this.controls.getVelocity();
    const isActive = this.mountedVehicleId !== 0
      || this.controls.horizontalSpeed > 0.5
      || Math.abs(vel.y) > 0.5
      || this.mouseDown;
    const interval = this.mountedVehicleId !== 0 ? 16 : (isActive ? 33 : 100);
    if (now - this.lastPositionUpdate < interval) return;
    this.lastPositionUpdate = now;

    const mountedPose = this.getMountedVehiclePoseRaw();
    const px = mountedPose ? mountedPose.x : this.camera.position.x;
    const py = mountedPose ? mountedPose.y + 1.8 : this.camera.position.y;
    const pz = mountedPose ? mountedPose.z : this.camera.position.z;
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const sendYaw = this.mountedVehicleId !== 0 ? this.vehiclePilotYaw : e.y;
    const sendPitch = this.mountedVehicleId !== 0 ? this.vehiclePilotPitch : e.x;
    this.conn.reducers.updatePosition({
      pos: {
        x: Math.max(-1, Math.min(WORLD_X + 1, px)),
        y: Math.max(-10, Math.min(100, py)),
        z: Math.max(-1, Math.min(WORLD_Z + 1, pz)),
      },
      vel: { x: vel.x, y: vel.y, z: vel.z },
      rot: { yaw: sendYaw, pitch: sendPitch },
      weapon: this.weapons.currentWeapon,
    });

    if (this.mountedVehicleId !== 0) {
      const entityId = this.findLocalPlayerEntityId();
      if (entityId === 0n) return;
      if (now - this.lastHelicopterSyncAt >= 80) {
        this.lastHelicopterSyncAt = now;
        this.conn.reducers.syncEntityTransform({
          entityId,
          pos: { x: px, y: py, z: pz },
          vel: { x: vel.x, y: vel.y, z: vel.z },
          rot: { yaw: sendYaw, pitch: sendPitch },
        });
      }
    }
  }

  private findLocalPlayerEntityId(): bigint {
    if (!this.conn || !this.localIdentity) return 0n;
    for (const row of this.conn.db.player.iter()) {
      const p = row as any;
      if (p.identity.toHexString() !== this.localIdentity) continue;
      return BigInt(p.entityId ?? 0);
    }
    return 0n;
  }

  private getMountedVehiclePose(): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    if (this.mountedVehicleId === 0) return null;

    // Prefer the interpolated mesh position (smooth) over raw entity table (jumpy)
    // to avoid camera oscillation caused by discrete server snapshots.
    const heli = this.helicopters.get(this.mountedVehicleId);
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
    const entity = this.findEntityRow(this.mountedVehicleId);
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
  private getMountedVehiclePoseRaw(): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    if (this.mountedVehicleId === 0) return null;
    const entity = this.findEntityRow(this.mountedVehicleId);
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

  private syncMountedCameraToVehicle(delta: number): void {
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

    this.camera.position.copy(this.mountedCameraPosition);
    this.camera.lookAt(
      pose.x + fx * 18,
      pose.y + 2.2 + fy * 18,
      pose.z + fz * 18,
    );
    this.controls.resetVelocity();

    // Make helicopter semi-transparent when it's between camera and crosshair
    this.updateMountedHelicopterOpacity(pose, camDist);
  }

  private updateMountedHelicopterOpacity(
    pose: { x: number; y: number; z: number },
    camDist: number,
  ): void {
    const heli = this.helicopters.get(this.mountedVehicleId);
    if (!heli) return;

    // Compute vector from camera to helicopter center
    const dx = pose.x - this.camera.position.x;
    const dy = (pose.y + 1.5) - this.camera.position.y; // center of heli is ~1.5 above pivot
    const dz = pose.z - this.camera.position.z;
    const distToHeli = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distToHeli < 0.01) { this.setHelicopterOpacity(heli, 0.15); return; }

    // Dot product between camera forward and cam->heli direction
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
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

  // ── ANIMATION LOOP ──

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.elapsedTime += delta;

    // FPS
    this.frameCount++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      this.currentFps = Math.round(this.frameCount / this.fpsTime);
      this.frameCount = 0; this.fpsTime = 0;
    }

    const startupLocked = !this.startupWorldReady;
    if (startupLocked) {
      if (this.controls.locked) this.controls.unlock();
      this.controls.inputEnabled = false;
      this.weapons.setInputEnabled(false);
      this.controls.releaseAllInput();
      this.controls.resetVelocity();
      this.controls.justLanded = false;
      this.controls.justJumped = false;
      this.controls.stepTriggered = false;
    } else if (this.mountedVehicleId !== 0) {
      this.controls.inputEnabled = true;
      this.weapons.setInputEnabled(false);
    } else if (this.health <= 0) {
      // Dead — disable all input, freeze movement
      this.controls.inputEnabled = false;
      this.weapons.setInputEnabled(false);
      this.controls.releaseAllInput();
      this.controls.resetVelocity();
    } else if (!this.chatOpen && !this.loadoutMenuOpen) {
      this.controls.inputEnabled = true;
      this.weapons.setInputEnabled(true);
    }

    // Update systems
    if (!startupLocked) {
      if (this.mountedVehicleId === 0) {
        this.controls.update(delta, this.world);
      } else {
        this.controls.resetVelocity();
        this.controls.justLanded = false;
        this.controls.justJumped = false;
        this.controls.stepTriggered = false;
        this.controls.headBobX = 0;
        this.controls.headBobY = 0;
        this.controls.cameraTiltZ = 0;
        this.controls.sprintFovOffset = 0;
      }
    }

    this.camera.getWorldDirection(this.audioForward);
    this.audioUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    this.audio.setListenerPose(this.camera.position, this.audioForward, this.audioUp);

    // Landing impact effects
    if (this.controls.justLanded) {
      const intensity = this.controls.landingIntensity;
      if (intensity > 0.1) this.vfx.shake(intensity * 0.6);
      if (intensity > 0.15) this.audio.playLanding(intensity, this.localAudioSource(-1.7));
    }

    // Jump sound
    if (this.controls.justJumped) {
      this.audio.playJump(this.localAudioSource(-1.6));
      this.controls.justJumped = false;
    }

    // Footstep sounds
    if (this.controls.stepTriggered) {
      this.audio.playStep(this.controls.isSprinting, this.localAudioSource(-1.7));
    }

    // Slide start sound
    if (this.controls.isSliding && !this.wasSliding) {
      this.audio.playSlideStart(this.localAudioSource(-1.65));
    }
    this.wasSliding = this.controls.isSliding;

    // Auto-fire
    if (this.mouseDown && this.controls.locked) {
      if (this.mountedVehicleId !== 0) this.tryVehicleFire();
      else this.tryFire();
    }

    // Vehicle reload timer
    if (this.mountedVehicleId !== 0) this.tickVehicleReload();

    // Weapon switch via scroll
    if (this.weapons.currentWeapon !== this.lastWeaponIndex) {
      this.weaponModel.switchWeapon(this.weapons.currentWeapon);
      this.audio.playSwitch(this.localAudioSource(-0.1));
      this.lastWeaponIndex = this.weapons.currentWeapon;
    }

    // Physics (falling blocks)
    this.physics.update(delta);

    // Dynamic lights
    this.updateDynamicLights(delta);

    // Projectiles
    this.projectileManager.update(delta);

    // Server-authoritative grenade interpolation: extrapolate positions between server ticks
    for (const vis of this.grenadeVisuals.values()) {
      const elapsed = (performance.now() - vis.lastUpdateTime) / 1000;
      // Cap extrapolation to 200ms to avoid overshoot on stale data
      const t = Math.min(elapsed, 0.2);
      vis.mesh.position.set(
        vis.pos.x + vis.vel.x * t,
        vis.pos.y + vis.vel.y * t,
        vis.pos.z + vis.vel.z * t,
      );
      if (vis.light) vis.light.position.copy(vis.mesh.position);
      // Trail particles (only when moving, throttled by speed)
      const speed = vis.vel.length();
      if (speed > 1) {
        vis.trailTimer += delta;
        if (vis.trailTimer >= 0.35 / speed) {
          vis.trailTimer = 0;
          this.vfx.emitProjectileTrail(vis.mesh.position.x, vis.mesh.position.y, vis.mesh.position.z, 0x8dff66);
        }
      }
    }

    // Sky & environment
    this.sky.update(delta, this.camera.position);
    this.renderer.setClearColor(this.sky.getFogColor());

    // VFX
    this.vfx.update(delta);

    // Weapon model — pass movement state
    const moving = this.controls.moveForward || this.controls.moveBackward
      || this.controls.moveLeft || this.controls.moveRight;
    this.weaponModel.setMoving(moving, this.controls.isSprinting, this.controls.isCrouching,
      this.controls.isSliding, this.controls.strafeInput);
    this.weaponModel.update(delta);

    // Hit marker
    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer -= delta;
      if (this.hitMarkerTimer <= 0) this.hitMarkerType = 'none';
    }

    // Kill/Death sound detection
    if (this.kills > this.prevKills) {
      this.audio.playKillConfirm();
    }
    this.prevKills = this.kills;
    if (this.deaths > this.prevDeaths) {
      this.audio.playDeath(this.localAudioSource(-0.2));
    }
    this.prevDeaths = this.deaths;

    // Low health heartbeat
    if (this.health > 0 && this.health <= 25) {
      this.lowHealthHeartbeatTimer -= delta;
      if (this.lowHealthHeartbeatTimer <= 0) {
        this.audio.playHeartbeat(this.localAudioSource(-0.25));
        this.lowHealthHeartbeatTimer = this.health <= 10 ? 0.6 : 1.0;
      }
    } else {
      this.lowHealthHeartbeatTimer = 0;
    }

    // Interpolate remote players every frame
    const interpRot = { yaw: 0, pitch: 0 };
    for (const [id, group] of this.otherPlayers) {
      const buffer = this.interpBuffers.get(id);
      if (buffer && buffer.hasData()) {
        buffer.sample(group.position, interpRot);
        group.rotation.y = interpRot.yaw;
      }
    }

    if (this.mountedVehicleId !== 0) {
      this.syncMountedCameraToVehicle(delta);
    }

    // Chunk streaming (every 3 frames to load quickly)
    this.chunkLoadFrame++;
    if (this.chunkLoadFrame % CHUNK_STREAM_INTERVAL_FRAMES === 0) {
      this.updateChunkLoading();
    }

    if (this.mountedVehicleId !== 0) {
      this.syncVehicleInput();
    }

    // Interpolate helicopter entities every frame
    const heliRot = { yaw: 0, pitch: 0 };
    for (const [id, mesh] of this.helicopters) {
      if (id === this.mountedVehicleId) {
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
        const t = this.elapsedTime;

        // Vertical bob — two overlapping waves
        const bobY = (Math.sin(t * 1.1 + phase) * 0.045
                    + Math.sin(t * 2.3 + phase * 0.6) * 0.025) * idleBlend;
        // Lateral drift
        const driftX = (Math.sin(t * 0.7 + phase + 1.0) * 0.03
                      + Math.sin(t * 1.9 + phase * 0.8) * 0.015) * idleBlend;
        const driftZ = (Math.sin(t * 0.9 + phase + 2.0) * 0.025
                      + Math.sin(t * 1.5 + phase * 1.1) * 0.012) * idleBlend;

        // Rotation sway (radians) — very subtle
        const swayPitch = (Math.sin(t * 0.8 + phase + 0.5) * 0.012
                         + Math.sin(t * 1.7 + phase * 0.9) * 0.006) * idleBlend;
        const swayRoll  = (Math.sin(t * 0.6 + phase + 3.0) * 0.014
                         + Math.sin(t * 1.3 + phase * 0.7) * 0.007) * idleBlend;
        const swayYaw   = (Math.sin(t * 0.5 + phase + 4.0) * 0.008
                         + Math.sin(t * 1.1 + phase * 1.2) * 0.004) * idleBlend;

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
      if (id === this.mountedVehicleId) {
        // Local pilot — compute exact rate from current inputs
        let fwd = 0;
        if (this.controls.moveForward) fwd += 1;
        if (this.controls.moveBackward) fwd -= 1;
        let strafe = 0;
        if (this.controls.ePressed) strafe += 1;
        if (this.controls.qPressed) strafe -= 1;
        let lift = 0;
        if (this.controls.spacePressed) lift += 1;
        if (this.controls.shiftHeld) lift -= 1;
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

      mesh.updateMatrixWorld();
      this.updateHelicopterLightRig(id, mesh);
    }

    this.ensureSpawnGroundReady();

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
        this.scene.remove(piece.mesh);
        piece.mesh.geometry.dispose();
        if (Array.isArray(piece.mesh.material)) {
          for (const mat of piece.mesh.material) mat.dispose();
        } else {
          piece.mesh.material.dispose();
        }
        this.helicopterBreakupPieces.splice(i, 1);
      }
    }

    const startupProgress = this.startupWorldReady ? 1 : this.getStartupLoadProgress();
    if (!this.startupWorldReady) {
      if (startupProgress > this.startupProgressPrev + 0.0005) {
        this.startupProgressStallTime = 0;
      } else {
        this.startupProgressStallTime += delta;
      }
      this.startupProgressPrev = startupProgress;

      if (this.startupProgressStallTime > 1.2) {
        this.startupProgressStallTime = 0;
        this.rehydrateSubscribedChunks(96);
      }
    }

    if (!this.startupWorldReady && startupProgress >= 1) {
      this.startupWorldReady = true;
      this.startupProgressPrev = 1;
      this.startupProgressStallTime = 0;
    }

    // Shadow camera follows player
    const sp = this.camera.position;
    this.sun.position.set(sp.x + 50, 80, sp.z + 30);
    this.sun.target.position.set(sp.x, 0, sp.z);

    // Position sync
    if (this.controls.locked || this.spawnProtected || this.mountedVehicleId !== 0) {
      this.sendPositionUpdate();
    }

    // Rebuild dirty chunks with a frame budget (prevents movement hitches)
    const isMoving = this.controls.moveForward || this.controls.moveBackward
      || this.controls.moveLeft || this.controls.moveRight
      || this.controls.isSliding || !this.controls.onGround;
    this.world.rebuildDirtyChunks(
      this.scene,
      isMoving ? CHUNK_REBUILD_BUDGET_MOVING : CHUNK_REBUILD_BUDGET_IDLE,
    );

    // ── RENDER PASSES ──
    // Apply head bob + screen shake + camera effects just for rendering, then undo
    const savedQuat = this.camera.quaternion.clone();
    const savedPos = this.camera.position.clone();
    const savedFov = this.camera.fov;
    let fovChanged = false;

    // Sprint/Slide FOV effect
    if (Math.abs(this.controls.sprintFovOffset) > 0.01) {
      this.camera.fov = this.baseFov + this.controls.sprintFovOffset;
      this.camera.updateProjectionMatrix();
      fovChanged = true;
    }

    // Head bob offset
    this.camera.position.y += this.controls.headBobY;
    this.camera.position.x += this.controls.headBobX;

    // Camera tilt (strafe roll)
    if (Math.abs(this.controls.cameraTiltZ) > 0.0001) {
      const tiltEuler = new THREE.Euler(0, 0, this.controls.cameraTiltZ, 'YXZ');
      const tiltQuat = new THREE.Quaternion().setFromEuler(tiltEuler);
      this.camera.quaternion.multiply(tiltQuat);
    }

    // Screen shake
    if (this.vfx.shakeOffsetX !== 0 || this.vfx.shakeOffsetY !== 0) {
      const shakeQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.vfx.shakeOffsetX, this.vfx.shakeOffsetY, 0, 'YXZ'),
      );
      this.camera.quaternion.multiply(shakeQuat);
    }

    // PostFX
    this.postfx.update(delta, this.elapsedTime);

    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    if (this.mountedVehicleId === 0) {
      this.renderer.render(this.weaponModel.scene, this.weaponModel.camera);
    }
    this.postfx.render(this.renderer);
    this.renderer.autoClear = true;

    // Restore clean camera
    this.camera.quaternion.copy(savedQuat);
    this.camera.position.copy(savedPos);
    if (fovChanged) {
      this.camera.fov = savedFov;
      this.camera.updateProjectionMatrix();
    }

    // Push state to HUD (use server ammo for current weapon)
    const wp = WEAPONS[this.weapons.currentWeapon];
    const pc = this.conn
      ? Array.from(this.conn.db.player.iter()).filter((p: any) => p.online).length : 1;
    // Compute heading from camera yaw (0-360 degrees, 0=North)
    const camEuler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const headingRad = camEuler.y;
    const headingDeg = (((-headingRad * 180 / Math.PI) % 360) + 360) % 360;
    const mountedPose = this.getMountedVehiclePose();
    const vehicleAltitude = mountedPose
      ? Math.max(0, mountedPose.y - this.getGroundHeight(mountedPose.x, mountedPose.z, mountedPose.y))
      : 0;

    // Vehicle HUD data
    let vehicleHealth = 0;
    let vehicleMaxHealth = HELI_HEALTH_MAX;
    let vehicleSpeed = 0;
    let nearVehicle = false;

    if (this.mountedVehicleId !== 0) {
      const vRow = this.getVehicleRow(this.mountedVehicleId);
      if (vRow) {
        vehicleHealth = Number(vRow.health ?? 0);
        vehicleMaxHealth = HELI_HEALTH_MAX;
        // Read server ammo to reconcile client prediction
        // Skip reconciliation for weapons currently reloading (server already set max, but client waits for timer)
        const now = performance.now();
        const serverAmmoPrimary = Number(vRow.weaponAmmoPrimary ?? 0);
        const serverAmmoSecondary = Number(vRow.weaponAmmoSecondary ?? 0);
        if (Number.isFinite(serverAmmoPrimary) && this.vehicleReloadingUntil[0] <= now) this.vehicleAmmo[0] = serverAmmoPrimary;
        if (Number.isFinite(serverAmmoSecondary) && this.vehicleReloadingUntil[1] <= now) this.vehicleAmmo[1] = serverAmmoSecondary;
        // Sync weapon type from server
        const serverWeaponType = Number(vRow.weaponType ?? 0);
        if (Number.isFinite(serverWeaponType) && serverWeaponType < VEHICLE_WEAPONS.length) {
          this.vehicleWeaponIndex = serverWeaponType;
        }
      }
      const entity = this.findEntityRow(this.mountedVehicleId);
      if (entity) {
        const vel = entity.vel || { x: 0, y: 0, z: 0 };
        vehicleSpeed = Math.sqrt(
          Number(vel.x) ** 2 + Number(vel.y) ** 2 + Number(vel.z) ** 2,
        );
      }
    } else {
      // Check for nearby vehicle (for "ENTER" prompt)
      nearVehicle = this.isNearVehicle();
    }

    const curVehWep = VEHICLE_WEAPONS[this.vehicleWeaponIndex];

    this.onStateChange({
      weapon: this.weapons.currentWeapon,
      loadout: this.weapons.loadout,
      ammo: wp.ammo, maxAmmo: wp.maxAmmo,
      weaponName: wp.name, weaponColor: wp.color,
      fps: this.currentFps, locked: this.controls.locked,
      playerCount: pc, health: this.health,
      kills: this.kills, deaths: this.deaths,
      hitMarker: this.hitMarkerTimer > 0,
      hitMarkerType: this.hitMarkerType,
      timeOfDay: this.sky.getTimeString(),
      weather: this.sky.getWeatherName(),
      heading: headingDeg,
      isReloading: false,
      worldReady: this.startupWorldReady,
      worldLoadProgress: startupProgress,
      mountedVehicleName: this.mountedVehicleId !== 0 ? 'Helicopter' : null,
      vehicleAltitude: this.mountedVehicleId !== 0 ? vehicleAltitude : 0,
      vehicleHealth,
      vehicleMaxHealth,
      vehicleWeapon: this.vehicleWeaponIndex,
      vehicleWeaponName: curVehWep?.name ?? '',
      vehicleAmmo: this.vehicleAmmo[this.vehicleWeaponIndex] ?? 0,
      vehicleMaxAmmo: curVehWep?.maxAmmo ?? 0,
      vehicleSpeed,
      vehicleReloading: this.mountedVehicleId !== 0 && this.vehicleReloadingUntil[this.vehicleWeaponIndex] > performance.now(),
      nearVehicle,
    });
  };

  // ── RESIZE ──

  private onResize = (): void => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.weaponModel.resize(w / h);
  };

  // ── DESTROY ──

  destroy(): void {
    cancelAnimationFrame(this.animationId);
    this.container.removeEventListener('mousedown', this.onMouseDown);
    this.container.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('mousemove', this.onVehicleMouseMove);
    document.removeEventListener('wheel', this.onVehicleWheel);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.sky.dispose();
    this.vfx.dispose();
    this.projectileManager.dispose();
    // Clean up grenade visuals
    for (const vis of this.grenadeVisuals.values()) {
      this.scene.remove(vis.mesh);
      vis.mesh.geometry.dispose();
      (vis.mesh.material as THREE.Material).dispose();
      if (vis.light) {
        this.scene.remove(vis.light);
        vis.light.dispose();
      }
    }
    this.grenadeVisuals.clear();
    this.physics.dispose();
    this.weaponModel.dispose();
    this.postfx.dispose();
    this.audio.dispose();
    this.world.dispose(this.scene);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    for (const id of Array.from(this.otherPlayers.keys())) this.removeOtherPlayer(id);
    for (const id of Array.from(this.helicopters.keys())) this.removeHelicopterMesh(id);
    for (const piece of this.helicopterBreakupPieces) {
      this.scene.remove(piece.mesh);
      piece.mesh.geometry.dispose();
      if (Array.isArray(piece.mesh.material)) {
        for (const mat of piece.mesh.material) mat.dispose();
      } else {
        piece.mesh.material.dispose();
      }
    }
    this.helicopterBreakupPieces.length = 0;
    for (const timer of this.pendingHelicopterDestroyFallbacks.values()) {
      window.clearTimeout(timer);
    }
    this.pendingHelicopterDestroyFallbacks.clear();
    this.recentHelicopterBreakups.clear();
    this.clearLanternGlows();
    if (this.lanternGlowPoints) {
      this.scene.remove(this.lanternGlowPoints);
      this.lanternGlowPoints.geometry.dispose();
      (this.lanternGlowPoints.material as THREE.Material).dispose();
      this.lanternGlowPoints = null;
    }
    if (this.lanternGlowTexture) {
      this.lanternGlowTexture.dispose();
      this.lanternGlowTexture = null;
    }
    this.lanternLightKeyById.clear();
    for (const id of Array.from(this.dynamicLights.keys())) this.removeDynamicLight(id);
  }
}
