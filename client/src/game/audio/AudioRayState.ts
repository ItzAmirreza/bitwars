/**
 * AudioRayState — main-thread store for ray-traced acoustic environment data
 * and per-source sound propagation.
 *
 * Receives results from the AudioRayTracer web worker and provides smoothly
 * interpolated acoustic parameters that AudioCore reads every frame:
 *
 *   - Room reverb parameters (delay, decay, volume)
 *   - Indoor/outdoor blend factor
 *   - Per-source apparent direction (for sound propagation through openings)
 *   - Per-source occlusion factor
 *
 * Values are lerped between worker updates (~60ms intervals) to avoid
 * discontinuities in the audio graph.
 */

import type { Vec3Like } from './AudioCore';

// ── Per-source propagation result from the worker ──

export interface SourcePropagationResult {
  id: number;
  apparentDirX: number;
  apparentDirY: number;
  apparentDirZ: number;
  occlusion: number;
  directLOS: boolean;
}

/** Data sent from the ray tracer worker per update cycle. */
export interface RayTraceResult {
  /** Average bounce distance of returning rays (meters). Short = small room. */
  avgBounceDistance: number;
  /** Ratio of rays that returned to listener (0–1). Higher = more reverb. */
  returnRatio: number;
  /** Ratio of rays that escaped to open sky (0–1). Higher = more outdoors. */
  outdoorRatio: number;
  /** Listener position at time of trace (for staleness detection). */
  listenerPos: Vec3Like;
  /** Timestamp when the trace completed (performance.now in worker). */
  timestamp: number;
  /** Per-source propagation results. */
  sources: SourcePropagationResult[];
}

/** Smoothed acoustic parameters used by AudioCore. */
export interface AcousticEnvironment {
  /** Reverb pre-delay in seconds (small room ~0.01, large room ~0.06). */
  reverbDelay: number;
  /** Reverb decay time in seconds (small room ~0.3, large room ~1.5). */
  reverbDecay: number;
  /** Reverb wet level 0–1 (how loud the echo is). */
  reverbWet: number;
  /** Indoor factor 0–1 (1 = fully indoors, 0 = fully outdoors). */
  indoorFactor: number;
  /** Whether ray data is available (false until first worker response). */
  ready: boolean;
}

/** Smoothed per-source propagation data. */
export interface SourcePropagation {
  /** Smoothed apparent direction (unit vector from listener). */
  apparentDirX: number;
  apparentDirY: number;
  apparentDirZ: number;
  /** Smoothed occlusion factor (0 = clear, 1 = fully blocked). */
  occlusion: number;
  /** Whether the source has direct line-of-sight (latest sample, not smoothed). */
  directLOS: boolean;
}

/** Lerp smoothing speed — lower = smoother but laggier. */
const LERP_SPEED = 6;
/** Faster lerp for direction changes (sound direction should respond quickly). */
const DIR_LERP_SPEED = 10;

export class AudioRayState {
  private current: AcousticEnvironment = {
    reverbDelay: 0.03,
    reverbDecay: 0.5,
    reverbWet: 0.12,
    indoorFactor: 0.5,
    ready: false,
  };

  private target: AcousticEnvironment = { ...this.current };
  private lastResult: RayTraceResult | null = null;

  /** Per-source smoothed propagation data. Keyed by source ID. */
  private sourcePropagation = new Map<number, SourcePropagation>();
  /** Per-source target (from latest worker result). Keyed by source ID. */
  private sourcePropTarget = new Map<number, SourcePropagationResult>();

  /** Registered persistent sound source positions (sent to worker each trace). */
  private registeredSources = new Map<number, Vec3Like>();

  // ── Source registration ──

  /**
   * Register a persistent sound source for propagation tracing.
   * Called when a vehicle engine starts, looping sound begins, etc.
   */
  registerSource(id: number, position: Vec3Like): void {
    this.registeredSources.set(id, { x: position.x, y: position.y, z: position.z });
  }

  /**
   * Update a registered source's position.
   * Called every frame for moving sources (vehicles).
   */
  updateSourcePosition(id: number, position: Vec3Like): void {
    const src = this.registeredSources.get(id);
    if (src) {
      src.x = position.x;
      src.y = position.y;
      src.z = position.z;
    }
  }

  /**
   * Unregister a sound source (vehicle destroyed, sound stopped, etc.).
   */
  unregisterSource(id: number): void {
    this.registeredSources.delete(id);
    this.sourcePropagation.delete(id);
    this.sourcePropTarget.delete(id);
  }

  /**
   * Get all registered sources formatted for the worker trace request.
   */
  getSourcesForWorker(): { id: number; x: number; y: number; z: number }[] {
    const out: { id: number; x: number; y: number; z: number }[] = [];
    for (const [id, pos] of this.registeredSources) {
      out.push({ id, x: pos.x, y: pos.y, z: pos.z });
    }
    return out;
  }

  /**
   * Get the smoothed propagation data for a source.
   * Returns null if the source hasn't been traced yet.
   */
  getSourcePropagation(id: number): SourcePropagation | null {
    return this.sourcePropagation.get(id) ?? null;
  }

  // ── Worker result handling ──

  /**
   * Called when the worker sends a new result.
   * Converts raw ray data into target acoustic parameters.
   */
  onWorkerResult(result: RayTraceResult): void {
    this.lastResult = result;

    // ── Map ray data to acoustic parameters ──

    const clampedBounce = Math.max(1, Math.min(50, result.avgBounceDistance));
    this.target.reverbDelay = Math.min(0.08, (clampedBounce * 2) / 343);
    this.target.reverbDecay = 0.15 + clampedBounce * 0.03;

    const sizeScale = Math.min(1, clampedBounce / 25);
    this.target.reverbWet = result.returnRatio * (0.08 + sizeScale * 0.14);
    this.target.indoorFactor = 1 - result.outdoorRatio;
    this.target.ready = true;

    // ── Store per-source propagation targets ──
    if (result.sources) {
      for (const sp of result.sources) {
        this.sourcePropTarget.set(sp.id, sp);

        // Initialize the smoothed value if this is the first result for this source
        if (!this.sourcePropagation.has(sp.id)) {
          this.sourcePropagation.set(sp.id, {
            apparentDirX: sp.apparentDirX,
            apparentDirY: sp.apparentDirY,
            apparentDirZ: sp.apparentDirZ,
            occlusion: sp.occlusion,
            directLOS: sp.directLOS,
          });
        }
      }
    }
  }

  /**
   * Called every frame to smoothly interpolate toward target values.
   * @param delta Frame delta time in seconds.
   */
  update(delta: number): void {
    if (!this.target.ready) return;

    // ── Global environment ──
    const t = Math.min(1, LERP_SPEED * delta);
    this.current.reverbDelay += (this.target.reverbDelay - this.current.reverbDelay) * t;
    this.current.reverbDecay += (this.target.reverbDecay - this.current.reverbDecay) * t;
    this.current.reverbWet += (this.target.reverbWet - this.current.reverbWet) * t;
    this.current.indoorFactor += (this.target.indoorFactor - this.current.indoorFactor) * t;
    this.current.ready = true;

    // ── Per-source propagation smoothing ──
    const dt = Math.min(1, DIR_LERP_SPEED * delta);
    const ot = Math.min(1, LERP_SPEED * delta); // occlusion smooths slower

    for (const [id, target] of this.sourcePropTarget) {
      const current = this.sourcePropagation.get(id);
      if (!current) continue;

      // Lerp apparent direction
      current.apparentDirX += (target.apparentDirX - current.apparentDirX) * dt;
      current.apparentDirY += (target.apparentDirY - current.apparentDirY) * dt;
      current.apparentDirZ += (target.apparentDirZ - current.apparentDirZ) * dt;

      // Re-normalize the direction after lerping (lerping unit vectors doesn't preserve length)
      const len = Math.sqrt(
        current.apparentDirX * current.apparentDirX +
        current.apparentDirY * current.apparentDirY +
        current.apparentDirZ * current.apparentDirZ,
      );
      if (len > 0.001) {
        current.apparentDirX /= len;
        current.apparentDirY /= len;
        current.apparentDirZ /= len;
      }

      // Lerp occlusion (slower for smoother transitions)
      current.occlusion += (target.occlusion - current.occlusion) * ot;

      // Direct LOS is a binary flag — use latest value
      current.directLOS = target.directLOS;
    }
  }

  /** Get the current smoothed acoustic environment. */
  getEnvironment(): Readonly<AcousticEnvironment> {
    return this.current;
  }

  /** Check if ray data has been received at least once. */
  isReady(): boolean {
    return this.current.ready;
  }

  /** Get the last raw result (for debugging / visualization). */
  getLastResult(): RayTraceResult | null {
    return this.lastResult;
  }

  /** Reset to defaults (e.g. on map change). */
  reset(): void {
    this.current = {
      reverbDelay: 0.03,
      reverbDecay: 0.5,
      reverbWet: 0.12,
      indoorFactor: 0.5,
      ready: false,
    };
    this.target = { ...this.current };
    this.lastResult = null;
    this.sourcePropagation.clear();
    this.sourcePropTarget.clear();
    // Don't clear registeredSources — they persist across map resets
  }
}
