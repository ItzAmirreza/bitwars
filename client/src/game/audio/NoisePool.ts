/**
 * NoisePool — pre-allocated pool of noise AudioBuffers with round-robin reuse.
 *
 * Instead of allocating a fresh AudioBuffer for every one-shot sound (rifle,
 * explosion, footstep, etc.), we create a fixed set of buffers at different
 * durations and reuse them. This eliminates per-sound GC pressure.
 *
 * Buffers are pure white noise with exponential decay baked in at creation
 * time.  Because each buffer has a fixed duration/decay, callers pick the
 * closest match from the pool via `get(duration, decay)`.
 */

/** A single pre-allocated noise buffer entry. */
interface PoolEntry {
  buffer: AudioBuffer;
  duration: number;
  decay: number;
}

/** Bucket of entries sharing the same (duration, decay) template. */
interface PoolBucket {
  entries: PoolEntry[];
  nextIndex: number;
}

/**
 * The pool stores multiple copies per template so concurrent sounds using the
 * same duration/decay don't need to share a single AudioBuffer instance.
 * (AudioBufferSourceNode is fine with shared buffers, but we keep a small
 * number of copies to avoid any subtle scheduling edge-cases.)
 */
const COPIES_PER_TEMPLATE = 3;

/**
 * Templates define the (duration, decay) pairs we pre-create.
 * These cover every `core.noise(dur, decay)` call across the codebase.
 * If a request doesn't exactly match, the closest template is used —
 * the audible difference is negligible for noise buffers.
 */
const TEMPLATES: ReadonlyArray<{ duration: number; decay: number }> = [
  // Very short — transients, cracks, clicks
  { duration: 0.02, decay: 0.05 },
  { duration: 0.025, decay: 0.15 },
  { duration: 0.03, decay: 0.15 },
  { duration: 0.04, decay: 0.1 },
  { duration: 0.04, decay: 0.18 },
  { duration: 0.04, decay: 0.4 },
  { duration: 0.05, decay: 0.1 },
  { duration: 0.06, decay: 0.2 },
  { duration: 0.06, decay: 0.25 },
  { duration: 0.07, decay: 0.25 },
  // Short — footsteps, scuffs, block breaks
  { duration: 0.08, decay: 0.12 },
  { duration: 0.1, decay: 0.12 },
  { duration: 0.1, decay: 0.2 },
  { duration: 0.15, decay: 0.2 },
  { duration: 0.15, decay: 0.25 },
  { duration: 0.15, decay: 0.3 },
  { duration: 0.18, decay: 0.2 },
  // Medium — weapon shots, impacts
  { duration: 0.25, decay: 0.15 },
  { duration: 0.25, decay: 0.25 },
  { duration: 0.25, decay: 0.35 },
  { duration: 0.28, decay: 0.1 },
  { duration: 0.3, decay: 0.12 },
  { duration: 0.3, decay: 0.22 },
  { duration: 0.3, decay: 0.25 },
  { duration: 0.3, decay: 0.35 },
  { duration: 0.35, decay: 0.25 },
  // Long — explosions, rumbles, slides
  { duration: 0.4, decay: 0.22 },
  { duration: 0.5, decay: 0.18 },
  { duration: 0.5, decay: 0.25 },
  { duration: 0.6, decay: 0.18 },
];

export class NoisePool {
  private buckets: PoolBucket[] = [];
  private templateKeys: { duration: number; decay: number }[] = [];
  private initialized = false;

  /**
   * Lazily create all buffers on first use. We need a live AudioContext to
   * know the sample rate, so this can't happen at module load time.
   */
  init(ctx: AudioContext): void {
    if (this.initialized) return;
    this.initialized = true;

    const sr = ctx.sampleRate;
    for (const tmpl of TEMPLATES) {
      const entries: PoolEntry[] = [];
      for (let c = 0; c < COPIES_PER_TEMPLATE; c++) {
        const len = Math.max(1, Math.floor(sr * tmpl.duration));
        const buf = ctx.createBuffer(1, len, sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * tmpl.decay));
        }
        entries.push({ buffer: buf, duration: tmpl.duration, decay: tmpl.decay });
      }
      this.buckets.push({ entries, nextIndex: 0 });
      this.templateKeys.push({ duration: tmpl.duration, decay: tmpl.decay });
    }
  }

  /**
   * Get a noise buffer closest to the requested (duration, decay).
   * Returns the AudioBuffer directly. Round-robins through copies.
   */
  get(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
    this.init(ctx);

    // Find the closest template by combined distance metric.
    // Duration matters more than decay for audible difference.
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.templateKeys.length; i++) {
      const t = this.templateKeys[i];
      const dd = (t.duration - duration) * 10; // weight duration 10x
      const dc = t.decay - decay;
      const dist = dd * dd + dc * dc;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    const bucket = this.buckets[bestIdx];
    const entry = bucket.entries[bucket.nextIndex];
    bucket.nextIndex = (bucket.nextIndex + 1) % bucket.entries.length;
    return entry.buffer;
  }

  /** Release all buffers (called on AudioSystem dispose). */
  dispose(): void {
    this.buckets = [];
    this.templateKeys = [];
    this.initialized = false;
  }
}
