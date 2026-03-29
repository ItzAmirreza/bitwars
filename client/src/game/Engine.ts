import * as THREE from 'three';
import { VoxelWorld, WORLD_X, WORLD_Y, WORLD_Z, CHUNK, packChunkId, BLOCK_COLORS, BlockType, type ChunkApplyBudget } from './VoxelWorld';
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
import { ChunkStreamer, ACTIVE_CHUNK_RADIUS, CHUNK_STREAM_INTERVAL_FRAMES, CHUNK_REBUILD_BUDGET_MOVING, CHUNK_REBUILD_BUDGET_IDLE, CHUNK_REBUILD_BUDGET_BOOTSTRAP } from './ChunkStreamer';
import { generateDeterministicPerfChunk, perfSceneSpawnPoint } from './PerfWorldScene';
import { RemotePlayerManager, disposeObjectMaterials } from './RemotePlayerManager';
import VehicleManager, { VEHICLE_WEAPONS } from './vehicles/VehicleManager';
import type { VehicleEngineContext } from './vehicles/VehicleManager';
import { InfantryFireController } from './InfantryFireController';
import type { InfantryFireContext } from './InfantryFireController';
import { VehicleFireController } from './VehicleFireController';
import type { VehicleFireContext } from './VehicleFireController';
import { ENTITY_KINDS } from '../shared-config';
import { GRENADE } from '../shared-config';
import type { DbConnection } from '../module_bindings';
import type { GameSettings } from '../store';
import { NetDiagnostics } from './NetDiagnostics';
import { ChunkBoundaryViewer } from './ChunkBoundaryViewer';
import type { HarnessMode } from './PerfHarness';

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
  serverTps: number;
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
  vehicleThrottle: number;   // 0..1 for jet throttle
  vehicleReloading: boolean;
  vehicleWeaponSlots: { name: string; color: string }[];
  nearVehicle: boolean;
  nearVehicleName: string | null;
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

  // Local-predicted grenade ghosts for instant shooter feedback.
  private predictedGrenadeGhosts: Array<{
    mesh: THREE.Mesh;
    light: THREE.PointLight | null;
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    age: number;
    ttl: number;
    trailTimer: number;
  }> = [];
  private readonly MAX_PREDICTED_GRENADE_GHOSTS = 8;
  private readonly PREDICTED_GRENADE_TTL = 0.9;

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
  private clock: THREE.Timer;
  private container: HTMLElement;
  private conn: DbConnection | null;
  private connStashedForPerf: DbConnection | null = null; // real conn saved during benchmark
  private onStateChange: (state: EngineState) => void;
  private username: string | null;

  private frameCount = 0;
  private fpsTime = 0;
  private currentFps = 0;
  private tpsWindowStartMs = 0;
  private tpsWindowStartTick = 0n;
  private currentServerTps = 0;
  private cachedMaxSimTick = 0n;
  private nextSimTickSampleAt = 0;
  private cachedPlayerCount = 1;
  private nextPlayerCountSampleAt = 0;
  private animationId = 0;
  private mouseDown = false;
  private autoFireHeld = false;
  private sandboxMotionEnabled = false;
  private sandboxMotionMode: HarnessMode = 'idle';
  private sandboxMotionTime = 0;
  private sandboxPhaseTime = 0;
  private sandboxTeleportsDone = 0;
  private sandboxExplosionPulse = 0;
  private readonly sandboxRemoteIds = [
    'perf-bot-1', 'perf-bot-2', 'perf-bot-3', 'perf-bot-4',
    'perf-bot-5', 'perf-bot-6', 'perf-bot-7', 'perf-bot-8',
  ];
  private perfBenchmarkSceneEnabled = false;
  private sandboxRngState = 0x12345678;
  private perfEnvironmentPhase = -1;
  private sandboxWeaponCycleTimer = 0;
  private sandboxBotMuzzleTimer = 0;
  private sandboxDamagePulseTimer = 0;
  private sandboxBlockBreakCount = 0;
  __perfLastState: { frameMs: number; cpuFrameMs: number; playerCount: number } = { frameMs: 0, cpuFrameMs: 0, playerCount: 1 };
  private lastPositionUpdate = 0;
  private remotePlayers!: RemotePlayerManager;
  private localIdentity: string | null = null;
  private mountedVehicleId = 0;
  private health = 100;
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

  // Adaptive graphics scaling
  private graphicsQuality: GameSettings['graphicsQuality'] = 'high';
  private userShadowsEnabled = true;
  private userPostFxEnabled = true;
  private adaptiveTier = 0;
  private adaptiveFrameMsEma = 16.7;
  private adaptiveSampleTimer = 0;
  private adaptivePressureTime = 0;
  private adaptiveReliefTime = 0;
  private appliedPixelRatio = -1;
  private appliedShadowMapSize = 0;
  private shadowsActive = true;
  private currentShadowCastRadiusChunks = 7;
  private currentRebuildBudgetMoving = CHUNK_REBUILD_BUDGET_MOVING;
  private currentRebuildBudgetIdle = CHUNK_REBUILD_BUDGET_IDLE;
  private currentMeshApplyBudgetMsMoving = 1.25;
  private currentMeshApplyBudgetMsIdle = 1.9;
  private readonly bootstrapChunkApplyBudget: ChunkApplyBudget = {
    maxChunks: CHUNK_REBUILD_BUDGET_BOOTSTRAP,
    maxBuildChunks: CHUNK_REBUILD_BUDGET_BOOTSTRAP,
    maxApplyMs: 4.0,
  };
  private currentChunkStreamIntervalFrames = CHUNK_STREAM_INTERVAL_FRAMES;
  private shadowRefreshTimer = 0;

  // Dev-only networking diagnostics (F3 overlay, F4 download)
  private netDiag = new NetDiagnostics();
  private chunkBoundaryViewer!: ChunkBoundaryViewer;

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
    this.clock = new THREE.Timer();
    this.clock.connect(document);

    const w = container.clientWidth;
    const h = container.clientHeight;

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x5a5856);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    container.appendChild(this.renderer.domElement);

    // ── Camera ──
    this.camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 800);

    // ── Scene ──
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x5a5856, 200, 500);
    this.chunkBoundaryViewer = new ChunkBoundaryViewer(this.scene);

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
      onChunkLoaded: (cx, cy, cz, decoded) => {
        this.lanterns.syncLanternLightsForChunk(cx, cy, cz, this.getLanternContext(), decoded);
        this.audio?.sendChunkToWorker(packChunkId(cx, cy, cz), decoded);
      },
      onChunkUnloading: (chunkId) => this.lanterns.clearLanternLightsForChunk(chunkId, this.getLanternContext()),
      perfSceneEnabled: () => this.perfBenchmarkSceneEnabled,
      getPerfSceneChunkData: (cx, cy, cz) => generateDeterministicPerfChunk(cx, cy, cz),
    });
    this.chunkStreamer.loadWorldFromServer();
    this.world.setRebuildAnchor(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
    );
    this.world.rebuildDirtyChunks(this.scene, this.bootstrapChunkApplyBudget);

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
    this.audio.initRayTracer();

    // ── VFX ──
    this.vfx = new VFX(this.scene, this.camera);

    // ── Physics ──
    this.physics = new PhysicsSystem(this.scene, this.world, this.vfx, this.audio);

    // ── Projectiles ──
    // NOTE: infantryFire is initialized after this, but the callback is only called
    // at runtime (not during construction), so the reference is valid by then.
    this.projectileManager = new ProjectileManager(
      this.scene, this.world, this.weapons, this.vfx, this.audio, this.camera,
      this.remotePlayers.otherPlayers,
      (impact) => this.infantryFire.handleProjectileImpact(impact),
    );

    // ── Weapon Model ──
    this.weaponModel = new WeaponModel(w / h);

    // ── PostFX ──
    this.postfx = new PostFX();

    // Apply initial quality profile before first frame.
    this.applyGraphicsTier(true);

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
    container.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('mousemove', this.onVehicleMouseMove);
    document.addEventListener('wheel', this.onVehicleWheel, { passive: true });
    window.addEventListener('resize', this.onResize);

    this.animate();
  }

  toggleChunkBoundaries(): void {
    this.chunkBoundaryViewer.toggle();
  }

  // ── SETTINGS ──

  updateSettings(settings: GameSettings): void {
    this.controls.sensitivity = settings.sensitivity;
    this.baseFov = settings.fov;
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setMasterVolume(settings.masterVolume);
    this.controls.setSprintToggle(settings.sprintToggle);
    this.graphicsQuality = settings.graphicsQuality;
    this.userShadowsEnabled = settings.shadowsEnabled;
    this.userPostFxEnabled = settings.postFXEnabled;

    // Reset adaptive scaler when user changes settings, then let it ramp again.
    this.adaptiveTier = 0;
    this.adaptiveFrameMsEma = 16.7;
    this.adaptiveSampleTimer = 0;
    this.adaptivePressureTime = 0;
    this.adaptiveReliefTime = 0;
    this.applyGraphicsTier(true);
  }

  private roundShadowMapSize(size: number): number {
    if (size >= 1536) return 2048;
    if (size >= 768) return 1024;
    if (size >= 384) return 512;
    return 256;
  }

  private applyGraphicsTier(force = false): void {
    const baseDpr = this.graphicsQuality === 'low' ? 1 : this.graphicsQuality === 'medium' ? 1.5 : 2;
    const baseShadowMap = this.graphicsQuality === 'low' ? 512 : this.graphicsQuality === 'medium' ? 1024 : 2048;
    const baseCastRadius = this.graphicsQuality === 'low' ? 4 : this.graphicsQuality === 'medium' ? 6 : 8;

    const dprScale = [1.0, 0.9, 0.78, 0.66][this.adaptiveTier] ?? 1.0;
    const shadowScale = [1.0, 0.75, 0.5, 0.25][this.adaptiveTier] ?? 1.0;
    const budgetScale = [1.0, 0.85, 0.7, 0.55][this.adaptiveTier] ?? 1.0;

    const wantedDpr = Math.max(0.6, Math.min(window.devicePixelRatio, baseDpr * dprScale));
    const shadowMapSize = this.roundShadowMapSize(baseShadowMap * shadowScale);
    const shadowsActive = this.userShadowsEnabled && this.adaptiveTier < 3;
    const postFxActive = this.userPostFxEnabled && this.adaptiveTier < 2;

    this.currentShadowCastRadiusChunks = shadowsActive
      ? Math.max(2, baseCastRadius - this.adaptiveTier)
      : 0;
    this.currentRebuildBudgetMoving = Math.max(4, Math.round(CHUNK_REBUILD_BUDGET_MOVING * budgetScale));
    this.currentRebuildBudgetIdle = Math.max(8, Math.round(CHUNK_REBUILD_BUDGET_IDLE * budgetScale));
    const applyBudgetScale = [1.0, 0.9, 0.76, 0.62][this.adaptiveTier] ?? 1.0;
    const baseApplyMoving = this.graphicsQuality === 'low' ? 1.05 : this.graphicsQuality === 'medium' ? 1.2 : 1.35;
    const baseApplyIdle = this.graphicsQuality === 'low' ? 1.55 : this.graphicsQuality === 'medium' ? 1.85 : 2.15;
    this.currentMeshApplyBudgetMsMoving = Math.max(0.5, baseApplyMoving * applyBudgetScale);
    this.currentMeshApplyBudgetMsIdle = Math.max(0.8, baseApplyIdle * applyBudgetScale);

    const nextStreamInterval = this.adaptiveTier >= 3 ? 4 : this.adaptiveTier >= 2 ? 3 : CHUNK_STREAM_INTERVAL_FRAMES;
    if (force || this.currentChunkStreamIntervalFrames !== nextStreamInterval) {
      this.currentChunkStreamIntervalFrames = nextStreamInterval;
      this.chunkStreamer.chunkLoadFrame = 0;
    }

    if (force || Math.abs(this.appliedPixelRatio - wantedDpr) > 0.01) {
      this.renderer.setPixelRatio(wantedDpr);
      this.appliedPixelRatio = wantedDpr;
      this.onResize();
    }

    if (force || this.appliedShadowMapSize !== shadowMapSize) {
      this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.appliedShadowMapSize = shadowMapSize;
    }

    if (force || this.shadowsActive !== shadowsActive) {
      this.shadowsActive = shadowsActive;
      this.renderer.shadowMap.enabled = shadowsActive;
      this.sun.castShadow = shadowsActive;
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowRefreshTimer = 0;
    }

    this.moon.castShadow = false;
    this.postfx.enabled = postFxActive;
  }

  private refreshAdaptiveScaling(delta: number): void {
    const frameMs = delta * 1000;
    const emaLerp = 1 - Math.pow(0.001, delta);
    this.adaptiveFrameMsEma += (frameMs - this.adaptiveFrameMsEma) * emaLerp;

    this.adaptiveSampleTimer += delta;
    if (this.adaptiveSampleTimer < 0.5) return;

    const elapsed = this.adaptiveSampleTimer;
    this.adaptiveSampleTimer = 0;

    const targetMs = this.graphicsQuality === 'low' ? 22 : this.graphicsQuality === 'medium' ? 18.5 : 16.7;
    const hardPressure = this.adaptiveFrameMsEma > targetMs + 8;
    const pressure = this.adaptiveFrameMsEma > targetMs + 3;
    const relief = this.adaptiveFrameMsEma < targetMs - 2.2;

    if (hardPressure) {
      this.adaptivePressureTime += elapsed * 1.8;
      this.adaptiveReliefTime = 0;
    } else if (pressure) {
      this.adaptivePressureTime += elapsed;
      this.adaptiveReliefTime = 0;
    } else if (relief) {
      this.adaptiveReliefTime += elapsed;
      this.adaptivePressureTime = 0;
    } else {
      this.adaptivePressureTime = Math.max(0, this.adaptivePressureTime - elapsed * 0.5);
      this.adaptiveReliefTime = Math.max(0, this.adaptiveReliefTime - elapsed * 0.5);
    }

    if (this.adaptivePressureTime >= 1.2 && this.adaptiveTier < 3) {
      this.adaptiveTier++;
      this.adaptivePressureTime = 0;
      this.adaptiveReliefTime = 0;
      this.applyGraphicsTier();
      return;
    }

    if (this.adaptiveReliefTime >= 5 && this.adaptiveTier > 0) {
      this.adaptiveTier--;
      this.adaptivePressureTime = 0;
      this.adaptiveReliefTime = 0;
      this.applyGraphicsTier();
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
    if (this.sandboxMotionEnabled) return;
    if (e.button === 0 && this.controls.locked) {
      this.mouseDown = true;
      if (this.mountedVehicleId !== 0) this.tryVehicleFire();
      else this.tryFire();
    }
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  setPerfSandboxMotion(enabled: boolean, mode: HarnessMode): void {
    const modeChanged = this.sandboxMotionMode !== mode;
    this.sandboxMotionEnabled = enabled;
    this.sandboxMotionMode = mode;
    if (!enabled || modeChanged) {
      this.sandboxMotionTime = 0;
      this.sandboxPhaseTime = 0;
      this.sandboxTeleportsDone = 0;
      this.sandboxExplosionPulse = 0;
      this.sandboxBotMuzzleTimer = 0;
      this.sandboxDamagePulseTimer = 0;
      this.sandboxRngState = mode === 'combat-chaos' ? 0x4f1bbcdc : mode === 'mixed-teleport' ? 0x6d2b79f5 : 0x12345678;
      this.removeSandboxRemotePlayers();
    }

    this.controls.setPerfSandboxExclusive(enabled);

    if (enabled) {
      this.chatOpen = false;
      this.loadoutMenuOpen = false;
      this.controls.inputEnabled = true;
      this.weapons.setInputEnabled(true);
      if (!this.controls.locked) this.controls.lock();
    }
  }

  setPerfBenchmarkSceneEnabled(enabled: boolean): void {
    this.perfBenchmarkSceneEnabled = enabled;
    if (enabled) {
      // Force dismount BEFORE nulling conn so it actually reaches the server
      if (this.mountedVehicleId !== 0 && this.conn) {
        this.conn.reducers.interactVehicle({});
      }
      // Stash the real server connection and null it out.
      // This suppresses ALL server reducer calls (position, fire, loadout, etc.)
      // so the benchmark is purely client-side with zero server interaction.
      this.connStashedForPerf = this.conn;
      this.conn = null;
      this.loadPerfBenchmarkScene();
    }
    if (!enabled) {
      // Restore the real connection before restoring the server world
      this.conn = this.connStashedForPerf;
      this.connStashedForPerf = null;
      this.perfEnvironmentPhase = -1;
      this.sandboxWeaponCycleTimer = 0;
      this.sandboxBotMuzzleTimer = 0;
      this.sandboxDamagePulseTimer = 0;
      this.sandboxBlockBreakCount = 0;
      this.postfx.resetDamage();
      this.removeSandboxRemotePlayers();
      this.restoreServerWorldAfterPerf();
    }
  }

  private clearAudioWorkerChunks(): void {
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCy = Math.ceil(WORLD_Y / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);
    for (let cz = 0; cz < maxCz; cz++) {
      for (let cy = 0; cy < maxCy; cy++) {
        for (let cx = 0; cx < maxCx; cx++) {
          this.audio.removeChunkFromWorker(packChunkId(cx, cy, cz));
        }
      }
    }
  }

  private restoreServerWorldAfterPerf(): void {
    this.world.clearAll(this.scene);
    this.chunkStreamer.resetAll();
    this.lanterns.reset(this.getLanternContext());
    this.clearAudioWorkerChunks();
    this.chunkStreamer.loadWorldFromServer();
    this.chunkStreamer.chunkLoadFrame = 0;
  }

  private loadPerfBenchmarkScene(): void {
    // Deterministic benchmark mode; keep chunk streaming behavior realistic by
    // letting ChunkStreamer lazily page in generated benchmark chunks.
    // Note: vehicle dismount is handled in setPerfBenchmarkSceneEnabled before conn is stashed.

    this.world.clearAll(this.scene);
    this.chunkStreamer.resetAll();
    this.lanterns.reset(this.getLanternContext());
    this.clearAudioWorkerChunks();

    const spawn = perfSceneSpawnPoint(0);
    this.camera.position.set(spawn.x, spawn.y, spawn.z);
    this.controls.resetVelocity();
    this.orientSandboxLookToward(spawn.x + 12, spawn.y, spawn.z + 10);

    this.perfEnvironmentPhase = -1;
    this.sky.setEnvironment({ timeOfDay: 9.5, weather: 0, windSpeed: 0.2, cloudDensity: 0.2, fogDensity: 0.65 });
    this.sandboxWeaponCycleTimer = 0;
    this.sandboxBotMuzzleTimer = 0;
    this.sandboxDamagePulseTimer = 0;
    this.sandboxBlockBreakCount = 0;

    this.chunkStreamer.startupWorldReady = false;
    this.chunkStreamer.startupProgressPrev = 0;
    this.chunkStreamer.startupProgressStallTime = 0;
    this.chunkStreamer.chunkLoadFrame = 0;
  }

  private sandboxRand(): number {
    this.sandboxRngState = (Math.imul(this.sandboxRngState, 1664525) + 1013904223) >>> 0;
    return this.sandboxRngState / 4294967296;
  }

  setPerfSandboxAutoFire(enabled: boolean): void {
    this.autoFireHeld = enabled;
  }

  private removeSandboxRemotePlayers(): void {
    for (const id of this.sandboxRemoteIds) this.remotePlayers.removeOtherPlayer(id);
  }

  private ensureSandboxRemotePlayers(time: number): void {
    const base = this.camera.position;
    // Cycle bot weapons every 4s to stress GPU alloc churn from model disposal/creation
    const weaponCycle = Math.floor(time / 4);
    for (let i = 0; i < this.sandboxRemoteIds.length; i++) {
      const id = this.sandboxRemoteIds[i]!;
      const ring = 12 + i * 2.8;
      const angle = time * (0.35 + i * 0.1) + i * (Math.PI * 2 / this.sandboxRemoteIds.length);
      const x = base.x + Math.cos(angle) * ring;
      const z = base.z + Math.sin(angle) * ring;
      const y = this.getGroundHeight(x, z) + 1.7;
      const nextAngle = angle + 0.05;
      const nx = base.x + Math.cos(nextAngle) * ring;
      const nz = base.z + Math.sin(nextAngle) * ring;
      const botWeapon = (weaponCycle + i) % 5;
      this.remotePlayers.updateOtherPlayer(
        id,
        { x, y: y + 1.7, z },
        { x: (nx - x) / 0.05, y: 0, z: (nz - z) / 0.05 },
        { yaw: Math.atan2(nx - x, nz - z), pitch: 0 },
        `BOT-${i + 1}`,
        i % 5,
        botWeapon,
      );
    }
  }

  private emitSandboxChaos(delta: number): void {
    this.ensureSandboxRemotePlayers(this.elapsedTime);

    // ── Explosions with actual block destruction + physics debris ──
    this.sandboxExplosionPulse -= delta;
    if (this.sandboxExplosionPulse <= 0) {
      this.sandboxExplosionPulse = 0.14;
      const cx = this.camera.position.x + (this.sandboxRand() - 0.5) * 30;
      const cz = this.camera.position.z + (this.sandboxRand() - 0.5) * 30;
      const cy = this.getGroundHeight(cx, cz) + 1;
      const radius = 2 + this.sandboxRand() * 4;

      // VFX + audio
      this.vfx.emitExplosion(cx, cy, cz, radius);
      this.audio.playExplosion({ position: { x: cx, y: cy, z: cz } });
      this.vfx.emitImpact(cx, cy, cz);

      // Screen shake (distance-attenuated)
      const dist = this.camera.position.distanceTo(new THREE.Vector3(cx, cy, cz));
      const shakeIntensity = Math.max(0, 1 - dist / 40) * (radius / 4) * 0.4;
      if (shakeIntensity > 0.02) this.vfx.shake(shakeIntensity);

      // Destroy actual blocks within explosion radius and collect debris
      const destroyedBlocks: { x: number; y: number; z: number; blockType: number }[] = [];
      const intRadius = Math.ceil(radius);
      const bx = Math.floor(cx);
      const by = Math.floor(cy);
      const bz = Math.floor(cz);
      for (let dx = -intRadius; dx <= intRadius; dx++) {
        for (let dy = -intRadius; dy <= intRadius; dy++) {
          for (let dz = -intRadius; dz <= intRadius; dz++) {
            if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
            const wx = bx + dx, wy = by + dy, wz = bz + dz;
            const bt = this.world.getBlock(wx, wy, wz);
            if (bt !== 0 && bt !== BlockType.Bedrock) {
              destroyedBlocks.push({ x: wx, y: wy, z: wz, blockType: bt });
              this.world.setBlock(wx, wy, wz, 0);
              this.sandboxBlockBreakCount++;
            }
          }
        }
      }

      // Physics debris from destroyed blocks
      if (destroyedBlocks.length > 0) {
        this.physics.spawnExplosionDebris(destroyedBlocks, cx, cy, cz, radius, radius * 2.5);
        this.physics.applyExplosionForce(cx, cy, cz, radius * 1.5, radius * 2);
        // Block debris VFX particles for first N blocks
        const vfxCount = Math.min(destroyedBlocks.length, 6);
        for (let i = 0; i < vfxCount; i++) {
          const b = destroyedBlocks[i]!;
          const col = BLOCK_COLORS[b.blockType] ?? 0x7a7a78;
          this.vfx.emitBlockDebris(b.x, b.y, b.z, col);
        }
        // Block break audio (throttled — one per explosion)
        this.audio.playBlockBreak({ position: { x: cx, y: cy, z: cz } });
      }
    }

    // ── Remote bot muzzle flashes (every 0.08s from random bots) ──
    this.sandboxBotMuzzleTimer -= delta;
    if (this.sandboxBotMuzzleTimer <= 0) {
      this.sandboxBotMuzzleTimer = 0.08;
      const botIdx = Math.floor(this.sandboxRand() * this.sandboxRemoteIds.length);
      const id = this.sandboxRemoteIds[botIdx]!;
      const botGroup = this.remotePlayers.otherPlayers.get(id);
      if (botGroup) {
        const pos = new THREE.Vector3();
        botGroup.getWorldPosition(pos);
        const dir = new THREE.Vector3(
          this.camera.position.x - pos.x,
          0,
          this.camera.position.z - pos.z,
        ).normalize();
        this.vfx.emitMuzzleFlashAt(pos, dir);
        // Bot weapon audio at spatial position
        const weaponCycle = Math.floor(this.elapsedTime / 4);
        const botWeapon = (weaponCycle + botIdx) % 5;
        const spatial = { position: { x: pos.x, y: pos.y, z: pos.z } };
        if (botWeapon === 0) this.audio.playRifle(spatial);
        else if (botWeapon === 1) this.audio.playShotgun(spatial);
        else if (botWeapon === 3) this.audio.playMachineGun(spatial);
      }
    }

    // ── Diverse projectile spam: cycle RPG (2) and grenade launcher (4) ──
    for (let i = 0; i < 2; i++) {
      const origin = this.camera.position.clone().add(new THREE.Vector3(
        (this.sandboxRand() - 0.5) * 2,
        -0.2 + this.sandboxRand() * 0.6,
        (this.sandboxRand() - 0.5) * 2,
      ));
      const dir = new THREE.Vector3(
        (this.sandboxRand() - 0.5) * 0.5,
        -0.05 + this.sandboxRand() * 0.25,
        -1,
      ).normalize();
      const weaponIdx = (i + this.sandboxTeleportsDone) % 2 === 0 ? 2 : 4;
      this.projectileManager.spawnRemote(weaponIdx, origin, dir, performance.now(), this.sandboxRemoteIds[i % this.sandboxRemoteIds.length]!);
    }

    // ── Damage vignette pulse (every 3s, simulates taking damage) ──
    this.sandboxDamagePulseTimer -= delta;
    if (this.sandboxDamagePulseTimer <= 0) {
      this.sandboxDamagePulseTimer = 3.0;
      this.postfx.triggerDamage(0.25);
      this.audio.playDamage(this.localAudioSource(-0.2));
    }
  }

  private orientSandboxLookToward(targetX: number, targetY: number, targetZ: number): void {
    const dx = targetX - this.camera.position.x;
    const dy = targetY - this.camera.position.y;
    const dz = targetZ - this.camera.position.z;
    const yaw = Math.atan2(-dx, -dz);
    const horiz = Math.max(0.0001, Math.sqrt(dx * dx + dz * dz));
    const pitch = Math.max(-1.1, Math.min(1.1, Math.atan2(dy, horiz)));
    const e = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(e);
    this.vehicleManager.vehiclePilotYaw = yaw;
    this.vehicleManager.vehiclePilotPitch = pitch;
  }

  private teleportSandboxCamera(x: number, z: number): void {
    const y = this.getGroundHeight(x, z) + 2.6;
    this.camera.position.set(x, y, z);
    this.controls.resetVelocity();
    const lookX = Math.min(WORLD_X - 2, Math.max(2, x + 10));
    const lookZ = Math.min(WORLD_Z - 2, Math.max(2, z + 8));
    const lookY = this.getGroundHeight(lookX, lookZ) + 1.7;
    this.orientSandboxLookToward(lookX, lookY, lookZ);
  }

  private sandboxLanePoint(step: number): { x: number; z: number } {
    const margin = 64;
    const segments = [
      { x: margin, z: margin },
      { x: WORLD_X - margin, z: margin },
      { x: WORLD_X - margin, z: WORLD_Z - margin },
      { x: margin, z: WORLD_Z - margin },
    ];
    return segments[step % segments.length]!;
  }

  /** Runs every frame during perf benchmark regardless of mount state.
   *  Drives environment phase sweep, ammo refill, weapon cycling, and vehicle phases. */
  private updatePerfBenchmarkState(delta: number): void {
    if (!this.perfBenchmarkSceneEnabled) return;

    // ── Keep deterministic fire pressure active for full run duration ──
    if (this.weapons.getAmmo() <= 2) {
      for (let i = 0; i < WEAPONS.length; i++) {
        this.weapons.setAmmo(i, WEAPONS[i].maxAmmo);
      }
    }

    // ── Weapon cycling: rotate loadout every 5s to hit all 5 weapons ──
    // setCurrentWeapon only works for weapons in the 3-slot loadout, so we
    // must also rotate the loadout itself to reach weapons 3 and 4.
    this.sandboxWeaponCycleTimer -= delta;
    if (this.sandboxWeaponCycleTimer <= 0) {
      this.sandboxWeaponCycleTimer = 5.0;
      const loadouts: [number, number, number][] = [
        [0, 1, 2],  // Rifle, Shotgun, RPG
        [3, 4, 0],  // Machine Gun, Grenade Launcher, Rifle
        [1, 2, 3],  // Shotgun, RPG, Machine Gun
        [4, 0, 1],  // Grenade Launcher, Rifle, Shotgun
        [2, 3, 4],  // RPG, Machine Gun, Grenade Launcher
      ];
      const cycle = Math.floor(this.sandboxMotionTime / 5) % loadouts.length;
      const targetLoadout = loadouts[cycle]!;
      this.weapons.setLoadout(targetLoadout);
      // Switch to slot 0 of the new loadout (the first weapon in each set)
      this.weapons.switchToSlot(0);
    }

    // ── Environment phase sweep: 5 phases x 13s = 65s total ──
    const envPhase = Math.floor(this.sandboxMotionTime / 13) % 5;
    if (envPhase !== this.perfEnvironmentPhase) {
      this.perfEnvironmentPhase = envPhase;
      if (envPhase === 0) this.sky.setEnvironment({ timeOfDay: 9.5, weather: 0, windSpeed: 0.2, cloudDensity: 0.2, fogDensity: 0.65 });
      else if (envPhase === 1) this.sky.setEnvironment({ timeOfDay: 13.5, weather: 1, windSpeed: 0.25, cloudDensity: 0.45, fogDensity: 0.72 });
      else if (envPhase === 2) this.sky.setEnvironment({ timeOfDay: 18.7, weather: 2, windSpeed: 0.35, cloudDensity: 0.74, fogDensity: 0.88 });
      else if (envPhase === 3) this.sky.setEnvironment({ timeOfDay: 22.4, weather: 3, windSpeed: 0.5, cloudDensity: 0.95, fogDensity: 1.08 });
      else this.sky.setEnvironment({ timeOfDay: 4.5, weather: 4, windSpeed: 0.6, cloudDensity: 1.0, fogDensity: 1.2 });
    }

    // NOTE: Vehicle mount/dismount cycling has been removed.
    // Vehicle positions are server-spawned at non-deterministic locations,
    // which caused random teleports mid-test, breaking reproducibility.
    // Vehicles in the scene are still rendered by VehicleManager if they exist.
  }

  private applySandboxMotion(delta: number): void {
    if (!this.sandboxMotionEnabled) return;

    // Always advance motion time and run benchmark state (env phase, ammo, vehicles)
    // even when mounted, dead, or input-locked. This prevents environment phase stall.
    this.sandboxMotionTime += delta;
    this.updatePerfBenchmarkState(delta);

    // Protect against server-side death derailing the benchmark.
    // Force health to 100 so the player cannot die during the test.
    if (this.perfBenchmarkSceneEnabled && this.health <= 0) {
      this.health = 100;
    }

    if (this.mountedVehicleId !== 0 || this.health <= 0 || !this.controls.inputEnabled) {
      return;
    }
    if (!this.perfBenchmarkSceneEnabled) return;

    this.sandboxPhaseTime += delta;
    let fwd = false;
    let sprint = false;

    if (this.sandboxMotionMode === 'chunk-hop') {
      if (this.sandboxPhaseTime > 3.5 || this.sandboxTeleportsDone === 0) {
        this.sandboxPhaseTime = 0;
        this.sandboxTeleportsDone++;
        const pt = this.sandboxLanePoint(this.sandboxTeleportsDone);
        this.teleportSandboxCamera(pt.x, pt.z);
      }
      // Walk forward between teleports to stress chunk streaming under movement
      fwd = true;
      sprint = true;
    } else if (this.sandboxMotionMode === 'combat-chaos') {
      if (this.sandboxPhaseTime > 2.4 || this.sandboxTeleportsDone === 0) {
        this.sandboxPhaseTime = 0;
        this.sandboxTeleportsDone++;
        const centerX = WORLD_X * 0.5;
        const centerZ = WORLD_Z * 0.5;
        const ring = 48;
        const ang = this.sandboxTeleportsDone * 1.3;
        this.teleportSandboxCamera(centerX + Math.cos(ang) * ring, centerZ + Math.sin(ang) * ring);
      }
      // Walk forward between teleports to generate footsteps, head bob, and sprint FOV
      fwd = true;
      sprint = true;
      this.emitSandboxChaos(delta);
    } else if (this.sandboxMotionMode === 'mixed-teleport') {
      if (this.sandboxPhaseTime > 2.8 || this.sandboxTeleportsDone === 0) {
        this.sandboxPhaseTime = 0;
        this.sandboxTeleportsDone++;
        const pt = this.sandboxLanePoint(this.sandboxTeleportsDone + 1);
        this.teleportSandboxCamera(pt.x + 20, pt.z + 12);
      }
      fwd = true;
      sprint = true;
      this.emitSandboxChaos(delta);
    }

    this.controls.moveForward = fwd;
    this.controls.moveBackward = false;
    this.controls.moveLeft = false;
    this.controls.moveRight = false;
    this.mouseDown = false;
    this.controls.qPressed = false;
    this.controls.ePressed = false;
    this.controls.setSandboxSprint?.(sprint);

    if (this.sandboxMotionMode === 'idle') {
      this.removeSandboxRemotePlayers();
    }
  }
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
  };
  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.sandboxMotionEnabled) return;
    if (this.chatOpen || this.loadoutMenuOpen) return;
    if (e.code === 'KeyF') {
      if (this.mountedVehicleId !== 0) {
        this.vehicleManager.resetLocalPilotSmoothing();
      }
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
        // Vehicle weapon switching: 1/2/3
        const slot = parseInt(e.code.charAt(5), 10) - 1;
        const maxSlots = this.vehicleManager.getMountedVehicleType()?.typeId === 1 ? 3 : 2; // jet=3, heli=2
        if (slot >= 0 && slot < maxSlots && slot !== this.vehicleManager.vehicleWeaponIndex) {
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
    else if (weaponIdx === 100) this.audio.playVehicleMinigun(spatial); // Minigun
    else if (weaponIdx === 101) this.audio.playVehicleRocket(spatial);  // Rockets
    else if (weaponIdx === 102) this.audio.playKineticPenetratorFire(spatial); // Kinetic Penetrator
    else if (weaponIdx === 103) this.audio.playCarpetBombDrop(spatial);   // Carpet Bomb
    else if (weaponIdx === 104) this.audio.playVehicleMinigun(spatial);   // Autocannon
    else if (weaponIdx === 105) this.audio.playVehicleRocket(spatial);    // SAM Missile
    else if (weaponIdx === 106) this.audio.playVehicleRocket(spatial);    // Air Missile
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
      const id = packChunkId(cx, cy, cz);

      // Skip chunks that are far from the player (triggered by other players' requests)
      const [anchorCx, anchorCz] = this.chunkStreamer.getLoadAnchorChunk();
      const dx = cx - anchorCx;
      const dz = cz - anchorCz;
      if (dx * dx + dz * dz > ACTIVE_CHUNK_RADIUS * ACTIVE_CHUNK_RADIUS) {
        // Clear only in-flight state; keep queued state intact so nearby chunks can still be retried later.
        this.chunkStreamer.pendingChunkRequests.delete(id);
        return;
      }

      const data = chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data);
      const decoded = VoxelWorld.rleDecodeChunk(data);
      this.world.loadChunk(cx, cy, cz, decoded);
      this.lanterns.syncLanternLightsForChunk(cx, cy, cz, this.getLanternContext(), decoded);
      this.audio.sendChunkToWorker(id, decoded);
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
      this.audio.removeChunkFromWorker(id);
      this.world.unloadChunk(cx, cy, cz, this.scene);
    });

    // World chunk updates (block destruction synced via chunk data)
    this.conn.db.world_chunk.onUpdate((_ctx: unknown, old: unknown, chunk: any) => {
      const cx = chunk.cx as number, cy = chunk.cy as number, cz = chunk.cz as number;
      const id = packChunkId(cx, cy, cz);

      const [anchorCx, anchorCz] = this.chunkStreamer.getLoadAnchorChunk();
      const dx = cx - anchorCx;
      const dz = cz - anchorCz;
      const chunkIsNear = dx * dx + dz * dz <= ACTIVE_CHUNK_RADIUS * ACTIVE_CHUNK_RADIUS;
      if (!chunkIsNear && !this.world.isChunkLoaded(cx, cy, cz)) {
        this.chunkStreamer.pendingChunkRequests.delete(id);
        return;
      }

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
      this.audio.sendChunkToWorker(id, newDecoded);
      this.chunkStreamer.pendingChunkRequests.delete(id);
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

        // Server reconciliation for local player:
        // When MOUNTED: camera is driven by vehicle mesh in syncMountedCameraToVehicle.
        //   Do NOT move camera here.  player.pos is the seat position which is
        //   always ~15u from the 3rd-person camera — comparing would be meaningless.
        // When INFANTRY: client is authoritative.  Only teleport on respawn-level
        //   jumps (> 100u).
        const sp = player.pos;
        const isMountedNow = Number(player.mountedVehicleId ?? 0) !== 0;
        if (!isMountedNow) {
          const cp = this.camera.position;
          const tdx = sp.x - cp.x, tdy = sp.y - cp.y, tdz = sp.z - cp.z;
          const echoDsq = tdx * tdx + tdy * tdy + tdz * tdz;
          this.netDiag.recordServerEcho(sp, { x: cp.x, y: cp.y, z: cp.z });
          if (echoDsq > 10000) {
            // > 100u: respawn, map reset, admin teleport
            this.netDiag.recordTeleport(sp, { x: cp.x, y: cp.y, z: cp.z });
            this.camera.position.set(sp.x, sp.y, sp.z);
            this.controls.resetVelocity();
          }
        }

        const oldHealth = this.health;
        this.health = player.health;
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
              // Seed dead-reckoning immediately so the first frame doesn't
              // show a stale/origin position while waiting for entity.onUpdate
              this.vehicleManager.localLastServerPos.set(pose.x, pose.y, pose.z);
              this.vehicleManager.localLastServerVel.set(0, 0, 0);
              this.vehicleManager.localLastServerYaw = pose.yaw;
              this.vehicleManager.localLastServerPitch = pose.pitch;
              this.vehicleManager.localLastServerTime = performance.now();
            }
            // Reset vehicle weapon state on mount
            this.vehicleManager.vehicleWeaponIndex = 0;
            this.vehicleManager.lastVehicleFireAt = 0;
            this.vehicleManager.vehicleReloadingUntil[0] = 0;
            this.vehicleManager.vehicleReloadingUntil[1] = 0;
            this.vehicleManager.vehicleReloadingUntil[2] = 0;
            this.vehicleManager.vehicleCameraDistance = this.vehicleManager.CAMERA_DISTANCE;
            const vRow = this.vehicleManager.getVehicleRow(this.mountedVehicleId);
            // Resolve weapon indices based on vehicle type for correct maxAmmo
            const wep0Idx = this.vehicleManager.getResolvedWeaponIndexForSlot(0);
            const wep1Idx = this.vehicleManager.getResolvedWeaponIndexForSlot(1);
            const wep2Idx = this.vehicleManager.getResolvedWeaponIndexForSlot(2);
            const maxAmmo0 = VEHICLE_WEAPONS[wep0Idx]?.maxAmmo ?? VEHICLE_WEAPONS[0].maxAmmo;
            const maxAmmo1 = VEHICLE_WEAPONS[wep1Idx]?.maxAmmo ?? VEHICLE_WEAPONS[1].maxAmmo;
            const maxAmmo2 = VEHICLE_WEAPONS[wep2Idx]?.maxAmmo ?? 0;
            if (vRow) {
              this.vehicleManager.vehicleAmmo[0] = Number(vRow.weaponAmmoPrimary ?? maxAmmo0);
              this.vehicleManager.vehicleAmmo[1] = Number(vRow.weaponAmmoSecondary ?? maxAmmo1);
              this.vehicleManager.vehicleAmmo[2] = Number(vRow.weaponAmmoTertiary ?? maxAmmo2);
            } else {
              this.vehicleManager.vehicleAmmo[0] = maxAmmo0;
              this.vehicleManager.vehicleAmmo[1] = maxAmmo1;
              this.vehicleManager.vehicleAmmo[2] = maxAmmo2;
            }
          } else {
            // Dismounting — snap camera to server player position so infantry
            // controls start from the correct location (not the 3rd-person offset).
            this.camera.position.set(sp.x, sp.y, sp.z);
            this.controls.resetVelocity();
            this.vehicleManager.jetThrottle = 0;
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

      const weaponIdx = shot.weapon as number;
      const origin = new THREE.Vector3(shot.origin.x, shot.origin.y, shot.origin.z);
      const dir = new THREE.Vector3(shot.direction.x, shot.direction.y, shot.direction.z);
      let shotEventId = 0n;
      if (typeof shot.id === 'bigint') {
        shotEventId = shot.id;
      } else if (typeof shot.id === 'number' && Number.isFinite(shot.id)) {
        shotEventId = BigInt(Math.trunc(shot.id));
      }
      const sourceVehicleId = Number(shot.sourceVehicle ?? 0);
      const firedAt = shot.firedAt;
      let firedAtPerf: number | null = null;
      if (firedAt && typeof firedAt.toMillis === 'function') {
        const firedAtMs = Number(firedAt.toMillis());
        if (Number.isFinite(firedAtMs)) {
          const approxAgeMs = Math.max(0, Math.min(3000, Date.now() - firedAtMs));
          firedAtPerf = performance.now() - approxAgeMs;
        }
      }

      // Bind local projectile instances to authoritative shot ids.
      if (shooterId === this.localIdentity) {
        if (weaponIdx >= 100) {
          const vehWeaponIdx = weaponIdx - 100;
          const vw = VEHICLE_WEAPONS[vehWeaponIdx];
          if (vw && vw.projectileSpeed > 0 && shotEventId !== 0n) {
            this.projectileManager.linkLocalShotEventId(
              shotEventId,
              weaponIdx,
              { x: origin.x, y: origin.y, z: origin.z },
              sourceVehicleId,
              firedAtPerf,
            );
          }
        } else {
          const w = WEAPONS[weaponIdx];
          if (w && weaponIdx !== 4 && isFinite(w.projectile.speed) && shotEventId !== 0n) {
            this.projectileManager.linkLocalShotEventId(
              shotEventId,
              weaponIdx,
              { x: origin.x, y: origin.y, z: origin.z },
              0,
              firedAtPerf,
            );
          }
        }
        return;
      }

      // Vehicle weapons use 100+ namespace
      if (weaponIdx >= 100) {
        const vehWeaponIdx = weaponIdx - 100; // 0=minigun, 1=rockets, 2=penetrator, 3=carpet bomb
        const vw = VEHICLE_WEAPONS[vehWeaponIdx];
        if (!vw) return;

        this.playRemoteWeaponAudio(weaponIdx, origin, dir);

        if (vw.projectileSpeed > 0) {
          // Projectile weapon: spawn with vehicle-specific visual config
          this.projectileManager.spawnRemoteVehicle(
            2,
            origin,
            dir,
            firedAtPerf ?? performance.now(),
            shooterId,
            vehWeaponIdx,
            0,
          );
          // Muzzle flash at launch point (color varies by weapon)
          const flashColor = vehWeaponIdx === 6 ? 0x00ccff : vehWeaponIdx === 2 ? 0xff2200 : vehWeaponIdx === 3 ? 0xff6600 : vehWeaponIdx === 4 ? 0xffdd33 : 0xff4400;
          this.vfx.emitMuzzleFlashAt(origin, dir, flashColor);
        } else if (vehWeaponIdx === 2) {
          // Kinetic penetrator is a dedicated jet strike, not a minigun tracer.
          const hasHit = shot.hasHit as boolean;
          const hitPos = shot.hitPos;
          const end = hasHit && hitPos
            ? new THREE.Vector3(hitPos.x + 0.5, hitPos.y + 0.5, hitPos.z + 0.5)
            : origin.clone().add(dir.clone().normalize().multiplyScalar(vw.maxRange));
          this.vfx.emitKineticBeam(origin, end);
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
        this.projectileManager.spawnRemote(
          weaponIdx,
          origin,
          dir,
          firedAtPerf ?? performance.now(),
          shooterId,
        );
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
        // Local reconcile is driven by vehicle-table updates so pose + acked
        // input sequence come from the same server tick snapshot.
        this.vehicleManager.updateVehicleEntity(entity, false);
      });
      db.entity.onUpdate((_ctx: unknown, _old: unknown, entity: any) => {
        if (Number(entity.kind) !== ENTITY_KIND_VEHICLE) return;
        // Local reconcile is driven by vehicle-table updates so pose + acked
        // input sequence come from the same server tick snapshot.
        this.vehicleManager.updateVehicleEntity(entity, false);
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
        if (entity && Number(entity.kind) === ENTITY_KIND_VEHICLE && id === this.mountedVehicleId) {
          // Reconcile local mounted vehicle on vehicle stream so ackedInputSeq
          // and pose are read coherently from the same server tick.
          this.vehicleManager.updateVehicleEntity(entity, true);
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

        // ── World ──
        this.world.clearAll(this.scene);
        this.lanterns.reset(this.getLanternContext());
        this.chunkStreamer.resetAll();

        // ── Vehicles: suppress VFX, remove meshes, clear breakup pieces ──
        this.vehicleManager.suppressDeleteFxUntil = performance.now() + 1500;
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

        // ── Dismount local player if in vehicle ──
        if (this.mountedVehicleId !== 0) {
          this.mountedVehicleId = 0;
          this.vehicleManager.resetLocalPilotSmoothing();
          this.vehicleManager.vehiclePilotYaw = 0;
          this.vehicleManager.vehiclePilotPitch = 0;
          this.vehicleManager.vehicleWeaponIndex = 0;
          this.vehicleManager.lastVehicleFireAt = 0;
          this.vehicleManager.vehicleAmmo[0] = VEHICLE_WEAPONS[0].maxAmmo;
          this.vehicleManager.vehicleAmmo[1] = VEHICLE_WEAPONS[1].maxAmmo;
          this.vehicleManager.vehicleAmmo[2] = 0;
          this.vehicleManager.vehicleReloadingUntil[0] = 0;
          this.vehicleManager.vehicleReloadingUntil[1] = 0;
          this.vehicleManager.vehicleReloadingUntil[2] = 0;
          this.vehicleManager.vehicleCameraDistance = this.vehicleManager.CAMERA_DISTANCE;
          this.vehicleManager.jetThrottle = 0;
          this.vehicleManager.carpetBombSide = 1;
        }

        // ── Camera + Controls ──
        const sx = WORLD_X * 0.5;
        const sz = WORLD_Z * 0.5;
        this.camera.position.set(sx, Math.max(this.camera.position.y, 6), sz);
        this.controls.resetMovementState();
        this.mouseDown = false;

        // ── Projectiles + Grenades ──
        this.projectileManager.clearAll();
        for (const ghost of this.predictedGrenadeGhosts) {
          this.scene.remove(ghost.mesh);
          ghost.mesh.geometry.dispose();
          (ghost.mesh.material as THREE.Material).dispose();
          if (ghost.light) {
            this.scene.remove(ghost.light);
            ghost.light.dispose();
          }
        }
        this.predictedGrenadeGhosts.length = 0;
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

        // ── Physics debris + VFX ──
        this.physics.clearAll();
        this.vfx.clearAll();

        // ── Weapons: clear predictions + fire cooldown ──
        this.weapons.clearPendingDestructions();
        this.weapons.resetFireState();

        // ── PostFX: clear damage vignette ──
        this.postfx.resetDamage();

        // ── Remote players: flush interpolation buffers to prevent sliding ──
        this.remotePlayers.flushAllBuffers();

        // ── HUD state ──
        this.hitMarkerTimer = 0;
        this.hitMarkerType = 'none';
        this.prevKills = 0;
        this.prevDeaths = 0;
        this.health = 100;
        this.kills = 0;
        this.deaths = 0;

        // ── Rebuild from server ──
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
        // Reconcile local grenade ghosts when authoritative row appears.
        this.consumePredictedGrenadeGhostNear(
          new THREE.Vector3(g.pos.x, g.pos.y, g.pos.z),
          new THREE.Vector3(g.vel.x, g.vel.y, g.vel.z),
        );

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

  spawnPredictedGrenade(origin: THREE.Vector3, direction: THREE.Vector3): boolean {
    if (this.predictedGrenadeGhosts.length >= this.MAX_PREDICTED_GRENADE_GHOSTS) {
      const oldest = this.predictedGrenadeGhosts.shift();
      if (oldest) {
        this.scene.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
        (oldest.mesh.material as THREE.Material).dispose();
        if (oldest.light) {
          this.scene.remove(oldest.light);
          oldest.light.dispose();
        }
      }
    }

    const cfg = WEAPONS[4].projectile;
    const dir = direction.clone().normalize();
    if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z)) {
      return false;
    }

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.size, 8, 6),
      new THREE.MeshBasicMaterial({ color: cfg.lightColor }),
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);

    let light: THREE.PointLight | null = null;
    if (cfg.lightIntensity > 0) {
      light = new THREE.PointLight(cfg.lightColor, cfg.lightIntensity, cfg.lightRange);
      light.position.copy(origin);
      this.scene.add(light);
    }

    const speed = WEAPONS[4].projectile.speed;
    this.predictedGrenadeGhosts.push({
      mesh,
      light,
      pos: origin.clone(),
      vel: dir.multiplyScalar(speed),
      age: 0,
      ttl: this.PREDICTED_GRENADE_TTL,
      trailTimer: 0,
    });

    return true;
  }

  private consumePredictedGrenadeGhostNear(serverPos: THREE.Vector3, serverVel: THREE.Vector3): void {
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.predictedGrenadeGhosts.length; i++) {
      const ghost = this.predictedGrenadeGhosts[i];
      const posDistSq = ghost.pos.distanceToSquared(serverPos);
      if (posDistSq > 100) continue;
      const velDir = ghost.vel.clone().normalize();
      const serverDir = serverVel.clone().normalize();
      const dirDot = velDir.dot(serverDir);
      if (Number.isFinite(dirDot) && dirDot < 0.45) continue;

      const score = posDistSq + ghost.age * 6;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const ghost = this.predictedGrenadeGhosts[bestIdx];
      this.scene.remove(ghost.mesh);
      ghost.mesh.geometry.dispose();
      (ghost.mesh.material as THREE.Material).dispose();
      if (ghost.light) {
        this.scene.remove(ghost.light);
        ghost.light.dispose();
      }
      this.predictedGrenadeGhosts.splice(bestIdx, 1);
    }
  }

  private updatePredictedGrenadeGhosts(delta: number): void {
    if (this.predictedGrenadeGhosts.length === 0) return;
    const cfg = WEAPONS[4].projectile;

    for (let i = this.predictedGrenadeGhosts.length - 1; i >= 0; i--) {
      const ghost = this.predictedGrenadeGhosts[i];
      ghost.age += delta;
      if (ghost.age >= ghost.ttl) {
        this.scene.remove(ghost.mesh);
        ghost.mesh.geometry.dispose();
        (ghost.mesh.material as THREE.Material).dispose();
        if (ghost.light) {
          this.scene.remove(ghost.light);
          ghost.light.dispose();
        }
        this.predictedGrenadeGhosts.splice(i, 1);
        continue;
      }

      ghost.vel.y -= GRENADE.gravity * delta;
      ghost.pos.addScaledVector(ghost.vel, delta);

      ghost.mesh.position.copy(ghost.pos);
      if (ghost.light) ghost.light.position.copy(ghost.pos);

      const speed = ghost.vel.length();
      if (speed > 1) {
        ghost.trailTimer += delta;
        if (ghost.trailTimer >= 0.35 / speed) {
          ghost.trailTimer = 0;
          this.vfx.emitProjectileTrail(ghost.pos.x, ghost.pos.y, ghost.pos.z, cfg.trailColor);
        }
      }
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
    const isMounted = this.mountedVehicleId !== 0;
    // Adaptive rate:
    //   Mounted: 100ms (~10Hz) — only aim direction matters; server already
    //     computes player position from vehicle entity in tick_vehicles.
    //   Active infantry: 33ms (~30Hz)
    //   Idle infantry: 100ms (~10Hz)
    const vel = this.controls.getVelocity();
    const isActive = this.controls.horizontalSpeed > 0.5
      || Math.abs(vel.y) > 0.5
      || this.mouseDown;
    const interval = isMounted ? 100 : isActive ? 33 : 100;
    if (now - this.lastPositionUpdate < interval) return;
    this.lastPositionUpdate = now;

    const mountedPose = this.vehicleManager.getMountedVehiclePoseRaw();
    const px = mountedPose ? mountedPose.x : this.camera.position.x;
    const py = mountedPose ? mountedPose.y + 1.8 : this.camera.position.y;
    const pz = mountedPose ? mountedPose.z : this.camera.position.z;
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const sendYaw = this.mountedVehicleId !== 0 ? this.vehicleManager.vehiclePilotYaw : e.y;
    const sendPitch = this.mountedVehicleId !== 0 ? this.vehicleManager.vehiclePilotPitch : e.x;
    const sentPos = {
      x: Math.max(-1, Math.min(WORLD_X + 1, px)),
      y: Math.max(-10, Math.min(100, py)),
      z: Math.max(-1, Math.min(WORLD_Z + 1, pz)),
    };
    this.conn.reducers.updatePosition({
      pos: sentPos,
      vel: { x: vel.x, y: vel.y, z: vel.z },
      rot: { yaw: sendYaw, pitch: sendPitch },
      weapon: this.weapons.currentWeapon,
    });
    this.netDiag.recordPositionSent(sentPos);

    // Infantry entity sync
    const entityId = this.findLocalPlayerEntityId();
    if (entityId !== 0n && now - this.vehicleManager.lastVehicleSyncAt >= 80) {
      this.vehicleManager.lastVehicleSyncAt = now;
      this.conn.reducers.syncEntityTransform({
        entityId,
        pos: { x: px, y: py, z: pz },
        vel: { x: vel.x, y: vel.y, z: vel.z },
        rot: { yaw: sendYaw, pitch: sendPitch },
      });
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

  private toU64BigInt(value: unknown): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return BigInt(Math.floor(value));
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return BigInt(value);
    }
    return 0n;
  }

  // ── ANIMATION LOOP ──

  private animate = (timestamp?: DOMHighResTimeStamp): void => {
    this.animationId = requestAnimationFrame(this.animate);
    const frameStartMs = performance.now();
    this.clock.update(timestamp);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.elapsedTime += delta;

    // FPS
    this.frameCount++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      this.currentFps = Math.round(this.frameCount / this.fpsTime);
      this.frameCount = 0; this.fpsTime = 0;
    }

    // Net diagnostics frame tracking
    this.netDiag.recordFrame(delta);

    if (this.conn) {
      const nowMs = performance.now();
      if (nowMs >= this.nextSimTickSampleAt) {
        this.nextSimTickSampleAt = nowMs + 100;
        let sampledSimTick = 0n;
        // Use max simTick across vehicles so HUD TPS doesn't drop to 0 when one
        // tracked vehicle stream briefly stalls (e.g. mount switches / cache churn).
        for (const row of (this.conn.db as any).vehicle.iter()) {
          const tick = this.toU64BigInt((row as any).simTick);
          if (tick > sampledSimTick) sampledSimTick = tick;
        }
        this.cachedMaxSimTick = sampledSimTick;
      }

      const sampledSimTick = this.cachedMaxSimTick;
      if (sampledSimTick > 0n) {
        if (
          this.tpsWindowStartTick === 0n
          || sampledSimTick < this.tpsWindowStartTick
        ) {
          this.tpsWindowStartTick = sampledSimTick;
          this.tpsWindowStartMs = nowMs;
          this.currentServerTps = 0;
        } else {
          const elapsedSec = (nowMs - this.tpsWindowStartMs) / 1000;
          if (elapsedSec >= 0.5) {
            const deltaTicks = sampledSimTick - this.tpsWindowStartTick;
            this.currentServerTps = elapsedSec > 0 ? Math.round(Number(deltaTicks) / elapsedSec) : 0;
            this.tpsWindowStartTick = sampledSimTick;
            this.tpsWindowStartMs = nowMs;
          }
        }
      } else {
        this.currentServerTps = 0;
        this.tpsWindowStartTick = 0n;
        this.tpsWindowStartMs = 0;
      }
    }

    const _diagVel = this.controls.getVelocity();
    this.netDiag.recordSpeed(Math.sqrt(_diagVel.x * _diagVel.x + _diagVel.y * _diagVel.y + _diagVel.z * _diagVel.z));

    this.refreshAdaptiveScaling(delta);
    if (this.netDiag.visible) {
      this.netDiag.recordMountedId(this.mountedVehicleId);
      if (this.mountedVehicleId !== 0) {
        const staleness = performance.now() - this.vehicleManager.localLastServerTime;
        this.netDiag.recordVehicleStaleness(staleness);
      }
    }

    const startupLocked = !this.chunkStreamer.startupWorldReady;
    this.updateInputState(delta, startupLocked);
    this.applySandboxMotion(delta);
    this.updateGameSystems(delta);
    this.updateFeedback(delta);

    // Interpolate remote players every frame
    this.remotePlayers.interpolateAll();

    // Vehicle per-frame update FIRST so mesh positions are current before camera sync.
    // Old order (camera → mesh update) caused one-frame lag on the camera.
    this.vehicleManager.updatePerFrame(delta);

    if (this.mountedVehicleId !== 0) {
      this.vehicleManager.syncMountedCameraToVehicle();
      this.vehicleManager.syncVehicleInput();
      if ((this.mouseDown || this.autoFireHeld) && this.controls.locked) {
        this.tryVehicleFire();
      }
    }

    // Chunk streaming (every N frames to load quickly)
    this.chunkStreamer.chunkLoadFrame++;
    if (this.chunkStreamer.chunkLoadFrame % this.currentChunkStreamIntervalFrames === 0) {
      this.chunkStreamer.updateChunkLoading();
    }

    this.chunkStreamer.ensureSpawnGroundReady();

    this.chunkBoundaryViewer.update(this.camera, this.world);

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

    // Position sync — always send while alive (gating on pointer-lock caused
    // desync when lock dropped but local movement continued)
    this.sendPositionUpdate();

    // Rebuild dirty chunks with distance-prioritized budget
    this.world.setRebuildAnchor(
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
    );
    const isMoving = this.controls.moveForward || this.controls.moveBackward
      || this.controls.moveLeft || this.controls.moveRight
      || this.controls.isSliding || !this.controls.onGround;
    const maxBuildChunks = isMoving ? this.currentRebuildBudgetMoving : this.currentRebuildBudgetIdle;
    const maxApplyMs = isMoving ? this.currentMeshApplyBudgetMsMoving : this.currentMeshApplyBudgetMsIdle;
    this.world.rebuildDirtyChunks(this.scene, {
      maxChunks: maxBuildChunks,
      maxBuildChunks,
      maxApplyMs,
    });

    this.shadowRefreshTimer -= delta;
    if (this.shadowRefreshTimer <= 0) {
      this.shadowRefreshTimer = 0.25;
      this.world.updateChunkShadowCasting(
        this.camera.position.x,
        this.camera.position.z,
        this.currentShadowCastRadiusChunks,
      );
    }

    // Measure CPU time = everything before the render pass (game logic, scene graph, chunk rebuilds)
    const preRenderMs = performance.now();
    this.__perfLastState.cpuFrameMs = preRenderMs - frameStartMs;

    this.renderFrame(delta);
    this.pushHudState(startupProgress);
    this.netDiag.refreshOverlay();
    this.__perfLastState.frameMs = performance.now() - frameStartMs;
    this.__perfLastState.playerCount = this.cachedPlayerCount;
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
    this.audio.updateAcoustics(delta);

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
    if ((this.mouseDown || this.autoFireHeld) && this.controls.locked) {
      if (this.mountedVehicleId === 0) this.tryFire();
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
    this.updatePredictedGrenadeGhosts(delta);

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
    this.renderer.toneMappingExposure += (this.sky.getExposure() - this.renderer.toneMappingExposure) * Math.min(1, delta * 2.2);
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
    let pc = 1;
    if (this.conn) {
      const now = performance.now();
      if (now >= this.nextPlayerCountSampleAt) {
        this.nextPlayerCountSampleAt = now + 250;
        let count = 0;
        for (const p of this.conn.db.player.iter() as Iterable<any>) {
          if (p.online) count++;
        }
        this.cachedPlayerCount = count;
      }
      pc = this.cachedPlayerCount;
    }
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
    let nearVehicleName: string | null = null;

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
        const serverAmmoTertiary = Number(vRow.weaponAmmoTertiary ?? 0);
        if (Number.isFinite(serverAmmoPrimary) && this.vehicleManager.vehicleReloadingUntil[0] <= now) this.vehicleManager.vehicleAmmo[0] = serverAmmoPrimary;
        if (Number.isFinite(serverAmmoSecondary) && this.vehicleManager.vehicleReloadingUntil[1] <= now) this.vehicleManager.vehicleAmmo[1] = serverAmmoSecondary;
        if (Number.isFinite(serverAmmoTertiary) && this.vehicleManager.vehicleReloadingUntil[2] <= now) this.vehicleManager.vehicleAmmo[2] = serverAmmoTertiary;
        // Sync weapon type from server
        const serverWeaponType = Number(vRow.weaponType ?? 0);
        if (Number.isFinite(serverWeaponType) && serverWeaponType < 3) {
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
      const nearName = this.vehicleManager.getNearVehicleName();
      nearVehicle = nearName !== null;
      nearVehicleName = nearName;
    }

    const resolvedVehWepIdx = this.vehicleManager.getResolvedVehicleWeaponIndex();
    const curVehWep = VEHICLE_WEAPONS[resolvedVehWepIdx];

    this.onStateChange({
      weapon: this.weapons.currentWeapon,
      loadout: this.weapons.loadout,
      ammo: this.weapons.getAmmo(), maxAmmo: wp.maxAmmo,
      weaponName: wp.name, weaponColor: wp.color,
      fps: this.currentFps, serverTps: this.currentServerTps, locked: this.controls.locked,
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
      vehicleThrottle: this.vehicleManager.jetThrottle,
      vehicleReloading: this.mountedVehicleId !== 0 && this.vehicleManager.vehicleReloadingUntil[this.vehicleManager.vehicleWeaponIndex] > performance.now(),
      vehicleWeaponSlots: (() => {
        const slots = [
          { name: VEHICLE_WEAPONS[this.vehicleManager.getResolvedWeaponIndexForSlot(0)]?.name ?? '', color: VEHICLE_WEAPONS[this.vehicleManager.getResolvedWeaponIndexForSlot(0)]?.color ?? '#fff' },
          { name: VEHICLE_WEAPONS[this.vehicleManager.getResolvedWeaponIndexForSlot(1)]?.name ?? '', color: VEHICLE_WEAPONS[this.vehicleManager.getResolvedWeaponIndexForSlot(1)]?.color ?? '#fff' },
        ];
        const isJet = this.vehicleManager.getMountedVehicleType()?.name === 'Fighter Jet';
        if (isJet) {
          const wep2 = VEHICLE_WEAPONS[this.vehicleManager.getResolvedWeaponIndexForSlot(2)];
          if (wep2) slots.push({ name: wep2.name, color: wep2.color });
        }
        return slots;
      })(),
      nearVehicle,
      nearVehicleName,
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
    this.clock.dispose();
    this.container.removeEventListener('mousedown', this.onMouseDown);
    this.container.removeEventListener('mouseup', this.onMouseUp);
    this.container.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('mousemove', this.onVehicleMouseMove);
    document.removeEventListener('wheel', this.onVehicleWheel);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.sky.dispose();
    this.vfx.dispose();
    this.projectileManager.dispose();
    this.netDiag.dispose();
    this.chunkBoundaryViewer.dispose();
    for (const ghost of this.predictedGrenadeGhosts) {
      this.scene.remove(ghost.mesh);
      ghost.mesh.geometry.dispose();
      (ghost.mesh.material as THREE.Material).dispose();
      if (ghost.light) {
        this.scene.remove(ghost.light);
        ghost.light.dispose();
      }
    }
    this.predictedGrenadeGhosts.length = 0;
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
