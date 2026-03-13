import * as THREE from 'three';
import { VoxelWorld, BLOCK_COLORS, WORLD_X, WORLD_Y, WORLD_Z, CHUNK, packChunkId, unpackChunkId } from './VoxelWorld';
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
const VEHICLE_INPUT_INTERVAL_MS = 33;

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
  }>();
  private dynamicLightSeq = 0;

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
  private lastHelicopterSyncAt = 0;

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
      this.tryFire();
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
      if (this.mountedVehicleId !== 0) return;
      this.weapons.reload(); // Client prediction
      this.audio.playReload(this.localAudioSource(-0.15));
      // Server-authoritative reload
      if (this.conn) this.conn.reducers.reloadWeapon({});
    }
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
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

  private toVec3(v: THREE.Vector3 | { x: number; y: number; z: number }): THREE.Vector3 {
    return v instanceof THREE.Vector3 ? v : new THREE.Vector3(v.x, v.y, v.z);
  }

  /** Runtime light source API for gameplay objects and cinematics. Returns light id. */
  addDynamicLight(options: DynamicLightOptions): string {
    const id = `dyn-${++this.dynamicLightSeq}`;
    const type = options.type ?? 'point';
    const color = options.color ?? 0xffffff;
    const decay = options.decay ?? 2;

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
      this.dynamicLights.set(id, { light, target, ttl: options.ttl ?? null });
      return id;
    }

    const light = new THREE.PointLight(color, options.intensity, options.distance, decay);
    light.castShadow = options.castShadow ?? false;
    light.position.copy(this.toVec3(options.position));
    this.scene.add(light);
    this.dynamicLights.set(id, { light, ttl: options.ttl ?? null });
    return id;
  }

  updateDynamicLight(id: string, patch: Partial<DynamicLightOptions>): void {
    const entry = this.dynamicLights.get(id);
    if (!entry) return;
    const light = entry.light;

    if (patch.position) light.position.copy(this.toVec3(patch.position));
    if (patch.color !== undefined) light.color.set(patch.color);
    if (patch.intensity !== undefined) light.intensity = patch.intensity;
    if (patch.distance !== undefined) light.distance = patch.distance;
    if (patch.decay !== undefined) light.decay = patch.decay;
    if (patch.castShadow !== undefined) light.castShadow = patch.castShadow;
    if (patch.ttl !== undefined) entry.ttl = patch.ttl;

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
    this.scene.remove(entry.light);
    if (entry.target) this.scene.remove(entry.target);
    entry.light.dispose();
    this.dynamicLights.delete(id);
  }

  private updateDynamicLights(delta: number): void {
    for (const [id, entry] of this.dynamicLights) {
      if (entry.ttl === null) continue;
      entry.ttl -= delta;
      if (entry.ttl <= 0) this.removeDynamicLight(id);
    }
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

  /** Handle projectile impact (called by ProjectileManager when a local projectile hits) */
  private handleProjectileImpact(impact: ProjectileImpact): void {
    const w = WEAPONS[impact.weaponIndex];

    // Audio
    this.audio.playBlockBreak({
      position: {
        x: impact.hitPos.x + 0.5,
        y: impact.hitPos.y + 0.5,
        z: impact.hitPos.z + 0.5,
      },
    });
    if (w.radius > 0) {
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
    if (w.radius > 0) {
      this.vfx.emitExplosion(impact.hitPos.x, impact.hitPos.y, impact.hitPos.z, w.radius);
      this.applyExplosionCameraEffects(impact.hitPos.x, impact.hitPos.y, impact.hitPos.z, w.radius, w.damage);
    }

    // Explosion physics: knockback + flying debris + force on existing falling blocks
    if (w.radius > 0) {
      const hx = impact.hitPos.x, hy = impact.hitPos.y, hz = impact.hitPos.z;

      // Player knockback (rocket jumping etc.)
      this.applyExplosionKnockback(hx, hy, hz, w.radius, w.damage);

      // Spawn destroyed blocks as flying physics debris
      if (impact.destroyedBlocks.length > 0) {
        this.physics.spawnExplosionDebris(impact.destroyedBlocks, hx, hy, hz, w.radius, w.damage * 0.2);
      }

      // Push already-falling blocks
      this.physics.applyExplosionForce(hx, hy, hz, w.radius * 2, w.damage * 1.5);
    }

    // Rebuild affected chunks
    this.world.rebuildDirtyChunks(this.scene);

    // Server sync: projectile impact
    this.syncImpactToServer(impact);
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

  /** Send fire event to server with hit players and destroyed blocks */
  private syncFireToServer(result: { weaponIndex: number; destroyedBlocks: { x: number; y: number; z: number }[]; hitPlayerIds: string[]; origin: THREE.Vector3; direction: THREE.Vector3 }): void {
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
      hitBlocks: impact.destroyedBlocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
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
      const w = WEAPONS[weaponIdx];
      if (!w) return;

      const origin = new THREE.Vector3(shot.origin.x, shot.origin.y, shot.origin.z);
      const dir = new THREE.Vector3(shot.direction.x, shot.direction.y, shot.direction.z);
      this.playRemoteWeaponAudio(weaponIdx, origin, dir);

      if (isFinite(w.projectile.speed)) {
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

        // Skip if we are the originator (we already played local VFX)
        if (originId === this.localIdentity) return;

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
        this.removeHelicopterMesh(id);
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
        this.removeHelicopterMesh(Number(row.entityId));
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
        this.pendingChunkRequests.clear();
        this.queuedChunkRequests.clear();
        this.chunkRequestQueue.length = 0;
        this.bootstrapRequestQueue.length = 0;
        this.bootstrapQueued.clear();
        for (const id of Array.from(this.helicopters.keys())) this.removeHelicopterMesh(id);
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

    // -- Materials --
    const shellMat = new THREE.MeshLambertMaterial({ color: 0x3a4148 });
    const shellDarkMat = new THREE.MeshLambertMaterial({ color: 0x2c3136 });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x171b1f });
    const accentMat = new THREE.MeshLambertMaterial({ color: 0x4ad2ff, emissive: 0x0a1f2a, emissiveIntensity: 0.35 });
    const glassMat = new THREE.MeshLambertMaterial({
      color: 0x83d8ff, emissive: 0x0a2f3d, emissiveIntensity: 0.45,
      transparent: true, opacity: 0.82, side: THREE.DoubleSide,
    });
    const skidMat = new THREE.MeshLambertMaterial({ color: 0x222629 });
    const exhaustMat = new THREE.MeshLambertMaterial({ color: 0x1a1d20 });
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0x8ff4ff, emissive: 0x12303a, emissiveIntensity: 0.3 });
    const tailBladeMat = new THREE.MeshLambertMaterial({ color: 0x93f2ff, emissive: 0x14323d, emissiveIntensity: 0.2 });

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    // Helper: add a box to a parent group
    const addBox = (
      parent: THREE.Object3D,
      size: [number, number, number],
      material: THREE.Material,
      position: [number, number, number],
      rotation: [number, number, number] = [0, 0, 0],
    ): THREE.Mesh => {
      const mesh = mk(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      parent.add(mesh);
      return mesh;
    };

    // =============================================
    // FUSELAGE — layered, cohesive body
    // =============================================
    const fuselage = new THREE.Group();
    fuselage.name = 'fuselage';
    heli.add(fuselage);

    // Main cabin — large central body
    addBox(fuselage, [5.0, 2.2, 2.8], shellMat, [0, 2.4, 0]);
    // Cabin roof (slightly wider for shape)
    addBox(fuselage, [4.4, 0.35, 2.6], shellDarkMat, [0, 3.55, 0]);
    // Cabin floor / underside
    addBox(fuselage, [5.2, 0.3, 2.6], darkMat, [0, 1.25, 0]);

    // Nose section — tapers forward
    addBox(fuselage, [2.0, 1.8, 2.5], shellMat, [3.2, 2.5, 0]);
    // Nose taper (angled front)
    addBox(fuselage, [1.2, 1.4, 2.2], shellMat, [4.4, 2.55, 0], [0.12, 0, 0]);
    // Nose underside panel
    addBox(fuselage, [2.4, 0.3, 2.3], darkMat, [3.4, 1.55, 0]);

    // Cockpit windshield — large angled glass
    addBox(fuselage, [1.6, 1.5, 2.3], glassMat, [4.0, 2.9, 0], [0.15, 0, 0]);
    // Cockpit side windows
    addBox(fuselage, [1.8, 0.9, 0.08], glassMat, [3.6, 2.9, -1.42]);
    addBox(fuselage, [1.8, 0.9, 0.08], glassMat, [3.6, 2.9, 1.42]);
    // Cabin side windows (two per side)
    addBox(fuselage, [0.9, 0.7, 0.08], glassMat, [1.0, 2.9, -1.42]);
    addBox(fuselage, [0.9, 0.7, 0.08], glassMat, [1.0, 2.9, 1.42]);
    addBox(fuselage, [0.9, 0.7, 0.08], glassMat, [-0.5, 2.9, -1.42]);
    addBox(fuselage, [0.9, 0.7, 0.08], glassMat, [-0.5, 2.9, 1.42]);

    // Rear fuselage transition (narrows toward tail)
    addBox(fuselage, [1.8, 1.6, 2.2], shellMat, [-2.8, 2.5, 0]);
    addBox(fuselage, [1.0, 1.2, 1.6], shellDarkMat, [-3.8, 2.5, 0]);

    // Engine cowling (top of cabin, behind rotor mast)
    addBox(fuselage, [2.4, 0.7, 2.0], shellDarkMat, [-0.5, 3.75, 0]);
    // Engine intake scoops (small boxes on top sides)
    addBox(fuselage, [0.8, 0.35, 0.5], darkMat, [-0.2, 4.15, -0.9]);
    addBox(fuselage, [0.8, 0.35, 0.5], darkMat, [-0.2, 4.15, 0.9]);

    // Exhaust pipes (rear sides of engine cowling)
    const exhaust1 = mk(new THREE.CylinderGeometry(0.15, 0.12, 0.6, 6), exhaustMat);
    exhaust1.position.set(-1.9, 3.7, -0.7);
    exhaust1.rotation.z = Math.PI / 2;
    fuselage.add(exhaust1);
    const exhaust2 = mk(new THREE.CylinderGeometry(0.15, 0.12, 0.6, 6), exhaustMat);
    exhaust2.position.set(-1.9, 3.7, 0.7);
    exhaust2.rotation.z = Math.PI / 2;
    fuselage.add(exhaust2);

    // =============================================
    // ACCENT DETAILS — stripes and trim
    // =============================================
    // Side accent stripes (run along fuselage lower edge)
    addBox(fuselage, [7.0, 0.15, 0.12], accentMat, [0.3, 1.5, -1.42]);
    addBox(fuselage, [7.0, 0.15, 0.12], accentMat, [0.3, 1.5, 1.42]);
    // Nose accent trim
    addBox(fuselage, [0.12, 0.8, 2.0], accentMat, [5.0, 2.5, 0]);
    // Tail accent stripe (on transition)
    addBox(fuselage, [0.12, 1.0, 1.8], accentMat, [-3.3, 2.5, 0]);

    // =============================================
    // TAIL BOOM — properly proportioned, connected
    // =============================================
    const tail = new THREE.Group();
    tail.name = 'tail-section';
    tail.position.set(-4.3, 2.5, 0);
    heli.add(tail);

    // Tail boom — tapers from fuselage
    addBox(tail, [1.5, 0.9, 0.9], shellMat, [-0.3, 0, 0]);
    addBox(tail, [1.5, 0.75, 0.75], shellMat, [-1.6, 0.05, 0]);
    addBox(tail, [1.5, 0.6, 0.6], shellDarkMat, [-2.8, 0.1, 0]);
    addBox(tail, [1.2, 0.5, 0.5], shellDarkMat, [-3.8, 0.15, 0]);

    // Tail boom accent stripe
    addBox(tail, [4.5, 0.1, 0.08], accentMat, [-2.0, 0.45, 0]);

    // Vertical stabilizer (tail fin)
    addBox(tail, [0.9, 1.8, 0.2], darkMat, [-4.2, 1.1, 0]);
    // Vertical fin tip accent
    addBox(tail, [0.7, 0.12, 0.22], accentMat, [-4.2, 2.0, 0]);

    // Horizontal stabilizers (small wings at tail end)
    addBox(tail, [0.6, 0.15, 1.8], shellDarkMat, [-4.0, 0.2, 0]);
    // Stabilizer tip accents
    addBox(tail, [0.4, 0.12, 0.12], accentMat, [-4.0, 0.28, -0.95]);
    addBox(tail, [0.4, 0.12, 0.12], accentMat, [-4.0, 0.28, 0.95]);

    // Small ventral fin (underneath tail end)
    addBox(tail, [0.6, 0.7, 0.15], darkMat, [-4.0, -0.5, 0]);

    // =============================================
    // TAIL ROTOR — on fin, properly sized
    // =============================================
    const tailRotor = new THREE.Group();
    tailRotor.name = 'helicopter-tail-rotor';
    tailRotor.position.set(-4.3, 1.2, 0.14);
    tail.add(tailRotor);

    // Tail rotor hub
    const tailHub = mk(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 6), darkMat);
    tailHub.rotation.x = Math.PI / 2;
    tailRotor.add(tailHub);

    // Tail rotor blades (4 blades, cross pattern)
    for (let i = 0; i < 4; i++) {
      const tb = mk(new THREE.BoxGeometry(0.06, 0.8, 0.06), tailBladeMat);
      tb.rotation.z = (Math.PI / 2) * i;
      // Offset so blades are centered on hub but extend outward
      if (i % 2 === 0) {
        tb.position.set(0, 0, 0);
      } else {
        tb.geometry = new THREE.BoxGeometry(0.06, 0.06, 0.8);
      }
      tailRotor.add(tb);
    }

    // =============================================
    // LANDING SKIDS — two tubular skids with struts
    // =============================================
    for (const side of [-1, 1]) {
      const z = side * 1.1;

      // Main skid runner (horizontal tube)
      const runner = mk(new THREE.BoxGeometry(5.5, 0.15, 0.15), skidMat);
      runner.position.set(0.5, 0.6, z);
      heli.add(runner);

      // Front upturn
      const frontUp = mk(new THREE.BoxGeometry(0.15, 0.4, 0.15), skidMat);
      frontUp.position.set(3.3, 0.8, z);
      frontUp.rotation.z = -0.3;
      heli.add(frontUp);

      // Front strut (connects skid to fuselage)
      const frontStrut = mk(new THREE.BoxGeometry(0.12, 1.0, 0.12), skidMat);
      frontStrut.position.set(2.0, 1.1, z);
      frontStrut.rotation.z = 0.08;
      heli.add(frontStrut);

      // Rear strut
      const rearStrut = mk(new THREE.BoxGeometry(0.12, 1.0, 0.12), skidMat);
      rearStrut.position.set(-1.2, 1.1, z);
      rearStrut.rotation.z = -0.08;
      heli.add(rearStrut);

      // Cross-brace between struts (at fuselage attachment point)
      addBox(heli, [0.1, 0.1, side * (z - side * 0.15)], skidMat, [2.0, 1.55, side * 0.55]);
      addBox(heli, [0.1, 0.1, side * (z - side * 0.15)], skidMat, [-1.2, 1.55, side * 0.55]);
    }

    // =============================================
    // MAIN ROTOR — properly proportioned with hub
    // =============================================
    const mainRotor = new THREE.Group();
    mainRotor.name = 'helicopter-main-rotor';
    mainRotor.position.set(-0.3, 4.25, 0);
    heli.add(mainRotor);

    // Rotor mast (connects engine cowling to rotor hub)
    const mast = mk(new THREE.CylinderGeometry(0.12, 0.15, 0.5, 8), darkMat);
    mast.position.set(0, -0.25, 0);
    mainRotor.add(mast);

    // Rotor hub (disc at top of mast)
    const hub = mk(new THREE.CylinderGeometry(0.35, 0.3, 0.18, 8), darkMat);
    hub.position.set(0, 0.02, 0);
    mainRotor.add(hub);

    // Main rotor blades (4 blades, slightly tapered via two segments each)
    for (let i = 0; i < 4; i++) {
      const bladeGroup = new THREE.Group();
      bladeGroup.rotation.y = (Math.PI / 2) * i;
      mainRotor.add(bladeGroup);

      // Inner blade segment (wider near hub)
      const inner = mk(new THREE.BoxGeometry(0.35, 0.06, 3.0), bladeMat);
      inner.position.set(0, 0, 1.8);
      bladeGroup.add(inner);

      // Outer blade segment (slightly narrower at tip)
      const outer = mk(new THREE.BoxGeometry(0.28, 0.05, 3.2), bladeMat);
      outer.position.set(0, 0, 4.6);
      bladeGroup.add(outer);
    }

    // =============================================
    // EXTRA DETAILS — doors, panels, lights
    // =============================================
    // Door outlines (dark inset lines on cabin sides)
    addBox(fuselage, [0.06, 1.6, 0.06], darkMat, [1.8, 2.4, -1.42]);
    addBox(fuselage, [0.06, 1.6, 0.06], darkMat, [1.8, 2.4, 1.42]);
    addBox(fuselage, [0.06, 1.6, 0.06], darkMat, [0.0, 2.4, -1.42]);
    addBox(fuselage, [0.06, 1.6, 0.06], darkMat, [0.0, 2.4, 1.42]);

    // Navigation lights (small accent boxes on nose and tail)
    addBox(fuselage, [0.12, 0.12, 0.12], accentMat, [5.05, 2.3, 0]); // nose light
    addBox(tail, [0.1, 0.1, 0.1], accentMat, [-4.5, 2.0, 0]); // tail top light

    // Anti-collision light on belly
    const bellyLight = mk(new THREE.BoxGeometry(0.18, 0.1, 0.18), accentMat);
    bellyLight.position.set(0, 1.18, 0);
    fuselage.add(bellyLight);

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

  private ensureHelicopterMesh(entityId: number): THREE.Group {
    let mesh = this.helicopters.get(entityId);
    if (mesh) return mesh;

    mesh = this.createHelicopterModel();
    mesh.userData.entityId = entityId;
    mesh.userData.rotorSpin = 0;
    this.scene.add(mesh);
    this.helicopters.set(entityId, mesh);
    this.helicopterBuffers.set(entityId, new InterpolationBuffer());
    return mesh;
  }

  private removeHelicopterMesh(entityId: number): void {
    const mesh = this.helicopters.get(entityId);
    if (!mesh) return;
    this.scene.remove(mesh);
    this.disposeObjectMaterials(mesh);
    this.helicopters.delete(entityId);
    this.helicopterBuffers.delete(entityId);
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

    const spin = Number(vehicle.rotorSpin ?? 0);
    mesh.userData.rotorSpin = Number.isFinite(spin) ? spin : 0;
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

    let forward = 0;
    if (this.controls.moveForward) forward += 1;
    if (this.controls.moveBackward) forward -= 1;

    let strafe = 0;
    if (this.controls.moveRight) strafe += 1;
    if (this.controls.moveLeft) strafe -= 1;

    let lift = 0;
    if (this.controls.spacePressed) lift += 1;
    if (this.controls.shiftHeld) lift -= 1;

    let yaw = 0;
    if (this.controls.moveLeft) yaw -= 1;
    if (this.controls.moveRight) yaw += 1;
    if (this.controls.ctrlHeld) yaw += (this.controls.moveForward ? -0.5 : 0);

    this.conn.reducers.updateVehicleInput({
      forward,
      strafe,
      lift,
      yaw,
      boosting: this.controls.isSprinting,
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
    const interval = isActive ? 33 : 100;
    if (now - this.lastPositionUpdate < interval) return;
    this.lastPositionUpdate = now;
    const p = this.camera.position;
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.conn.reducers.updatePosition({
      pos: {
        x: Math.max(-1, Math.min(WORLD_X + 1, p.x)),
        y: Math.max(-10, Math.min(100, p.y)),
        z: Math.max(-1, Math.min(WORLD_Z + 1, p.z)),
      },
      vel: { x: vel.x, y: vel.y, z: vel.z },
      rot: { yaw: e.y, pitch: e.x },
      weapon: this.weapons.currentWeapon,
    });

    if (this.mountedVehicleId !== 0) {
      const entityId = this.findLocalPlayerEntityId();
      if (entityId === 0n) return;
      if (now - this.lastHelicopterSyncAt >= 80) {
        this.lastHelicopterSyncAt = now;
        this.conn.reducers.syncEntityTransform({
          entityId,
          pos: { x: p.x, y: p.y, z: p.z },
          vel: { x: vel.x, y: vel.y, z: vel.z },
          rot: { yaw: e.y, pitch: e.x },
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

  private syncMountedCameraToVehicle(): void {
    if (this.mountedVehicleId === 0) return;

    const heli = this.helicopters.get(this.mountedVehicleId);
    if (heli) {
      this.camera.position.set(heli.position.x, heli.position.y + 1.8, heli.position.z);
      this.controls.resetVelocity();
      return;
    }

    const entity = this.findEntityRow(this.mountedVehicleId);
    if (entity) {
      this.camera.position.set(entity.pos.x, entity.pos.y + 1.8, entity.pos.z);
      this.controls.resetVelocity();
    }
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
    if (this.mouseDown && this.controls.locked) this.tryFire();

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
      this.syncMountedCameraToVehicle();
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
      const buffer = this.helicopterBuffers.get(id);
      if (buffer && buffer.hasData()) {
        buffer.sample(mesh.position, heliRot);
        mesh.rotation.set(heliRot.pitch, heliRot.yaw, 0);
      }

      const spin = Number(mesh.userData.rotorSpin ?? 0);
      const mainRotor = mesh.getObjectByName('helicopter-main-rotor');
      if (mainRotor) mainRotor.rotation.y = spin;
      const tailRotor = mesh.getObjectByName('helicopter-tail-rotor');
      if (tailRotor) tailRotor.rotation.x = spin * 3.4;
    }

    this.ensureSpawnGroundReady();

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
    this.renderer.render(this.weaponModel.scene, this.weaponModel.camera);
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
      vehicleAltitude: this.mountedVehicleId !== 0
        ? Math.max(0, this.camera.position.y - this.getGroundHeight(this.camera.position.x, this.camera.position.z, this.camera.position.y))
        : 0,
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
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.sky.dispose();
    this.vfx.dispose();
    this.projectileManager.dispose();
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
    for (const id of Array.from(this.dynamicLights.keys())) this.removeDynamicLight(id);
  }
}
