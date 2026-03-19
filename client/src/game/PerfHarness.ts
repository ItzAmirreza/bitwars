import * as THREE from 'three';
import type { Engine } from './Engine';
import { savePerfRun, listPerfRunSummaries, loadPerfRun, deletePerfRun, clearPerfRuns } from './PerfHistoryStore';
import type { PerfRunSummary } from './PerfHistoryStore';

export type PerfScenario = 'full';
export type HarnessMode = 'idle' | 'chunk-hop' | 'combat-chaos' | 'mixed-teleport';

export interface PerfSample {
  t: number;
  phase: HarnessMode;
  fps: number;
  frameMs: number;
  cpuFrameMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  jsHeapUsedMB: number;
  jsHeapTotalMB: number;
  jsHeapLimitMB: number;
  dpr: number;
  width: number;
  height: number;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  cameraSpeed: number;
  moveForward: number;
  moveRight: number;
  loadedChunks: number;
  meshedChunks: number;
  pendingChunkRequests: number;
  dirtyChunks: number;
  pendingChunkJobs: number;
  activeProjectiles: number;
  activeGrenadeVisuals: number;
  predictedGrenadeGhosts: number;
  activeRemotePlayers: number;
  activeVehicles: number;
  activeBreakupPieces: number;
  activeVfxParticles: number;
  activeTracers: number;
  activeFallingDebris: number;
  activeSettledDebris: number;
  dynamicLights: number;
  worldReady: number;
  startupLoadProgress: number;
  playerCount: number;
  serverTps: number;
  mountedVehicle: number;
}

export interface PerfRunResult {
  id: string;
  createdAt: string;
  durationSec: number;
  scenario: PerfScenario;
  metadata: {
    ua: string;
    hardwareConcurrency: number;
    platform: string;
    language: string;
    viewport: { width: number; height: number };
    gpuRenderer: string;
  };
  summary: {
    avgFps: number;
    p1Fps: number;
    avgFrameMs: number;
    p99FrameMs: number;
    avgCpuFrameMs: number;
    p99CpuFrameMs: number;
    avgDrawCalls: number;
    avgTriangles: number;
    avgLoadedChunks: number;
    avgMeshedChunks: number;
    avgPendingChunkRequests: number;
    avgDirtyChunks: number;
    avgProjectiles: number;
    avgVfxParticles: number;
    avgRemotePlayers: number;
    avgVehicles: number;
    avgCameraSpeed: number;
    avgJsHeapUsedMB: number;
    peakJsHeapUsedMB: number;
    worldReadyPct: number;
    avgPlayers: number;
  };
  samples: PerfSample[];
}

interface HarnessSnapshot {
  fps: number;
  frameMs: number;
  cpuFrameMs: number;
  serverTps: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  cameraPos: { x: number; y: number; z: number };
  cameraMoveIntent: { forward: number; right: number };
  loadedChunks: number;
  meshedChunks: number;
  pendingChunkRequests: number;
  dirtyChunks: number;
  pendingChunkJobs: number;
  activeProjectiles: number;
  activeGrenadeVisuals: number;
  predictedGrenadeGhosts: number;
  activeRemotePlayers: number;
  activeVehicles: number;
  activeBreakupPieces: number;
  activeVfxParticles: number;
  activeTracers: number;
  activeFallingDebris: number;
  activeSettledDebris: number;
  dynamicLights: number;
  startupLoadProgress: number;
  worldReady: boolean;
  playerCount: number;
  mountedVehicle: boolean;
  dpr: number;
  width: number;
  height: number;
}

export interface PerfHarnessHooks {
  getSnapshot: () => HarnessSnapshot;
  setSandboxFlightPath: (enabled: boolean, mode: HarnessMode) => void;
  setSandboxAutoFire: (enabled: boolean) => void;
  getGpuRenderer: () => string;
  enablePerfBenchmarkScene: (enabled: boolean) => void;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((p / 100) * sortedAsc.length)));
  return sortedAsc[idx]!;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]!;
  return s / values.length;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function nextRunId(): string {
  return `perf-${Date.now()}-${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
}

function memoryStatsMB(): { used: number; total: number; limit: number } {
  const mem = (performance as Performance & {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }).memory;

  if (!mem) return { used: 0, total: 0, limit: 0 };
  return {
    used: mem.usedJSHeapSize / (1024 * 1024),
    total: mem.totalJSHeapSize / (1024 * 1024),
    limit: mem.jsHeapSizeLimit / (1024 * 1024),
  };
}

export class PerfHarness {
  private hooks: PerfHarnessHooks;
  private runActive = false;
  private runStartMs = 0;
  private runDurationMs = 0;
  private lastTickMs = performance.now();
  private lastCameraPos = new THREE.Vector3();
  private samples: PerfSample[] = [];
  private scenario: PerfScenario = 'full';
  private currentMode: HarnessMode = 'idle';

  constructor(hooks: PerfHarnessHooks) {
    this.hooks = hooks;
    const c = hooks.getSnapshot().cameraPos;
    this.lastCameraPos.set(c.x, c.y, c.z);
  }

  isRunning(): boolean {
    return this.runActive;
  }

  start(durationSec = 60, scenario: PerfScenario = 'full'): boolean {
    if (this.runActive) return false;
    this.runActive = true;
    this.scenario = scenario;
    this.runDurationMs = Math.max(10_000, Math.floor(durationSec * 1000));
    this.runStartMs = performance.now();
    this.lastTickMs = this.runStartMs;
    this.samples = [];
    this.currentMode = 'chunk-hop';
    this.hooks.enablePerfBenchmarkScene(true);
    this.hooks.setSandboxAutoFire(false);
    this.hooks.setSandboxFlightPath(true, this.currentMode);
    return true;
  }

  async stopAndFinalize(): Promise<PerfRunResult | null> {
    if (!this.runActive) return null;
    this.runActive = false;
    this.hooks.enablePerfBenchmarkScene(false);
    this.hooks.setSandboxAutoFire(false);
    this.hooks.setSandboxFlightPath(false, 'idle');
    const result = this.finalize();
    await savePerfRun(result);
    return result;
  }

  async tick(): Promise<PerfRunResult | null> {
    if (!this.runActive) return null;
    const now = performance.now();
    const elapsed = now - this.runStartMs;

    if (this.scenario === 'full') {
      const t = elapsed / 1000;
      let mode: HarnessMode;
      if (t < 17) mode = 'chunk-hop';
      else if (t < 42) mode = 'combat-chaos';
      else if (t < 57) mode = 'mixed-teleport';
      else mode = 'combat-chaos';

      this.currentMode = mode;

      this.hooks.setSandboxFlightPath(true, mode);
      this.hooks.setSandboxAutoFire(mode === 'combat-chaos' || mode === 'mixed-teleport');
    }

    const snap = this.hooks.getSnapshot();
    const dt = Math.max(0.001, (now - this.lastTickMs) / 1000);
    this.lastTickMs = now;
    const cam = new THREE.Vector3(snap.cameraPos.x, snap.cameraPos.y, snap.cameraPos.z);
    const speed = cam.distanceTo(this.lastCameraPos) / dt;
    this.lastCameraPos.copy(cam);
    const mem = memoryStatsMB();

    this.samples.push({
      t: elapsed / 1000,
      phase: this.currentMode,
      fps: snap.fps,
      frameMs: snap.frameMs,
      cpuFrameMs: snap.cpuFrameMs,
      drawCalls: snap.drawCalls,
      triangles: snap.triangles,
      points: snap.points,
      lines: snap.lines,
      geometries: snap.geometries,
      textures: snap.textures,
      jsHeapUsedMB: mem.used,
      jsHeapTotalMB: mem.total,
      jsHeapLimitMB: mem.limit,
      dpr: snap.dpr,
      width: snap.width,
      height: snap.height,
      cameraX: snap.cameraPos.x,
      cameraY: snap.cameraPos.y,
      cameraZ: snap.cameraPos.z,
      cameraSpeed: speed,
      moveForward: snap.cameraMoveIntent.forward,
      moveRight: snap.cameraMoveIntent.right,
      loadedChunks: snap.loadedChunks,
      meshedChunks: snap.meshedChunks,
      pendingChunkRequests: snap.pendingChunkRequests,
      dirtyChunks: snap.dirtyChunks,
      pendingChunkJobs: snap.pendingChunkJobs,
      activeProjectiles: snap.activeProjectiles,
      activeGrenadeVisuals: snap.activeGrenadeVisuals,
      predictedGrenadeGhosts: snap.predictedGrenadeGhosts,
      activeRemotePlayers: snap.activeRemotePlayers,
      activeVehicles: snap.activeVehicles,
      activeBreakupPieces: snap.activeBreakupPieces,
      activeVfxParticles: snap.activeVfxParticles,
      activeTracers: snap.activeTracers,
      activeFallingDebris: snap.activeFallingDebris,
      activeSettledDebris: snap.activeSettledDebris,
      dynamicLights: snap.dynamicLights,
      worldReady: snap.worldReady ? 1 : 0,
      startupLoadProgress: snap.startupLoadProgress,
      playerCount: snap.playerCount,
      serverTps: snap.serverTps,
      mountedVehicle: snap.mountedVehicle ? 1 : 0,
    });

    if (elapsed >= this.runDurationMs) {
      this.runActive = false;
      this.hooks.enablePerfBenchmarkScene(false);
      this.hooks.setSandboxAutoFire(false);
      this.hooks.setSandboxFlightPath(false, 'idle');
      const result = this.finalize();
      await savePerfRun(result);
      return result;
    }

    return null;
  }

  async history(limit = 30): Promise<PerfRunSummary[]> {
    return listPerfRunSummaries(limit);
  }

  async loadRun(id: string): Promise<PerfRunResult | null> {
    return loadPerfRun(id);
  }

  async deleteRun(id: string): Promise<void> {
    await deletePerfRun(id);
  }

  async clearHistory(): Promise<void> {
    await clearPerfRuns();
  }

  exportRun(run: PerfRunResult): string {
    return JSON.stringify(run);
  }

  parseImportedRun(json: string): PerfRunResult | null {
    try {
      const parsed = JSON.parse(json) as PerfRunResult;
      if (!parsed || typeof parsed.id !== 'string' || !Array.isArray(parsed.samples)) return null;
      if (!parsed.summary || typeof parsed.summary.avgFps !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async saveImportedRun(run: PerfRunResult): Promise<void> {
    await savePerfRun(run);
  }

  private finalize(): PerfRunResult {
    const fps = this.samples.map((s) => s.fps).sort((a, b) => a - b);
    const frameMs = this.samples.map((s) => s.frameMs).sort((a, b) => a - b);
    const cpuMs = this.samples.map((s) => s.cpuFrameMs).sort((a, b) => a - b);

    const worldReadyCount = this.samples.reduce((acc, s) => acc + (s.worldReady > 0 ? 1 : 0), 0);
    const heapUsed = this.samples.map((s) => s.jsHeapUsedMB);

    const first = this.samples[0];
    const viewport = first
      ? { width: first.width, height: first.height }
      : { width: window.innerWidth, height: window.innerHeight };

    return {
      id: nextRunId(),
      createdAt: new Date().toISOString(),
      durationSec: this.samples.length > 0 ? this.samples[this.samples.length - 1]!.t : 0,
      scenario: this.scenario,
      metadata: {
        ua: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
        platform: navigator.platform,
        language: navigator.language,
        viewport,
        gpuRenderer: this.hooks.getGpuRenderer(),
      },
      summary: {
        avgFps: round2(avg(this.samples.map((s) => s.fps))),
        p1Fps: round2(percentile(fps, 1)),
        avgFrameMs: round2(avg(this.samples.map((s) => s.frameMs))),
        p99FrameMs: round2(percentile(frameMs, 99)),
        avgCpuFrameMs: round2(avg(this.samples.map((s) => s.cpuFrameMs))),
        p99CpuFrameMs: round2(percentile(cpuMs, 99)),
        avgDrawCalls: round2(avg(this.samples.map((s) => s.drawCalls))),
        avgTriangles: round2(avg(this.samples.map((s) => s.triangles))),
        avgLoadedChunks: round2(avg(this.samples.map((s) => s.loadedChunks))),
        avgMeshedChunks: round2(avg(this.samples.map((s) => s.meshedChunks))),
        avgPendingChunkRequests: round2(avg(this.samples.map((s) => s.pendingChunkRequests))),
        avgDirtyChunks: round2(avg(this.samples.map((s) => s.dirtyChunks))),
        avgProjectiles: round2(avg(this.samples.map((s) => s.activeProjectiles))),
        avgVfxParticles: round2(avg(this.samples.map((s) => s.activeVfxParticles))),
        avgRemotePlayers: round2(avg(this.samples.map((s) => s.activeRemotePlayers))),
        avgVehicles: round2(avg(this.samples.map((s) => s.activeVehicles))),
        avgCameraSpeed: round2(avg(this.samples.map((s) => s.cameraSpeed))),
        avgJsHeapUsedMB: round2(avg(heapUsed)),
        peakJsHeapUsedMB: round2(heapUsed.length > 0 ? Math.max(...heapUsed) : 0),
        worldReadyPct: round2(this.samples.length === 0 ? 0 : (worldReadyCount / this.samples.length) * 100),
        avgPlayers: round2(avg(this.samples.map((s) => s.playerCount))),
      },
      samples: this.samples,
    };
  }
}

function countLoadedChunks(engine: Engine): number {
  const world = (engine as unknown as { world?: { getLoadedChunkIds?: () => Iterable<number> } }).world;
  if (!world?.getLoadedChunkIds) return 0;
  let c = 0;
  for (const _ of world.getLoadedChunkIds()) c++;
  return c;
}

function countMeshedChunks(engine: Engine): number {
  const world = (engine as unknown as { world?: { getLoadedChunkIds?: () => Iterable<number>; hasChunkMesh?: (cx: number, cy: number, cz: number) => boolean } }).world;
  if (!world?.getLoadedChunkIds || !world?.hasChunkMesh) return 0;
  let c = 0;
  for (const id of world.getLoadedChunkIds()) {
    const cx = id & 0xff;
    const cy = (id >> 8) & 0xff;
    const cz = (id >> 16) & 0xff;
    if (world.hasChunkMesh(cx, cy, cz)) c++;
  }
  return c;
}

function pendingChunkRequests(engine: Engine): number {
  const streamer = (engine as unknown as { chunkStreamer?: { pendingChunkRequests?: Map<number, number> } }).chunkStreamer;
  return streamer?.pendingChunkRequests?.size ?? 0;
}

function dirtyChunkCount(engine: Engine): number {
  const world = (engine as unknown as { world?: { dirtyChunks?: Set<number> } }).world;
  return world?.dirtyChunks?.size ?? 0;
}

function pendingChunkJobs(engine: Engine): number {
  const world = (engine as unknown as { world?: { pendingChunkJobs?: Set<number> } }).world;
  return world?.pendingChunkJobs?.size ?? 0;
}

function webGlRendererString(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  if (ext) {
    const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string;
    const device = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    return `${vendor} / ${device}`;
  }
  return String(gl.getParameter(gl.RENDERER));
}

export function buildPerfHooks(engine: Engine): PerfHarnessHooks {
  return {
    getSnapshot: () => {
      const e = engine as unknown as {
        currentFps?: number;
        currentServerTps?: number;
        renderer?: THREE.WebGLRenderer;
        camera?: THREE.PerspectiveCamera;
        chunkStreamer?: { startupWorldReady?: boolean; pendingChunkRequests?: Map<number, number>; getStartupLoadProgress?: () => number };
        projectileManager?: { projectiles?: Array<unknown> };
        grenadeVisuals?: Map<bigint, unknown>;
        predictedGrenadeGhosts?: Array<unknown>;
        remotePlayers?: { otherPlayers?: Map<string, unknown> };
        vehicleManager?: { vehicles?: Map<number, unknown>; vehicleBreakupPieces?: Array<unknown> };
        vfx?: { particles?: Array<unknown>; tracers?: Array<unknown> };
        physics?: { falling?: Array<unknown>; settled?: Array<unknown> };
        dynamicLights?: Map<string, unknown>;
        __perfLastState?: { frameMs?: number; cpuFrameMs?: number; playerCount?: number };
        mountedVehicleId?: number;
      };

      const renderer = e.renderer;
      const info = renderer?.info;
      const cam = e.camera?.position ?? new THREE.Vector3();
      const state = e.__perfLastState;
      const controls = (engine as unknown as { controls?: { moveForward?: boolean; moveBackward?: boolean; moveLeft?: boolean; moveRight?: boolean } }).controls;

      return {
        fps: e.currentFps ?? 0,
        frameMs: state?.frameMs ?? 0,
        cpuFrameMs: state?.cpuFrameMs ?? 0,
        serverTps: e.currentServerTps ?? 0,
        drawCalls: info?.render.calls ?? 0,
        triangles: info?.render.triangles ?? 0,
        points: info?.render.points ?? 0,
        lines: info?.render.lines ?? 0,
        geometries: info?.memory.geometries ?? 0,
        textures: info?.memory.textures ?? 0,
        cameraPos: { x: cam.x, y: cam.y, z: cam.z },
        cameraMoveIntent: {
          forward: (controls?.moveForward ? 1 : 0) - (controls?.moveBackward ? 1 : 0),
          right: (controls?.moveRight ? 1 : 0) - (controls?.moveLeft ? 1 : 0),
        },
        loadedChunks: countLoadedChunks(engine),
        meshedChunks: countMeshedChunks(engine),
        pendingChunkRequests: pendingChunkRequests(engine),
        dirtyChunks: dirtyChunkCount(engine),
        pendingChunkJobs: pendingChunkJobs(engine),
        activeProjectiles: e.projectileManager?.projectiles?.length ?? 0,
        activeGrenadeVisuals: e.grenadeVisuals?.size ?? 0,
        predictedGrenadeGhosts: e.predictedGrenadeGhosts?.length ?? 0,
        activeRemotePlayers: e.remotePlayers?.otherPlayers?.size ?? 0,
        activeVehicles: e.vehicleManager?.vehicles?.size ?? 0,
        activeBreakupPieces: e.vehicleManager?.vehicleBreakupPieces?.length ?? 0,
        activeVfxParticles: e.vfx?.particles?.length ?? 0,
        activeTracers: e.vfx?.tracers?.length ?? 0,
        activeFallingDebris: e.physics?.falling?.length ?? 0,
        activeSettledDebris: e.physics?.settled?.length ?? 0,
        dynamicLights: e.dynamicLights?.size ?? 0,
        startupLoadProgress: e.chunkStreamer?.getStartupLoadProgress?.() ?? 1,
        worldReady: e.chunkStreamer?.startupWorldReady ?? false,
        playerCount: state?.playerCount ?? 1,
        mountedVehicle: (e.mountedVehicleId ?? 0) !== 0,
        dpr: renderer?.getPixelRatio() ?? window.devicePixelRatio,
        width: renderer?.domElement.width ?? window.innerWidth,
        height: renderer?.domElement.height ?? window.innerHeight,
      };
    },
    setSandboxFlightPath: (enabled: boolean, mode: HarnessMode) => {
      (engine as unknown as { setPerfSandboxMotion?: (enabled: boolean, mode: HarnessMode) => void }).setPerfSandboxMotion?.(enabled, mode);
      if (!enabled) {
        (engine as unknown as { setPerfSandboxAutoFire?: (enabled: boolean) => void }).setPerfSandboxAutoFire?.(false);
      }
    },
    setSandboxAutoFire: (enabled: boolean) => {
      (engine as unknown as { setPerfSandboxAutoFire?: (enabled: boolean) => void }).setPerfSandboxAutoFire?.(enabled);
    },
    getGpuRenderer: () => {
      const renderer = (engine as unknown as { renderer?: THREE.WebGLRenderer }).renderer;
      if (!renderer) return 'unknown';
      return webGlRendererString(renderer);
    },
    enablePerfBenchmarkScene: (enabled: boolean) => {
      (engine as unknown as { setPerfBenchmarkSceneEnabled?: (enabled: boolean) => void }).setPerfBenchmarkSceneEnabled?.(enabled);
    },
  };
}
