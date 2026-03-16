/**
 * AudioRayState — main-thread store for ray-traced acoustic environment data.
 *
 * Receives results from the AudioRayTracer web worker and provides smoothly
 * interpolated acoustic parameters that AudioCore reads every frame:
 *
 *   - Room reverb parameters (delay, decay, volume)
 *   - Indoor/outdoor blend factor
 *   - Per-source occlusion (queried by position)
 *
 * Values are lerped between worker updates (~60ms intervals) to avoid
 * discontinuities in the audio graph.
 */

import type { Vec3Like } from './AudioCore';

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

/** Lerp smoothing speed — lower = smoother but laggier. */
const LERP_SPEED = 6;

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

  /**
   * Called when the worker sends a new result.
   * Converts raw ray data into target acoustic parameters.
   */
  onWorkerResult(result: RayTraceResult): void {
    this.lastResult = result;

    // ── Map ray data to acoustic parameters ──

    // Reverb delay: based on average bounce distance.
    // Close walls (2m) → ~0.006s, far walls (40m) → ~0.06s.
    // Speed of sound ≈ 343 m/s, round trip = 2 * dist / 343.
    const clampedBounce = Math.max(1, Math.min(50, result.avgBounceDistance));
    this.target.reverbDelay = Math.min(0.08, (clampedBounce * 2) / 343);

    // Reverb decay: larger rooms decay longer, more returning rays = stronger.
    // Sabine-ish approximation: decay ∝ room volume. We use bounce distance
    // as a proxy for room radius.
    this.target.reverbDecay = 0.15 + clampedBounce * 0.03;

    // Reverb wet: louder echo when more rays return (the garage effect).
    // Also scales with bounce distance (bigger room = louder reverb).
    const sizeScale = Math.min(1, clampedBounce / 25);
    this.target.reverbWet = result.returnRatio * (0.08 + sizeScale * 0.14);

    // Indoor factor: inverse of outdoor ratio with hysteresis.
    this.target.indoorFactor = 1 - result.outdoorRatio;

    this.target.ready = true;
  }

  /**
   * Called every frame to smoothly interpolate toward target values.
   * @param delta Frame delta time in seconds.
   */
  update(delta: number): void {
    if (!this.target.ready) return;

    const t = Math.min(1, LERP_SPEED * delta);
    this.current.reverbDelay += (this.target.reverbDelay - this.current.reverbDelay) * t;
    this.current.reverbDecay += (this.target.reverbDecay - this.current.reverbDecay) * t;
    this.current.reverbWet += (this.target.reverbWet - this.current.reverbWet) * t;
    this.current.indoorFactor += (this.target.indoorFactor - this.current.indoorFactor) * t;
    this.current.ready = true;
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
  }
}
