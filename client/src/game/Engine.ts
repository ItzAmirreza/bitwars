import * as THREE from 'three';
import { VoxelWorld, WORLD_X, WORLD_Y, WORLD_Z, packChunkId } from './VoxelWorld';
import { FPSControls } from './FPSControls';
import { WeaponSystem, WEAPONS } from './Weapons';
import { AudioSystem } from './AudioSystem';
import { VFX } from './VFX';
import { WeaponModel } from './WeaponModel';
import { PostFX } from './PostFX';
import { PhysicsSystem } from './PhysicsSystem';
import { ProjectileManager } from './ProjectileManager';
import { SkySystem } from './SkySystem';
import { LanternSystem } from './LanternSystem';
import type { LanternContext } from './LanternSystem';
import { ChunkStreamer, CHUNK_STREAM_INTERVAL_FRAMES, CHUNK_REBUILD_BUDGET_MOVING, CHUNK_REBUILD_BUDGET_IDLE } from './ChunkStreamer';
import { RemotePlayerManager, disposeObjectMaterials } from './RemotePlayerManager';
import VehicleManager, { VEHICLE_WEAPONS } from './vehicles/VehicleManager';
import type { VehicleEngineContext } from './vehicles/VehicleManager';
import { InfantryFireController } from './InfantryFireController';
import type { InfantryFireContext } from './InfantryFireController';
import { VehicleFireController } from './VehicleFireController';
import type { VehicleFireContext } from './VehicleFireController';
import { ENTITY_KINDS } from '../shared-config';
import type { DbConnection } from '../module_bindings';
import type { GameSettings } from '../store';

const ENTITY_KIND_VEHICLE = ENTITY_KINDS.Vehicle;


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
  private lanterns = new LanternSystem();

  // Vehicle manager
  private vehicleManager!: VehicleManager;

  // Fire controllers
  private infantryFire!: InfantryFireController;
  private vehicleFire!: VehicleFireController;

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
  private remotePlayers!: RemotePlayerManager;
  private localIdentity: string | null = null;
  private mountedVehicleId = 0;
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
  private chunkStreamer!: ChunkStreamer;

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

    // ── Chunk streamer ──
    this.chunkStreamer = new ChunkStreamer({
      conn: this.conn,
      camera: this.camera,
      world: this.world,
      localIdentity: this.localIdentity,
      scene: this.scene,
      onChunkLoaded: (cx, cy, cz, decoded) => this.lanterns.syncLanternLightsForChunk(cx, cy, cz, this.getLanternContext(), decoded),
      onChunkUnloading: (chunkId) => this.lanterns.clearLanternLightsForChunk(chunkId, this.getLanternContext()),
    });
    this.chunkStreamer.loadWorldFromServer();
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

    // ── Remote players ──
    this.remotePlayers = new RemotePlayerManager({ scene: this.scene, localIdentity: this.localIdentity });

    // ── Weapons ──
    this.weapons = new WeaponSystem(this.camera, this.world);
    this.weapons.setOtherPlayers(this.remotePlayers.otherPlayers);

    // ── Audio ──
    this.audio = new AudioSystem();
    this.audio.setOcclusionSampler((x: number, y: number, z: number) => this.world.getBlock(x, y, z) !== 0);
    this.audio.setListenerPose(this.camera.position, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });

    // ── VFX ──
    this.vfx = new VFX(this.scene, this.camera);

    // ── Physics ──
    this.physics = new PhysicsSystem(this.scene, this.world, this.vfx, this.audio);

    // ── Projectiles ──
    // NOTE: infantryFire is initialized after this, but the callback is only called
    // at runtime (not during construction), so the reference is valid by then.
    this.projectileManager = new ProjectileManager(
      this.scene, this.world, this.weapons, this.vfx, this.remotePlayers.otherPlayers,
      (impact) => this.infantryFire.handleProjectileImpact(impact),
    );

    // ── Weapon Model ──
    this.weaponModel = new WeaponModel(w / h);

    // ── PostFX ──
    this.postfx = new PostFX();

    // ── Vehicle manager ──
    this.vehicleManager = new VehicleManager(this as unknown as VehicleEngineContext);
    this.weapons.setVehicles(this.vehicleManager.vehicles);

    // ── Fire controllers ──
    this.infantryFire = new InfantryFireController(this as unknown as InfantryFireContext);
    this.vehicleFire = new VehicleFireController(this as unknown as VehicleFireContext);

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
        if (slot >= 0 && slot < VEHICLE_WEAPONS.length && slot !== this.vehicleManager.vehicleWeaponIndex) {
          this.vehicleManager.vehicleWeaponIndex = slot;
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
    this.vehicleManager.vehiclePilotYaw -= event.movementX * this.controls.sensitivity;
    this.vehicleManager.vehiclePilotPitch -= event.movementY * this.controls.sensitivity;
    this.vehicleManager.vehiclePilotPitch = Math.max(this.vehicleManager.PILOT_PITCH_MIN, Math.min(this.vehicleManager.PILOT_PITCH_MAX, this.vehicleManager.vehiclePilotPitch));
    // Wrap to [-PI, PI]
    if (this.vehicleManager.vehiclePilotYaw > Math.PI) this.vehicleManager.vehiclePilotYaw -= Math.PI * 2;
    if (this.vehicleManager.vehiclePilotYaw < -Math.PI) this.vehicleManager.vehiclePilotYaw += Math.PI * 2;
  };
  private onVehicleWheel = (e: WheelEvent): void => {
    if (this.mountedVehicleId === 0) return;
    const ZOOM_MIN = 6;
    const ZOOM_MAX = 30;
    const ZOOM_STEP = 2;
    if (e.deltaY > 0) {
      this.vehicleManager.vehicleCameraDistance = Math.min(ZOOM_MAX, this.vehicleManager.vehicleCameraDistance + ZOOM_STEP);
    } else if (e.deltaY < 0) {
      this.vehicleManager.vehicleCameraDistance = Math.max(ZOOM_MIN, this.vehicleManager.vehicleCameraDistance - ZOOM_STEP);
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
    this.lanterns.onDynamicLightRemoved(id);
    this.scene.remove(entry.light);
    if (entry.target) {
      this.scene.remove(entry.target);
      if (entry.light instanceof THREE.SpotLight) entry.light.target = entry.light;
    }
    entry.light.dispose();
    this.dynamicLights.delete(id);
  }

  private getLanternContext(): LanternContext {
    return {
      scene: this.scene,
      camera: this.camera,
      world: this.world,
      sky: this.sky,
      elapsedTime: this.elapsedTime,
      dynamicLights: this.dynamicLights as Map<string, { light: THREE.PointLight | THREE.SpotLight; kind: string }>,
      addDynamicLight: (opts) => this.addDynamicLight(opts),
      removeDynamicLight: (id) => this.removeDynamicLight(id),
      updateDynamicLight: (id, patch) => this.updateDynamicLight(id, patch),
    };
  }

  private updateDynamicLights(delta: number): void {
    const ctx = this.getLanternContext();
    const sunVisibility = this.sky.getSunVisibility();
    const lanternVisibility = this.lanterns.getLanternVisibilityFromSun(sunVisibility);

    // Lantern refresh (timer + proximity-based light placement)
    this.lanterns.update(delta, ctx);

    // Per-light updates: lantern flicker + TTL expiry
    for (const [id, entry] of this.dynamicLights) {
      if (entry.kind === 'lantern') {
        entry.light.intensity = this.lanterns.getLanternFlickerIntensity(
          entry.baseIntensity, entry.phase, lanternVisibility,
          this.elapsedTime, delta, entry.light.intensity,
        );
      }

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

  // ── FIRE (delegated to controllers) ──

  private tryFire(): void {
    this.infantryFire.tryFire();
  }

  private startVehicleReload(): void {
    this.vehicleFire.startVehicleReload();
  }

  private tickVehicleReload(): void {
    this.vehicleFire.tickVehicleReload();
  }

  private tryVehicleFire(): void {
    this.vehicleFire.tryVehicleFire();
  }

  // ── EXPLOSION EFFECTS (delegated, kept accessible for VehicleManager context) ──

  /** Apply local camera feedback from explosions based on proximity and blast strength */
  applyExplosionCameraEffects(
    cx: number, cy: number, cz: number,
    radius: number, damage: number,
  ): void {
    this.infantryFire.applyExplosionCameraEffects(cx, cy, cz, radius, damage);
  }

  /** Apply explosion knockback to the local player based on distance from blast center */
  private applyExplosionKnockback(
    cx: number, cy: number, cz: number,
    radius: number, damage: number,
  ): void {
    this.infantryFire.applyExplosionKnockback(cx, cy, cz, radius, damage);
  }

  // ── SERVER SYNC ──

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

  private setupServerListeners(): void {
    if (!this.conn) return;
    this.setupChunkListeners();
    this.setupStructuralListeners();
    this.setupPlayerListeners();
    this.setupCombatEventListeners();
    this.setupVehicleListeners();
    this.setupEnvironmentListeners();
    this.setupAmmoAndLoadoutListeners();
    this.setupGrenadeListeners();
  }

  private setupChunkListeners(): void {
    if (!this.conn) return;

    // New chunks arriving (lazy generation or subscription change)
    this.conn.db.world_chunk.onInsert((_ctx: unknown, chunk: any) => {
      const cx = chunk.cx as number, cy = chunk.cy as number, cz = chunk.cz as number;
      const data = chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data);
      const decoded = VoxelWorld.rleDecodeChunk(data);
      this.world.loadChunk(cx, cy, cz, decoded);
      this.lanterns.syncLanternLightsForChunk(cx, cy, cz, this.getLanternContext(), decoded);
      const id = packChunkId(cx, cy, cz);
      this.chunkStreamer.pendingChunkRequests.delete(id);
      this.chunkStreamer.queuedChunkRequests.delete(id);
      this.chunkStreamer.bootstrapQueued.delete(id);
    });

    // Chunk deletion (map reset)
    this.conn.db.world_chunk.onDelete((_ctx: unknown, chunk: any) => {
      const cx = chunk.cx as number, cy = chunk.cy as number, cz = chunk.cz as number;
      const id = packChunkId(cx, cy, cz);
      this.chunkStreamer.pendingChunkRequests.delete(id);
      this.chunkStreamer.queuedChunkRequests.delete(id);
      this.chunkStreamer.bootstrapQueued.delete(id);
      this.lanterns.clearLanternLightsForChunk(id, this.getLanternContext());
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
      this.lanterns.syncLanternLightsForChunk(cx, cy, cz, this.getLanternContext(), newDecoded);
      this.chunkStreamer.pendingChunkRequests.delete(packChunkId(cx, cy, cz));
    });
  }

  private setupStructuralListeners(): void {
    if (!this.conn) return;

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
  }

  private setupPlayerListeners(): void {
    if (!this.conn) return;

    // Player tracking
    this.conn.db.player.onUpdate((_ctx: unknown, _old: unknown, player: any) => {
      const id = player.identity.toHexString();

      if (this.localIdentity && id === this.localIdentity) {
        const wasMounted = this.mountedVehicleId !== 0;
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
          this.vehicleManager.resetLocalPilotSmoothing();
          if (this.mountedVehicleId !== 0) {
            const pose = this.vehicleManager.getMountedVehiclePose();
            if (pose) {
              this.vehicleManager.vehiclePilotYaw = pose.yaw;
              this.vehicleManager.vehiclePilotPitch = Math.max(this.vehicleManager.PILOT_PITCH_MIN, Math.min(this.vehicleManager.PILOT_PITCH_MAX, pose.pitch));
            }
            // Reset vehicle weapon state on mount
            this.vehicleManager.vehicleWeaponIndex = 0;
            this.vehicleManager.lastVehicleFireAt = 0;
            this.vehicleManager.vehicleReloadingUntil[0] = 0;
            this.vehicleManager.vehicleReloadingUntil[1] = 0;
            this.vehicleManager.vehicleCameraDistance = this.vehicleManager.CAMERA_DISTANCE;
            const vRow = this.vehicleManager.getVehicleRow(this.mountedVehicleId);
            if (vRow) {
              this.vehicleManager.vehicleAmmo[0] = Number(vRow.weaponAmmoPrimary ?? VEHICLE_WEAPONS[0].maxAmmo);
              this.vehicleManager.vehicleAmmo[1] = Number(vRow.weaponAmmoSecondary ?? VEHICLE_WEAPONS[1].maxAmmo);
            } else {
              this.vehicleManager.vehicleAmmo[0] = VEHICLE_WEAPONS[0].maxAmmo;
              this.vehicleManager.vehicleAmmo[1] = VEHICLE_WEAPONS[1].maxAmmo;
            }
          } else {
            // Dismounting — restore helicopter opacity to full
            // (VehicleManager handles opacity internally)
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

      if (this.remotePlayers.shouldRenderRemotePlayer(player)) {
        const pvel = player.vel || { x: 0, y: 0, z: 0 };
        this.remotePlayers.updateOtherPlayer(
          id,
          player.pos,
          pvel,
          player.rot,
          player.username,
          Number(player.characterPreset ?? 0),
          Number(player.currentWeapon ?? 0),
        );
      } else {
        this.remotePlayers.removeOtherPlayer(id);
      }
    });

    this.conn.db.player.onInsert((_ctx: unknown, player: any) => {
      const id = player.identity.toHexString();
      if (id === this.localIdentity) return;
      if (this.remotePlayers.shouldRenderRemotePlayer(player)) {
        const pvel = player.vel || { x: 0, y: 0, z: 0 };
        this.remotePlayers.updateOtherPlayer(
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
      this.remotePlayers.removeOtherPlayer(player.identity.toHexString());
    });

    // Render players already online when Engine starts
    for (const player of this.conn.db.player.iter()) {
      const p = player as any;
      const id = p.identity.toHexString();
      if (id === this.localIdentity) continue;
      if (p.username && this.remotePlayers.shouldRenderRemotePlayer(p)) {
        const pvel = p.vel || { x: 0, y: 0, z: 0 };
        this.remotePlayers.updateOtherPlayer(
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
  }

  private setupCombatEventListeners(): void {
    if (!this.conn) return;

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
  }

  private setupVehicleListeners(): void {
    if (!this.conn) return;
    const db = this.conn.db as any;

    if (db.entity) {
      db.entity.onInsert((_ctx: unknown, entity: any) => {
        if (Number(entity.kind) !== ENTITY_KIND_VEHICLE) return;
        this.vehicleManager.updateVehicleEntity(entity);
      });
      db.entity.onUpdate((_ctx: unknown, _old: unknown, entity: any) => {
        if (Number(entity.kind) !== ENTITY_KIND_VEHICLE) return;
        this.vehicleManager.updateVehicleEntity(entity);
      });
      db.entity.onDelete((_ctx: unknown, entity: any) => {
        const id = Number(entity.id);
        if (Number(entity.kind) !== ENTITY_KIND_VEHICLE || !Number.isFinite(id)) return;
        if (performance.now() < this.vehicleManager.suppressDeleteFxUntil) {
          this.vehicleManager.removeVehicleMesh(id);
          return;
        }
        this.vehicleManager.scheduleDestroyFallback(id);
      });
      this.vehicleManager.rebuildVehiclesFromServer();
    }

    if (db.vehicle) {
      const refresh = (_ctx: unknown, row: any) => {
        const id = Number(row.entityId);
        const entity = this.vehicleManager.findEntityRow(id);
        if (entity && Number(entity.kind) === ENTITY_KIND_VEHICLE) {
          this.vehicleManager.updateVehicleEntity(entity);
        }
      };
      db.vehicle.onInsert(refresh);
      db.vehicle.onUpdate(refresh);
      db.vehicle.onDelete((_ctx: unknown, row: any) => {
        const entityId = Number(row.entityId);
        if (!Number.isFinite(entityId) || entityId <= 0) return;
        if (performance.now() < this.vehicleManager.suppressDeleteFxUntil) {
          this.vehicleManager.removeVehicleMesh(entityId);
          return;
        }
        this.vehicleManager.scheduleDestroyFallback(entityId);
      });
    }

    if (db.vehicle_destroy_event) {
      db.vehicle_destroy_event.onInsert((_ctx: unknown, event: any) => {
        const vehicleType = Number(event.vehicleType);
        if (!this.vehicleManager.getVehicleTypeById(vehicleType)) return;
        const entityId = Number(event.entityId);
        if (!Number.isFinite(entityId) || entityId <= 0) return;

        this.vehicleManager.triggerDestroyFx(entityId, {
          x: Number(event.pos.x),
          y: Number(event.pos.y),
          z: Number(event.pos.z),
        }, Number(event.rot?.yaw ?? 0), 1.4);
      });
    }
  }

  private setupEnvironmentListeners(): void {
    if (!this.conn) return;
    const db = this.conn.db as any;

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
        this.lanterns.reset(this.getLanternContext());
        this.chunkStreamer.resetAll();
        this.vehicleManager.suppressDeleteFxUntil = performance.now() + 1500;
        // Clean up all vehicle state for map reset
        for (const id of Array.from(this.vehicleManager.vehicles.keys())) this.vehicleManager.removeVehicleMesh(id);
        for (const piece of this.vehicleManager.vehicleBreakupPieces) {
          this.scene.remove(piece.mesh);
          piece.mesh.geometry.dispose();
          if (Array.isArray(piece.mesh.material)) {
            for (const mat of piece.mesh.material) mat.dispose();
          } else {
            piece.mesh.material.dispose();
          }
        }
        this.vehicleManager.vehicleBreakupPieces.length = 0;
        const sx = WORLD_X * 0.5;
        const sz = WORLD_Z * 0.5;
        this.camera.position.set(sx, Math.max(this.camera.position.y, 6), sz);
        this.controls.resetVelocity();
        this.chunkStreamer.rehydrateSubscribedChunks();
        this.vehicleManager.rebuildVehiclesFromServer();
        // Chunk streaming will re-request nearby chunks on next frame
      });
    }
  }

  private setupAmmoAndLoadoutListeners(): void {
    if (!this.conn) return;
    const db = this.conn.db as any;

    // Server-authoritative ammo sync (normalized: 1 row per player+weapon)
    this.conn.db.player_ammo.onInsert((_ctx: unknown, row: any) => {
      this.syncAmmoRow(row);
    });
    this.conn.db.player_ammo.onUpdate((_ctx: unknown, _old: unknown, row: any) => {
      this.syncAmmoRow(row);
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

  private setupGrenadeListeners(): void {
    if (!this.conn) return;

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

  /** Update local ammo from a single PlayerAmmo row */
  private syncAmmoRow(row: any): void {
    if (!this.conn) return;
    if (!this.localIdentity || row.identity.toHexString() !== this.localIdentity) return;
    const idx = row.weaponIndex;
    if (idx >= 0 && idx < WEAPONS.length) {
      this.weapons.setAmmo(idx, row.ammo);
    }
  }

  disposeObjectMaterials(root: THREE.Object3D): void {
    disposeObjectMaterials(root);
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

    const mountedPose = this.vehicleManager.getMountedVehiclePoseRaw();
    const px = mountedPose ? mountedPose.x : this.camera.position.x;
    const py = mountedPose ? mountedPose.y + 1.8 : this.camera.position.y;
    const pz = mountedPose ? mountedPose.z : this.camera.position.z;
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const sendYaw = this.mountedVehicleId !== 0 ? this.vehicleManager.vehiclePilotYaw : e.y;
    const sendPitch = this.mountedVehicleId !== 0 ? this.vehicleManager.vehiclePilotPitch : e.x;
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
      if (now - this.vehicleManager.lastVehicleSyncAt >= 80) {
        this.vehicleManager.lastVehicleSyncAt = now;
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

    const startupLocked = !this.chunkStreamer.startupWorldReady;
    this.updateInputState(delta, startupLocked);
    this.updateGameSystems(delta);
    this.updateFeedback(delta);

    // Interpolate remote players every frame
    this.remotePlayers.interpolateAll();

    if (this.mountedVehicleId !== 0) {
      this.vehicleManager.syncMountedCameraToVehicle(delta);
    }

    // Chunk streaming (every N frames to load quickly)
    this.chunkStreamer.chunkLoadFrame++;
    if (this.chunkStreamer.chunkLoadFrame % CHUNK_STREAM_INTERVAL_FRAMES === 0) {
      this.chunkStreamer.updateChunkLoading();
    }

    if (this.mountedVehicleId !== 0) {
      this.vehicleManager.syncVehicleInput();
    }

    // Vehicle per-frame update (delegated to VehicleManager)
    this.vehicleManager.updatePerFrame(delta);

    this.chunkStreamer.ensureSpawnGroundReady();

    // Vehicle breakup piece physics (delegated to VehicleManager)
    this.vehicleManager.updateBreakupPieces(delta);

    const startupProgress = this.chunkStreamer.startupWorldReady ? 1 : this.chunkStreamer.getStartupLoadProgress();
    if (!this.chunkStreamer.startupWorldReady) {
      if (startupProgress > this.chunkStreamer.startupProgressPrev + 0.0005) {
        this.chunkStreamer.startupProgressStallTime = 0;
      } else {
        this.chunkStreamer.startupProgressStallTime += delta;
      }
      this.chunkStreamer.startupProgressPrev = startupProgress;

      if (this.chunkStreamer.startupProgressStallTime > 1.2) {
        this.chunkStreamer.startupProgressStallTime = 0;
        this.chunkStreamer.rehydrateSubscribedChunks(96);
      }
    }

    if (!this.chunkStreamer.startupWorldReady && startupProgress >= 1) {
      this.chunkStreamer.startupWorldReady = true;
      this.chunkStreamer.startupProgressPrev = 1;
      this.chunkStreamer.startupProgressStallTime = 0;
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

    this.renderFrame(delta);
    this.pushHudState(startupProgress);
  };

  private updateInputState(delta: number, startupLocked: boolean): void {
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
  }

  private updateGameSystems(delta: number): void {
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
  }

  private updateFeedback(delta: number): void {
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
  }

  private renderFrame(delta: number): void {
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
  }

  private pushHudState(startupProgress: number): void {
    // Push state to HUD (use tracked ammo for current weapon)
    const wp = WEAPONS[this.weapons.currentWeapon];
    const pc = this.conn
      ? Array.from(this.conn.db.player.iter()).filter((p: any) => p.online).length : 1;
    // Compute heading from camera yaw (0-360 degrees, 0=North)
    const camEuler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const headingRad = camEuler.y;
    const headingDeg = (((-headingRad * 180 / Math.PI) % 360) + 360) % 360;
    const mountedPose = this.vehicleManager.getMountedVehiclePose();
    const vehicleAltitude = mountedPose
      ? Math.max(0, mountedPose.y - this.getGroundHeight(mountedPose.x, mountedPose.z, mountedPose.y))
      : 0;

    // Vehicle HUD data
    let vehicleHealth = 0;
    let vehicleMaxHealth = this.vehicleManager.HEALTH_MAX;
    let vehicleSpeed = 0;
    let nearVehicle = false;

    if (this.mountedVehicleId !== 0) {
      const vRow = this.vehicleManager.getVehicleRow(this.mountedVehicleId);
      if (vRow) {
        vehicleHealth = Number(vRow.health ?? 0);
        vehicleMaxHealth = this.vehicleManager.HEALTH_MAX;
        // Read server ammo to reconcile client prediction
        // Skip reconciliation for weapons currently reloading (server already set max, but client waits for timer)
        const now = performance.now();
        const serverAmmoPrimary = Number(vRow.weaponAmmoPrimary ?? 0);
        const serverAmmoSecondary = Number(vRow.weaponAmmoSecondary ?? 0);
        if (Number.isFinite(serverAmmoPrimary) && this.vehicleManager.vehicleReloadingUntil[0] <= now) this.vehicleManager.vehicleAmmo[0] = serverAmmoPrimary;
        if (Number.isFinite(serverAmmoSecondary) && this.vehicleManager.vehicleReloadingUntil[1] <= now) this.vehicleManager.vehicleAmmo[1] = serverAmmoSecondary;
        // Sync weapon type from server
        const serverWeaponType = Number(vRow.weaponType ?? 0);
        if (Number.isFinite(serverWeaponType) && serverWeaponType < VEHICLE_WEAPONS.length) {
          this.vehicleManager.vehicleWeaponIndex = serverWeaponType;
        }
      }
      const entity = this.vehicleManager.findEntityRow(this.mountedVehicleId);
      if (entity) {
        const vel = entity.vel || { x: 0, y: 0, z: 0 };
        vehicleSpeed = Math.sqrt(
          Number(vel.x) ** 2 + Number(vel.y) ** 2 + Number(vel.z) ** 2,
        );
      }
    } else {
      // Check for nearby vehicle (for "ENTER" prompt)
      nearVehicle = this.vehicleManager.isNearVehicle();
    }

    const curVehWep = VEHICLE_WEAPONS[this.vehicleManager.vehicleWeaponIndex];

    this.onStateChange({
      weapon: this.weapons.currentWeapon,
      loadout: this.weapons.loadout,
      ammo: this.weapons.getAmmo(), maxAmmo: wp.maxAmmo,
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
      worldReady: this.chunkStreamer.startupWorldReady,
      worldLoadProgress: startupProgress,
      mountedVehicleName: this.mountedVehicleId !== 0 ? (this.vehicleManager.getMountedVehicleName() ?? 'Vehicle') : null,
      vehicleAltitude: this.mountedVehicleId !== 0 ? vehicleAltitude : 0,
      vehicleHealth,
      vehicleMaxHealth,
      vehicleWeapon: this.vehicleManager.vehicleWeaponIndex,
      vehicleWeaponName: curVehWep?.name ?? '',
      vehicleAmmo: this.vehicleManager.vehicleAmmo[this.vehicleManager.vehicleWeaponIndex] ?? 0,
      vehicleMaxAmmo: curVehWep?.maxAmmo ?? 0,
      vehicleSpeed,
      vehicleReloading: this.mountedVehicleId !== 0 && this.vehicleManager.vehicleReloadingUntil[this.vehicleManager.vehicleWeaponIndex] > performance.now(),
      nearVehicle,
    });
  }

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
    this.remotePlayers.destroyAll();
    // Clean up vehicle state
    for (const id of Array.from(this.vehicleManager.vehicles.keys())) this.vehicleManager.removeVehicleMesh(id);
    for (const piece of this.vehicleManager.vehicleBreakupPieces) {
      this.scene.remove(piece.mesh);
      piece.mesh.geometry.dispose();
      if (Array.isArray(piece.mesh.material)) {
        for (const mat of piece.mesh.material) mat.dispose();
      } else {
        piece.mesh.material.dispose();
      }
    }
    this.vehicleManager.vehicleBreakupPieces.length = 0;
    this.lanterns.dispose(this.getLanternContext());
    for (const id of Array.from(this.dynamicLights.keys())) this.removeDynamicLight(id);
  }
}
