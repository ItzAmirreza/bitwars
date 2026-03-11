import * as THREE from 'three';
import { VoxelWorld, BLOCK_COLORS } from './VoxelWorld';
import { FPSControls } from './FPSControls';
import { WeaponSystem, WEAPONS } from './Weapons';
import { AudioSystem } from './AudioSystem';
import { VFX } from './VFX';
import { WeaponModel } from './WeaponModel';
import { PostFX } from './PostFX';
import { PhysicsSystem } from './PhysicsSystem';
import type { DbConnection } from '../module_bindings';
import type { GameSettings } from '../store';

// ── World config ──
const WORLD_X = 128;
const WORLD_Y = 48;
const WORLD_Z = 128;

export interface EngineState {
  weapon: number;
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

  // Lighting
  private sun: THREE.DirectionalLight;

  // State
  private clock: THREE.Clock;
  private container: HTMLElement;
  private conn: DbConnection | null;
  private onStateChange: (state: EngineState) => void;

  private frameCount = 0;
  private fpsTime = 0;
  private currentFps = 0;
  private animationId = 0;
  private mouseDown = false;
  private lastPositionUpdate = 0;
  private otherPlayers: Map<string, THREE.Group> = new Map();
  private health = 100;
  private kills = 0;
  private deaths = 0;
  private hitMarkerTimer = 0;
  private lastWeaponIndex = 0;
  private elapsedTime = 0;

  constructor(
    container: HTMLElement,
    conn: DbConnection | null,
    onStateChange: (state: EngineState) => void,
  ) {
    this.container = container;
    this.conn = conn;
    this.onStateChange = onStateChange;
    this.clock = new THREE.Clock();

    const w = container.clientWidth;
    const h = container.clientHeight;

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x3a3836);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    container.appendChild(this.renderer.domElement);

    // ── Camera ──
    this.camera = new THREE.PerspectiveCamera(75, w / h, 0.1, 300);

    // ── Scene ──
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x3a3836, 40, 120);

    // ── Lighting — dramatic warzone atmosphere ──
    // Hemisphere light: sky/ground color variation
    const hemiLight = new THREE.HemisphereLight(0x6a6a72, 0x2a2218, 0.6);
    this.scene.add(hemiLight);

    // Ambient fill
    this.scene.add(new THREE.AmbientLight(0x404048, 0.4));

    // Directional sun with shadows
    this.sun = new THREE.DirectionalLight(0xffe0b0, 2.0);
    this.sun.position.set(50, 80, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.camera.left = -80;
    this.sun.shadow.camera.right = 80;
    this.sun.shadow.camera.top = 80;
    this.sun.shadow.camera.bottom = -80;
    this.sun.shadow.bias = -0.001;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // ── Voxel world (128×48×128) ──
    this.world = new VoxelWorld(WORLD_X, WORLD_Y, WORLD_Z);
    this.world.generateTerrain();
    this.syncDestroyedBlocks();
    this.world.rebuildDirtyChunks(this.scene);

    // ── Ground plane ──
    const groundGeo = new THREE.PlaneGeometry(256, 256);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x3a3632 });
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

    // ── Audio ──
    this.audio = new AudioSystem();

    // ── VFX ──
    this.vfx = new VFX(this.scene, this.camera);

    // ── Physics ──
    this.physics = new PhysicsSystem(this.scene, this.world, this.vfx, this.audio);

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
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setMasterVolume(settings.masterVolume);
    this.sun.castShadow = settings.shadowsEnabled;
    this.postfx.enabled = settings.postFXEnabled;

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
    if (e.code === 'KeyR') { this.weapons.reload(); this.audio.playReload(); }
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
      const idx = parseInt(e.code.charAt(5)) - 1;
      if (idx !== this.lastWeaponIndex) {
        this.weaponModel.switchWeapon(idx);
        this.audio.playSwitch();
        this.lastWeaponIndex = idx;
      }
    }
  };

  // ── FIRE ──

  private tryFire(): void {
    if (this.weapons.weapon.ammo <= 0) { this.audio.playEmpty(); return; }

    const result = this.weapons.fire();
    if (!result) return;

    const isRifle = result.weaponIndex === 0;
    const isShotgun = result.weaponIndex === 1;
    const isRPG = result.weaponIndex === 2;

    // Audio
    if (isRifle) this.audio.playRifle();
    else if (isShotgun) this.audio.playShotgun();
    else if (isRPG) this.audio.playRPGLaunch();

    // VFX
    this.vfx.emitMuzzleFlash();
    this.vfx.shake(isRPG ? 1.5 : isShotgun ? 0.8 : 0.3);
    this.weaponModel.triggerRecoil(WEAPONS[result.weaponIndex].recoil);

    // Tracer (rifle)
    if (isRifle && result.tracerEnd) {
      const from = this.camera.position.clone()
        .add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion));
      this.vfx.emitTracer(from, result.tracerEnd, 0x88bbff);
    }

    // Block hit
    if (result.hitPos) {
      this.audio.playBlockBreak();
      this.hitMarkerTimer = 0.15;

      // Debris particles (cap for perf)
      const blocks = result.destroyedBlocks;
      const max = isRPG ? 15 : isShotgun ? 8 : blocks.length;
      const sampled = blocks.length > max
        ? blocks.sort(() => Math.random() - 0.5).slice(0, max) : blocks;
      for (const b of sampled) {
        this.vfx.emitBlockDebris(b.x, b.y, b.z, BLOCK_COLORS[b.blockType] || 0x808080);
      }
      this.vfx.emitImpact(result.hitPos.x, result.hitPos.y, result.hitPos.z);

      // Explosion
      if (WEAPONS[result.weaponIndex].radius > 0) {
        this.vfx.emitExplosion(result.hitPos.x, result.hitPos.y, result.hitPos.z,
          WEAPONS[result.weaponIndex].radius);
        if (isRPG) setTimeout(() => this.audio.playExplosion(), 80);
        else this.audio.playExplosion();
      }
    }

    // Server sync destroyed blocks
    this.syncDestroyedToServer(result.destroyedBlocks);

    // Physics: check for falling blocks above
    const fallen = this.physics.checkFalling(result.destroyedBlocks);
    if (fallen.length > 0) this.syncDestroyedToServer(fallen);

    // Rebuild affected chunks
    this.world.rebuildDirtyChunks(this.scene);
  }

  // ── SERVER SYNC ──

  private syncDestroyedBlocks(): void {
    if (!this.conn) return;
    for (const block of this.conn.db.destroyed_block.iter()) {
      this.world.setBlock(block.x, block.y, block.z, 0);
    }
  }

  private syncDestroyedToServer(blocks: { x: number; y: number; z: number }[]): void {
    if (!this.conn || blocks.length === 0) return;
    if (blocks.length === 1) {
      const b = blocks[0];
      this.conn.reducers.destroyBlock({ x: b.x, y: b.y, z: b.z });
    } else {
      this.conn.reducers.destroyBlocks({
        blocks: blocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
      });
    }
  }

  private setupServerListeners(): void {
    if (!this.conn) return;

    // Remote block destruction
    this.conn.db.destroyed_block.onInsert((_ctx: unknown, block: { x: number; y: number; z: number }) => {
      if (this.world.getBlock(block.x, block.y, block.z) !== 0) {
        this.world.setBlock(block.x, block.y, block.z, 0);
        this.vfx.emitImpact(block.x, block.y, block.z);

        // Falling blocks from remote destruction
        const fallen = this.physics.checkFalling([block]);
        if (fallen.length > 0) this.syncDestroyedToServer(fallen);

        this.world.rebuildDirtyChunks(this.scene);
      }
    });

    // Player tracking
    this.conn.db.player.onUpdate((_ctx: unknown, _old: unknown, player: any) => {
      const id = player.identity.toHexString();
      const myId = this.conn ? Array.from(this.conn.db.player.iter()).find(
        (p: any) => p.username && p.online,
      )?.identity.toHexString() : null;

      if (myId && id === myId) {
        const oldHealth = this.health;
        this.health = player.health;
        this.kills = player.kills;
        this.deaths = player.deaths;
        if (player.health < oldHealth) {
          const dmgRatio = (oldHealth - player.health) / 100;
          this.postfx.triggerDamage(0.3 + dmgRatio * 0.7);
          this.audio.playDamage();
          this.vfx.shake(0.5 + dmgRatio);
        }
        return;
      }

      if (player.online) {
        this.updateOtherPlayer(id, player.pos, player.rot, player.username);
      } else {
        this.removeOtherPlayer(id);
      }
    });

    this.conn.db.player.onDelete((_ctx: unknown, player: any) => {
      this.removeOtherPlayer(player.identity.toHexString());
    });
  }

  // ── OTHER PLAYERS ──

  private updateOtherPlayer(
    id: string, pos: { x: number; y: number; z: number },
    rot: { yaw: number; pitch: number }, username: string,
  ): void {
    let group = this.otherPlayers.get(id);
    if (!group) {
      group = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8b4444 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.5, 0.6), bodyMat);
      body.position.y = 0.75;
      body.castShadow = true;
      group.add(body);
      const headMat = new THREE.MeshLambertMaterial({ color: 0xccaa88 });
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
      head.position.y = 1.7;
      head.castShadow = true;
      group.add(head);
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx2d = canvas.getContext('2d')!;
      ctx2d.fillStyle = '#00ff88'; ctx2d.font = 'bold 28px monospace'; ctx2d.textAlign = 'center';
      ctx2d.fillText(username, 128, 40);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
      sprite.position.y = 2.3; sprite.scale.set(2, 0.5, 1);
      group.add(sprite);
      this.scene.add(group);
      this.otherPlayers.set(id, group);
    }
    group.position.lerp(new THREE.Vector3(pos.x, pos.y - 1.7, pos.z), 0.3);
    group.rotation.y = rot.yaw;
  }

  private removeOtherPlayer(id: string): void {
    const g = this.otherPlayers.get(id);
    if (g) { this.scene.remove(g); this.otherPlayers.delete(id); }
  }

  // ── HELPERS ──

  private getGroundHeight(x: number, z: number): number {
    const top = this.world.getHighestBlock(x, z);
    return top >= 0 ? top + 1 : 0;
  }

  private sendPositionUpdate(): void {
    if (!this.conn) return;
    const now = performance.now();
    if (now - this.lastPositionUpdate < 50) return;
    this.lastPositionUpdate = now;
    const p = this.camera.position;
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.conn.reducers.updatePosition({
      pos: {
        x: Math.max(-1, Math.min(WORLD_X + 1, p.x)),
        y: Math.max(-10, Math.min(100, p.y)),
        z: Math.max(-1, Math.min(WORLD_Z + 1, p.z)),
      },
      rot: { yaw: e.y, pitch: e.x },
      weapon: this.weapons.currentWeapon,
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

    // Update systems
    this.controls.update(delta, (x, z) => this.getGroundHeight(x, z));

    // Auto-fire
    if (this.mouseDown && this.controls.locked) this.tryFire();

    // Weapon switch via scroll
    if (this.weapons.currentWeapon !== this.lastWeaponIndex) {
      this.weaponModel.switchWeapon(this.weapons.currentWeapon);
      this.audio.playSwitch();
      this.lastWeaponIndex = this.weapons.currentWeapon;
    }

    // Physics (falling blocks)
    this.physics.update(delta);

    // VFX
    this.vfx.update(delta);

    // Weapon model — pass sprint/crouch state
    const moving = this.controls.moveForward || this.controls.moveBackward
      || this.controls.moveLeft || this.controls.moveRight;
    this.weaponModel.setMoving(moving, this.controls.isSprinting, this.controls.isCrouching);
    this.weaponModel.update(delta);

    // PostFX
    this.postfx.update(delta, this.elapsedTime);

    // Hit marker
    if (this.hitMarkerTimer > 0) this.hitMarkerTimer -= delta;

    // Position sync
    if (this.controls.locked) this.sendPositionUpdate();

    // Rebuild any dirty chunks (from physics landings, etc.)
    this.world.rebuildDirtyChunks(this.scene);

    // ── RENDER PASSES ──
    // Apply head bob + screen shake to camera just for rendering, then undo
    const savedQuat = this.camera.quaternion.clone();
    const savedPos = this.camera.position.clone();

    // Head bob offset
    this.camera.position.y += this.controls.headBobY;
    this.camera.position.x += this.controls.headBobX;

    if (this.vfx.shakeOffsetX !== 0 || this.vfx.shakeOffsetY !== 0) {
      const shakeQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.vfx.shakeOffsetX, this.vfx.shakeOffsetY, 0, 'YXZ'),
      );
      this.camera.quaternion.multiply(shakeQuat);
    }

    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.weaponModel.scene, this.weaponModel.camera);
    this.postfx.render(this.renderer);
    this.renderer.autoClear = true;

    // Restore clean camera
    this.camera.quaternion.copy(savedQuat);
    this.camera.position.copy(savedPos);

    // Push state to HUD
    const wp = WEAPONS[this.weapons.currentWeapon];
    const pc = this.conn
      ? Array.from(this.conn.db.player.iter()).filter((p: any) => p.online).length : 1;
    this.onStateChange({
      weapon: this.weapons.currentWeapon,
      ammo: wp.ammo, maxAmmo: wp.maxAmmo,
      weaponName: wp.name, weaponColor: wp.color,
      fps: this.currentFps, locked: this.controls.locked,
      playerCount: pc, health: this.health,
      kills: this.kills, deaths: this.deaths,
      hitMarker: this.hitMarkerTimer > 0,
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
    this.vfx.dispose();
    this.physics.dispose();
    this.weaponModel.dispose();
    this.postfx.dispose();
    this.audio.dispose();
    this.world.dispose(this.scene);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    for (const [, g] of this.otherPlayers) this.scene.remove(g);
    this.otherPlayers.clear();
  }
}
