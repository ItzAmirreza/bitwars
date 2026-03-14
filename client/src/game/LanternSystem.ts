import * as THREE from 'three';
import { BlockType, CHUNK, WORLD_X, WORLD_Y, WORLD_Z, packChunkId, unpackChunkId } from './VoxelWorld';
import type { VoxelWorld } from './VoxelWorld';
import type { SkySystem } from './SkySystem';
import type { DynamicLightOptions } from './Engine';

// ── Lantern lighting constants ──
const MAX_ACTIVE_LANTERN_LIGHTS = 6;
const MAX_ACTIVE_LANTERN_GLOWS = 180;
const LANTERN_LIGHT_REFRESH_INTERVAL = 0.25;
const LANTERN_LIGHT_MAX_DISTANCE = 36;
const LANTERN_LIGHT_KEEP_DISTANCE = 56;
const LANTERN_GLOW_MAX_DISTANCE = 190;

/** Context interface for Engine dependencies that LanternSystem needs. */
export interface LanternContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: VoxelWorld;
  sky: SkySystem;
  elapsedTime: number;
  dynamicLights: Map<string, { light: THREE.PointLight | THREE.SpotLight; kind: string }>;
  addDynamicLight(options: DynamicLightOptions): string;
  removeDynamicLight(id: string): void;
  updateDynamicLight(id: string, patch: Partial<DynamicLightOptions>): void;
}

export class LanternSystem {
  // Lantern positions indexed by packed chunk id
  lanternPositionsByChunk = new Map<number, Array<{ x: number; y: number; z: number }>>();

  // Currently active lantern point-light ids, keyed by "x,y,z" string
  activeLanternLights = new Map<string, string>();

  // Reverse mapping: dynamic light id → lantern "x,y,z" key
  lanternLightKeyById = new Map<string, string>();

  // Glow billboard state
  private lanternGlowTexture: THREE.CanvasTexture | null = null;
  private lanternGlowPoints: THREE.Points | null = null;
  private lanternGlowPositions = new Float32Array(MAX_ACTIVE_LANTERN_GLOWS * 3);
  private lanternGlowColors = new Float32Array(MAX_ACTIVE_LANTERN_GLOWS * 3);

  // Refresh timer (seconds until next full refresh)
  lanternRefreshTimer = 0;

  // ── Public API ────────────────────────────────────────────────────

  /** Compute lantern visibility factor from current sun visibility. */
  getLanternVisibilityFromSun(sunVisibility: number): number {
    const t = THREE.MathUtils.clamp((0.24 - sunVisibility) / 0.2, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** Remove all lantern lights registered for a specific chunk. */
  clearLanternLightsForChunk(chunkId: number, ctx: LanternContext): void {
    const positions = this.lanternPositionsByChunk.get(chunkId);
    if (!positions) return;
    for (const pos of positions) {
      const key = `${pos.x},${pos.y},${pos.z}`;
      const id = this.activeLanternLights.get(key);
      if (!id) continue;
      ctx.removeDynamicLight(id);
    }
    this.lanternPositionsByChunk.delete(chunkId);
  }

  /** Scan a chunk for lantern blocks and register their positions. */
  syncLanternLightsForChunk(
    cx: number, cy: number, cz: number,
    ctx: LanternContext,
    chunkBlocks?: Uint8Array,
  ): void {
    const chunkId = packChunkId(cx, cy, cz);
    this.clearLanternLightsForChunk(chunkId, ctx);

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
            : ctx.world.getBlock(wx, wy, wz);
          if (blockType !== BlockType.Lantern) continue;

          positions.push({ x: wx, y: wy, z: wz });
        }
      }
    }

    if (positions.length > 0) this.lanternPositionsByChunk.set(chunkId, positions);
    this.lanternRefreshTimer = 0;
  }

  /** Refresh the set of active lantern point-lights based on player proximity. */
  refreshLanternLights(lanternVisibility: number, ctx: LanternContext): void {
    if (lanternVisibility <= 0.001) {
      for (const id of Array.from(this.activeLanternLights.values())) ctx.removeDynamicLight(id);
      this.activeLanternLights.clear();
      this.clearLanternGlows();
      return;
    }

    const addDistance2 = LANTERN_LIGHT_MAX_DISTANCE * LANTERN_LIGHT_MAX_DISTANCE;
    const keepDistance2 = LANTERN_LIGHT_KEEP_DISTANCE * LANTERN_LIGHT_KEEP_DISTANCE;
    const chunkRadius = Math.ceil(LANTERN_LIGHT_KEEP_DISTANCE / CHUNK) + 1;
    const playerCx = Math.floor(THREE.MathUtils.clamp(ctx.camera.position.x, 0, WORLD_X - 1) / CHUNK);
    const playerCy = Math.floor(THREE.MathUtils.clamp(ctx.camera.position.y, 0, WORLD_Y - 1) / CHUNK);
    const playerCz = Math.floor(THREE.MathUtils.clamp(ctx.camera.position.z, 0, WORLD_Z - 1) / CHUNK);
    const addCandidates: Array<{ key: string; x: number; y: number; z: number; d2: number }> = [];
    const keepCandidates = new Map<string, { key: string; x: number; y: number; z: number; d2: number }>();

    for (const [chunkId, positions] of this.lanternPositionsByChunk) {
      const [cx, cy, cz] = unpackChunkId(chunkId);
      if (Math.abs(cx - playerCx) > chunkRadius) continue;
      if (Math.abs(cy - playerCy) > chunkRadius) continue;
      if (Math.abs(cz - playerCz) > chunkRadius) continue;

      for (const pos of positions) {
        const dx = pos.x + 0.5 - ctx.camera.position.x;
        const dy = pos.y + 0.6 - ctx.camera.position.y;
        const dz = pos.z + 0.5 - ctx.camera.position.z;
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
      for (const id of Array.from(this.activeLanternLights.values())) ctx.removeDynamicLight(id);
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
      if (!id || !ctx.dynamicLights.has(id)) {
        id = ctx.addDynamicLight({
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
        ctx.updateDynamicLight(id, {
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
      ctx.removeDynamicLight(id);
      this.activeLanternLights.delete(key);
    }

    this.refreshLanternGlows(lanternVisibility, ctx);
  }

  /** Called when a dynamic light is removed externally — clean up reverse maps. */
  onDynamicLightRemoved(id: string): void {
    const lanternKey = this.lanternLightKeyById.get(id);
    if (lanternKey) {
      this.activeLanternLights.delete(lanternKey);
      this.lanternLightKeyById.delete(id);
    }
  }

  /** Called every frame from updateDynamicLights to manage refresh timer and trigger refresh. */
  update(delta: number, ctx: LanternContext): void {
    const sunVisibility = ctx.sky.getSunVisibility();
    const lanternVisibility = this.getLanternVisibilityFromSun(sunVisibility);

    this.lanternRefreshTimer -= delta;
    if (this.lanternRefreshTimer <= 0) {
      this.lanternRefreshTimer = LANTERN_LIGHT_REFRESH_INTERVAL;
      this.refreshLanternLights(lanternVisibility, ctx);
    }
  }

  /** Get the flicker-adjusted intensity for a lantern light at the current time. */
  getLanternFlickerIntensity(
    baseIntensity: number,
    phase: number,
    lanternVisibility: number,
    elapsedTime: number,
    delta: number,
    currentIntensity: number,
  ): number {
    const glow = 0.94 + 0.06 * Math.sin(elapsedTime * 2.4 + phase);
    const targetIntensity = baseIntensity * lanternVisibility * glow;
    const blend = Math.min(1, delta * 5.5);
    return currentIntensity + (targetIntensity - currentIntensity) * blend;
  }

  /** Reset all lantern state (for map reset). */
  reset(ctx: LanternContext): void {
    for (const chunkId of Array.from(this.lanternPositionsByChunk.keys())) {
      this.clearLanternLightsForChunk(chunkId, ctx);
    }
    this.lanternPositionsByChunk.clear();
    this.activeLanternLights.clear();
    this.lanternLightKeyById.clear();
    this.lanternRefreshTimer = 0;
    this.clearLanternGlows();
  }

  /** Dispose all GPU resources (call on Engine destroy). */
  dispose(ctx: LanternContext): void {
    this.clearLanternGlows();
    if (this.lanternGlowPoints) {
      ctx.scene.remove(this.lanternGlowPoints);
      this.lanternGlowPoints.geometry.dispose();
      (this.lanternGlowPoints.material as THREE.Material).dispose();
      this.lanternGlowPoints = null;
    }
    if (this.lanternGlowTexture) {
      this.lanternGlowTexture.dispose();
      this.lanternGlowTexture = null;
    }
    this.lanternLightKeyById.clear();
  }

  // ── Private helpers ───────────────────────────────────────────────

  private createLanternGlowTexture(): THREE.CanvasTexture {
    if (this.lanternGlowTexture) return this.lanternGlowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      this.lanternGlowTexture = tex;
      return tex;
    }

    const gradient = ctx2d.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 240, 180, 1.0)');
    gradient.addColorStop(0.25, 'rgba(255, 200, 110, 0.8)');
    gradient.addColorStop(0.55, 'rgba(255, 150, 70, 0.45)');
    gradient.addColorStop(1, 'rgba(255, 120, 30, 0.0)');
    ctx2d.fillStyle = gradient;
    ctx2d.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.lanternGlowTexture = tex;
    return tex;
  }

  private ensureLanternGlowPoints(ctx: LanternContext): void {
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
    ctx.scene.add(this.lanternGlowPoints);
  }

  private clearLanternGlows(): void {
    if (!this.lanternGlowPoints) return;
    this.lanternGlowPoints.geometry.setDrawRange(0, 0);
    const posAttr = this.lanternGlowPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colorAttr = this.lanternGlowPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  }

  private refreshLanternGlows(lanternVisibility: number, ctx: LanternContext): void {
    this.ensureLanternGlowPoints(ctx);
    if (!this.lanternGlowPoints) return;

    if (lanternVisibility <= 0.001) {
      this.clearLanternGlows();
      return;
    }

    const maxGlowD2 = LANTERN_GLOW_MAX_DISTANCE * LANTERN_GLOW_MAX_DISTANCE;
    const chunkRadius = Math.ceil(LANTERN_GLOW_MAX_DISTANCE / CHUNK) + 1;
    const playerCx = Math.floor(THREE.MathUtils.clamp(ctx.camera.position.x, 0, WORLD_X - 1) / CHUNK);
    const playerCy = Math.floor(THREE.MathUtils.clamp(ctx.camera.position.y, 0, WORLD_Y - 1) / CHUNK);
    const playerCz = Math.floor(THREE.MathUtils.clamp(ctx.camera.position.z, 0, WORLD_Z - 1) / CHUNK);

    const farNearest: Array<{ x: number; y: number; z: number; d2: number }> = [];
    let worstD2 = -1;
    let worstIndex = -1;

    for (const [chunkId, positions] of this.lanternPositionsByChunk) {
      const [cx, cy, cz] = unpackChunkId(chunkId);
      if (Math.abs(cx - playerCx) > chunkRadius) continue;
      if (Math.abs(cy - playerCy) > chunkRadius) continue;
      if (Math.abs(cz - playerCz) > chunkRadius) continue;

      for (const pos of positions) {
        const dx = pos.x + 0.5 - ctx.camera.position.x;
        const dy = pos.y + 0.72 - ctx.camera.position.y;
        const dz = pos.z + 0.5 - ctx.camera.position.z;
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
      const pulse = 0.9 + 0.1 * Math.sin(ctx.elapsedTime * 2.2 + i * 0.7);
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
}
