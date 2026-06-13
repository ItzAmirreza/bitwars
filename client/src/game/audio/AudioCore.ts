/**
 * AudioCore — base infrastructure for the procedural audio system.
 *
 * Provides:
 *   - AudioContext management with shared context support
 *   - Submix buses per category (weapon, combat, movement, vehicle, UI)
 *   - Dynamic reverb driven by ray-traced acoustic environment data
 *   - Spatial bus creation with HRTF panning and occlusion
 *   - Noise buffer pooling via NoisePool
 *   - Voice management via VoiceManager (polyphony, culling, stealing)
 *   - Automatic node cleanup for one-shot sounds
 *   - Listener pose and occlusion sampling
 */

import { NoisePool } from './NoisePool';
import { VoiceManager } from './VoiceManager';
import type { VoiceCategory } from './VoiceManager';
import { AudioRayState } from './AudioRayState';
import { SampleLibrary } from './SampleLibrary';
// AudioRayState types used by AudioSystem for worker result forwarding
export type { RayTraceResult } from './AudioRayState';

// ── Shared types ──

export type Vec3Like = { x: number; y: number; z: number };
export type OcclusionSampler = (x: number, y: number, z: number) => boolean;

export interface SpatialSoundOptions {
  position?: Vec3Like;
  direction?: Vec3Like;
  getPosition?: () => Vec3Like;
  getDirection?: () => Vec3Like;
}

/** Bus name for routing sounds through category submixes. */
export type AudioBusName = 'weapon' | 'combat' | 'movement' | 'vehicle' | 'ui';

export interface SpatialBusOptions {
  gain: number;
  minDistance: number;
  maxDistance: number;
  rolloff: number;
  directional?: Vec3Like;
  coneInner?: number;
  coneOuter?: number;
  coneOuterGain?: number;
  occlusionStrength?: number;
  baseLowpass?: number;
  reverbAmount?: number;
  /** Which submix bus to route through. Defaults to 'weapon'. */
  bus?: AudioBusName;
  /** Voice category for polyphony management. */
  voiceCategory?: VoiceCategory;
  /** Duration hint for voice tracking (seconds). */
  voiceDuration?: number;
}

/** Options for one-shot sample playback. */
export interface SamplePlayOptions {
  /** Linear gain multiplier (default 1). */
  gain?: number;
  /** Base playback rate / pitch (default 1). */
  rate?: number;
  /** Random pitch variation, fractional (e.g. 0.06 → rate ±6% per play). */
  pitchVary?: number;
  /** Random gain variation, fractional (e.g. 0.1 → gain ±10% per play). */
  gainVary?: number;
  /** Scheduling delay passed to resolveOutput (default 0). */
  maxDelay?: number;
}

/** Apply random ±fraction jitter to a base value (natural per-play variation). */
function jitter(base: number, vary: number | undefined): number {
  if (!vary) return base;
  return base * (1 + (Math.random() * 2 - 1) * vary);
}

/** Persistent audio state for a single helicopter's looping sound. */
export interface HeliSoundNodes {
  chopLfo: OscillatorNode;
  chopOutput: GainNode;
  engineOsc1: OscillatorNode;
  engineOsc2: OscillatorNode;
  engineGain: GainNode;
  tailOsc: OscillatorNode;
  tailGain: GainNode;
  windFilter: BiquadFilterNode;
  windGain: GainNode;
  mixGain: GainNode;
  outputFilter: BiquadFilterNode;
  panner: PannerNode;
  allSources: (AudioBufferSourceNode | OscillatorNode)[];
  wasLocal: boolean;
  stopping: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

// ── Legacy type helpers (Web Audio API compat) ──

type LegacyAudioListener = {
  positionX?: AudioParam;
  positionY?: AudioParam;
  positionZ?: AudioParam;
  forwardX?: AudioParam;
  forwardY?: AudioParam;
  forwardZ?: AudioParam;
  upX?: AudioParam;
  upY?: AudioParam;
  upZ?: AudioParam;
  setPosition?: (x: number, y: number, z: number) => void;
  setOrientation?: (
    x: number, y: number, z: number,
    upX: number, upY: number, upZ: number,
  ) => void;
};

type LegacyPanner = {
  positionX?: AudioParam;
  positionY?: AudioParam;
  positionZ?: AudioParam;
  orientationX?: AudioParam;
  orientationY?: AudioParam;
  orientationZ?: AudioParam;
  setPosition?: (x: number, y: number, z: number) => void;
  setOrientation?: (x: number, y: number, z: number) => void;
};

// ── Submix bus relative levels (linear gain values) ──
// These are mixed into the master bus. Weapons are loudest, movement quietest.

const BUS_LEVELS: Record<AudioBusName, number> = {
  weapon:   0.67, // -3.5 dB — already very present; make room for movement/combat
  combat:   0.79, // -2 dB
  vehicle:  0.63, // -4 dB
  ui:       0.56, // -5 dB — menu pad + softened UI cues read clearly
  movement: 0.50, // -6 dB — nearby-footstep clarity
};

/**
 * Build a gentle tanh soft-clip curve for the master saturator.
 * Rounds harsh transient peaks and adds pleasant even harmonics ("analog glue").
 * Normalized by tanh(drive) so unity input maps to unity output — perceived
 * loudness stays ~constant, so this warms the tone without slamming the limiter.
 * drive ~1 = barely audible, ~2-3 = warm, >4 = obvious distortion.
 */
function makeSaturationCurve(drive: number, n = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1; // -1..1
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

// ── Core class ──

export class AudioCore {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;

  /** Submix buses — one per category, all feeding master. */
  private buses: Record<AudioBusName, GainNode> | null = null;

  private compressor: DynamicsCompressorNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  /** Gentle tanh soft-clip — rounds harsh transients, adds warmth (master bus). */
  private saturator: WaveShaperNode | null = null;
  /** Gentle high-shelf cut — tames digital fizz/sibilance (master bus). */
  private highShelf: BiquadFilterNode | null = null;
  private occlusionSampler: OcclusionSampler | null = null;
  private listenerPos: Vec3Like = { x: 0, y: 0, z: 0 };
  private listenerForward: Vec3Like = { x: 0, y: 0, z: -1 };
  private listenerUp: Vec3Like = { x: 0, y: 1, z: 0 };

  /** Dynamic reverb node driven by ray-traced data. */
  private reverbSend: GainNode | null = null;
  private reverbDelay: DelayNode | null = null;
  private reverbFilter: BiquadFilterNode | null = null;
  private reverbDecayGain: GainNode | null = null;
  /** Second tap for wider reverb. */
  private reverbDelay2: DelayNode | null = null;
  private reverbFilter2: BiquadFilterNode | null = null;
  private reverbDecayGain2: GainNode | null = null;

  /** Noise buffer pool — shared across all sound modules. */
  readonly noisePool = new NoisePool();

  /** Voice manager — polyphony limiter. */
  readonly voices = new VoiceManager();

  /** Decoded audio sample library (real recorded/produced sounds). */
  readonly samples = new SampleLibrary();

  /** Ray-traced acoustic environment state. */
  readonly rayState = new AudioRayState();

  /**
   * Accept an external AudioContext (for sharing between menu and game).
   * If set before `ensure()` is called, that context will be used.
   */
  private externalCtx: AudioContext | null = null;

  setExternalContext(ctx: AudioContext): void {
    this.externalCtx = ctx;
  }

  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = this.externalCtx ?? new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;

      // ── Dynamics processing chain ──
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 6;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.15;

      // Brick-wall limiter
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.001;
      this.limiter.release.value = 0.05;

      // Gentle tanh saturator — rounds harsh transient peaks before the
      // compressor reacts, adding pleasant even harmonics ("analog glue").
      this.saturator = this.ctx.createWaveShaper();
      this.saturator.curve = makeSaturationCurve(2.2);
      this.saturator.oversample = '4x'; // avoid aliasing the added harmonics

      // Gentle high-shelf — tame digital fizz above 7 kHz without dulling the
      // 2-5 kHz presence band that carries weapon crack + intelligibility.
      this.highShelf = this.ctx.createBiquadFilter();
      this.highShelf.type = 'highshelf';
      this.highShelf.frequency.value = 7000;
      this.highShelf.gain.value = -3;

      // master → saturator → compressor → highShelf → limiter → destination
      this.master
        .connect(this.saturator)
        .connect(this.compressor)
        .connect(this.highShelf)
        .connect(this.limiter)
        .connect(this.ctx.destination);

      // ── Submix buses ──
      this.buses = {} as Record<AudioBusName, GainNode>;
      for (const name of Object.keys(BUS_LEVELS) as AudioBusName[]) {
        const bus = this.ctx.createGain();
        bus.gain.value = BUS_LEVELS[name];
        bus.connect(this.master);
        this.buses[name] = bus;
      }

      // ── Global dynamic reverb (driven by ray-traced data) ──
      this.setupDynamicReverb(this.ctx);

      // ── Init noise pool ──
      this.noisePool.init(this.ctx);

      // ── Preload audio samples (non-blocking; sounds fall back to procedural
      //    synth until their buffer is decoded) ──
      void this.samples.load(this.ctx);

      this.applyListenerToContext(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /**
   * Set up the global dynamic reverb effect.
   * Two delay taps with LP filters, mixed via a send bus.
   * Parameters are updated every frame from AudioRayState.
   */
  private setupDynamicReverb(ctx: AudioContext): void {
    const t = ctx.currentTime;

    // Reverb send bus — all spatial buses route a wet signal here
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.setValueAtTime(0.12, t);

    // Tap 1 (early reflection)
    this.reverbDelay = ctx.createDelay(0.2);
    this.reverbDelay.delayTime.setValueAtTime(0.03, t);
    this.reverbFilter = ctx.createBiquadFilter();
    this.reverbFilter.type = 'lowpass';
    this.reverbFilter.frequency.setValueAtTime(2200, t);
    this.reverbDecayGain = ctx.createGain();
    this.reverbDecayGain.gain.setValueAtTime(0.35, t);

    this.reverbSend
      .connect(this.reverbFilter)
      .connect(this.reverbDelay)
      .connect(this.reverbDecayGain)
      .connect(this.master!);

    // Tap 2 (late reflection — longer delay, more muffled)
    this.reverbDelay2 = ctx.createDelay(0.4);
    this.reverbDelay2.delayTime.setValueAtTime(0.07, t);
    this.reverbFilter2 = ctx.createBiquadFilter();
    this.reverbFilter2.type = 'lowpass';
    this.reverbFilter2.frequency.setValueAtTime(1200, t);
    this.reverbDecayGain2 = ctx.createGain();
    this.reverbDecayGain2.gain.setValueAtTime(0.18, t);

    this.reverbSend
      .connect(this.reverbFilter2)
      .connect(this.reverbDelay2)
      .connect(this.reverbDecayGain2)
      .connect(this.master!);
  }

  /**
   * Update dynamic reverb parameters from the latest ray-traced data.
   * Called every frame from AudioSystem.updateAcoustics().
   */
  updateReverbFromRayState(delta: number): void {
    // Step the ray state interpolation
    this.rayState.update(delta);

    if (!this.ctx || !this.rayState.isReady()) return;
    const env = this.rayState.getEnvironment();
    const t = this.ctx.currentTime;

    // Update reverb send level
    this.reverbSend?.gain.setTargetAtTime(env.reverbWet, t, 0.1);

    // Update tap 1 (early reflection)
    if (this.reverbDelay) {
      this.reverbDelay.delayTime.setTargetAtTime(
        Math.max(0.005, Math.min(0.15, env.reverbDelay)), t, 0.1,
      );
    }
    if (this.reverbFilter) {
      // Outdoors: brighter early reflections. Indoors: more muffled.
      const freq = 1400 + (1 - env.indoorFactor) * 1800;
      this.reverbFilter.frequency.setTargetAtTime(freq, t, 0.15);
    }
    if (this.reverbDecayGain) {
      // Scale with return ratio and room size
      const gain = Math.min(0.5, 0.2 + env.reverbWet * 1.5);
      this.reverbDecayGain.gain.setTargetAtTime(gain, t, 0.1);
    }

    // Update tap 2 (late reflection)
    if (this.reverbDelay2) {
      this.reverbDelay2.delayTime.setTargetAtTime(
        Math.max(0.02, Math.min(0.35, env.reverbDelay * 2.5)), t, 0.1,
      );
    }
    if (this.reverbFilter2) {
      // Late reflections always more muffled
      const freq2 = 600 + (1 - env.indoorFactor) * 800;
      this.reverbFilter2.frequency.setTargetAtTime(freq2, t, 0.15);
    }
    if (this.reverbDecayGain2) {
      // Late reflections quieter, scale with indoor factor
      const gain2 = Math.min(0.35, 0.08 + env.indoorFactor * 0.2);
      this.reverbDecayGain2.gain.setTargetAtTime(gain2, t, 0.1);
    }
  }

  /** Get the output node for a submix bus, or master as fallback. */
  getBus(name: AudioBusName): GainNode {
    this.ensure();
    return this.buses?.[name] ?? this.master!;
  }

  /** Get the reverb send node (for spatial buses to route wet signal to). */
  getReverbSend(): GainNode | null {
    return this.reverbSend;
  }

  // ── Listener management ──

  private applyListenerToContext(ctx: AudioContext): void {
    const listener = ctx.listener;
    const l = listener as unknown as LegacyAudioListener;
    const t = ctx.currentTime;
    if (
      l.positionX && l.positionY && l.positionZ
      && l.forwardX && l.forwardY && l.forwardZ
      && l.upX && l.upY && l.upZ
    ) {
      l.positionX.setValueAtTime(this.listenerPos.x, t);
      l.positionY.setValueAtTime(this.listenerPos.y, t);
      l.positionZ.setValueAtTime(this.listenerPos.z, t);
      l.forwardX.setValueAtTime(this.listenerForward.x, t);
      l.forwardY.setValueAtTime(this.listenerForward.y, t);
      l.forwardZ.setValueAtTime(this.listenerForward.z, t);
      l.upX.setValueAtTime(this.listenerUp.x, t);
      l.upY.setValueAtTime(this.listenerUp.y, t);
      l.upZ.setValueAtTime(this.listenerUp.z, t);
      return;
    }

    if (l.setPosition && l.setOrientation) {
      l.setPosition(this.listenerPos.x, this.listenerPos.y, this.listenerPos.z);
      l.setOrientation(
        this.listenerForward.x, this.listenerForward.y, this.listenerForward.z,
        this.listenerUp.x, this.listenerUp.y, this.listenerUp.z,
      );
    }
  }

  // ── Utility helpers ──

  clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }

  normalize(v: Vec3Like): Vec3Like {
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-5) return { x: 0, y: 0, z: -1 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  distance(a: Vec3Like, b: Vec3Like): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  getListenerPos(): Vec3Like {
    return this.listenerPos;
  }

  setListenerPose(position: Vec3Like, forward?: Vec3Like, up?: Vec3Like): void {
    this.listenerPos = { x: position.x, y: position.y, z: position.z };
    if (forward) this.listenerForward = this.normalize(forward);
    if (up) this.listenerUp = this.normalize(up);
    if (!this.ctx) return;
    this.applyListenerToContext(this.ctx);
  }

  setOcclusionSampler(sampler: OcclusionSampler | null): void {
    this.occlusionSampler = sampler;
  }

  setPannerPosition(panner: PannerNode, pos: Vec3Like, t: number): void {
    const p = panner as unknown as LegacyPanner;
    if (p.positionX && p.positionY && p.positionZ) {
      p.positionX.setValueAtTime(pos.x, t);
      p.positionY.setValueAtTime(pos.y, t);
      p.positionZ.setValueAtTime(pos.z, t);
      return;
    }
    p.setPosition?.(pos.x, pos.y, pos.z);
  }

  private setPannerOrientation(panner: PannerNode, dir: Vec3Like, t: number): void {
    const p = panner as unknown as LegacyPanner;
    const d = this.normalize(dir);
    if (p.orientationX && p.orientationY && p.orientationZ) {
      p.orientationX.setValueAtTime(d.x, t);
      p.orientationY.setValueAtTime(d.y, t);
      p.orientationZ.setValueAtTime(d.z, t);
      return;
    }
    p.setOrientation?.(d.x, d.y, d.z);
  }

  // ── Occlusion ──

  computeOcclusion(source: Vec3Like): number {
    if (!this.occlusionSampler) return 0;

    const dist = this.distance(source, this.listenerPos);
    if (dist < 1.2) return 0;

    const rayOffsets: Vec3Like[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0.28, y: 0, z: 0 },
      { x: -0.28, y: 0, z: 0 },
      { x: 0, y: 0.24, z: 0 },
      { x: 0, y: -0.24, z: 0 },
    ];

    let blockedRays = 0;
    const sampler = this.occlusionSampler;
    for (const off of rayOffsets) {
      const sx = source.x + off.x;
      const sy = source.y + off.y;
      const sz = source.z + off.z;
      const tx = this.listenerPos.x + off.x * 0.4;
      const ty = this.listenerPos.y + off.y * 0.4;
      const tz = this.listenerPos.z + off.z * 0.4;

      const dx = tx - sx;
      const dy = ty - sy;
      const dz = tz - sz;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.001) continue;

      const steps = Math.min(96, Math.max(3, Math.ceil(len / 0.85)));
      let hit = false;
      for (let i = 1; i < steps; i++) {
        const tt = i / steps;
        const px = sx + dx * tt;
        const py = sy + dy * tt;
        const pz = sz + dz * tt;
        if (sampler(Math.floor(px), Math.floor(py), Math.floor(pz))) {
          hit = true;
          break;
        }
      }
      if (hit) blockedRays++;
    }

    const blockedRatio = blockedRays / rayOffsets.length;
    const distWeight = this.clamp((dist - 1.5) / 10, 0, 1);
    return this.clamp(blockedRatio * (0.45 + distWeight * 0.55), 0, 1);
  }

  // ── Spatial bus creation (with node cleanup + reverb send + bus routing) ──

  createSpatialBus(position: Vec3Like, options: SpatialBusOptions): {
    ctx: AudioContext;
    t: number;
    input: GainNode;
    dist: number;
    occlusion: number;
  } {
    const ctx = this.ensure();
    const t = ctx.currentTime;
    const dist = this.distance(position, this.listenerPos);
    const occlusion = this.computeOcclusion(position);
    const occlusionStrength = options.occlusionStrength ?? 1;

    const input = ctx.createGain();
    input.gain.value = options.gain;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const baseLowpass = options.baseLowpass ?? 18000;
    const lowpassHz = Math.max(240, baseLowpass * (1 - occlusion * 0.82 * occlusionStrength));
    lp.frequency.setValueAtTime(lowpassHz, t);

    const dryGain = ctx.createGain();
    const dry = this.clamp(1 - occlusion * 0.62 * occlusionStrength, 0.06, 1);
    dryGain.gain.setValueAtTime(dry, t);

    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = options.minDistance;
    panner.maxDistance = options.maxDistance;
    panner.rolloffFactor = options.rolloff;
    panner.coneInnerAngle = options.coneInner ?? 360;
    panner.coneOuterAngle = options.coneOuter ?? 360;
    panner.coneOuterGain = options.coneOuterGain ?? 0.25;
    this.setPannerPosition(panner, position, t);
    if (options.directional) {
      this.setPannerOrientation(panner, options.directional, t);
    }

    // Route through the appropriate submix bus
    const busName = options.bus ?? 'weapon';
    const busNode = this.getBus(busName);
    input.connect(lp).connect(dryGain).connect(panner).connect(busNode);

    // ── Dynamic reverb send ──
    // Route a portion of the signal to the global reverb (bypassing panner
    // so reverb is diffuse/non-directional, which is physically correct).
    const reverbAmount = options.reverbAmount ?? 0;
    if (reverbAmount > 0.001 && this.reverbSend) {
      const env = this.rayState.getEnvironment();
      // Scale reverb send by the ray-traced environment + per-sound amount
      const envScale = env.ready ? (0.4 + env.indoorFactor * 0.6) : 0.5;
      const sendLevel = reverbAmount * envScale * (0.3 + 0.7 * occlusion);
      const sendGain = ctx.createGain();
      sendGain.gain.setValueAtTime(this.clamp(sendLevel, 0, 0.5), t);
      input.connect(sendGain).connect(this.reverbSend);

      // Schedule cleanup for the send gain node too
      this.scheduleNodeCleanup(sendGain, options.voiceDuration ?? 1.0);
    }

    // ── Schedule node cleanup ──
    // Disconnect intermediate nodes after the sound finishes to prevent
    // orphaned nodes from accumulating in the audio graph.
    const duration = options.voiceDuration ?? 1.0;
    this.scheduleNodeCleanup(input, duration);
    this.scheduleNodeCleanup(lp, duration);
    this.scheduleNodeCleanup(dryGain, duration);
    this.scheduleNodeCleanup(panner, duration);

    return { ctx, t, input, dist, occlusion };
  }

  /**
   * Schedule a node to be disconnected after a sound finishes.
   * Adds a small buffer (200ms) to account for reverb tails.
   */
  private scheduleNodeCleanup(node: AudioNode, durationSec: number): void {
    setTimeout(() => {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }, (durationSec + 0.2) * 1000);
  }

  resolveOutput(
    spatial: SpatialSoundOptions | undefined,
    busOptions: SpatialBusOptions,
    maxDelay = 0,
  ): {
    ctx: AudioContext;
    t: number;
    out: AudioNode;
    delay: number;
  } | null {
    const position = spatial?.getPosition?.() ?? spatial?.position;
    if (position) {
      const dist = this.distance(position, this.listenerPos);

      // ── Voice management: distance cull + polyphony ──
      const category = busOptions.voiceCategory;
      if (category) {
        if (!this.voices.requestVoice(category, dist, this.listenerPos, position)) {
          return null; // culled or couldn't steal
        }
      }

      const direction = spatial?.getDirection?.() ?? spatial?.direction;
      const bus = this.createSpatialBus(position, {
        ...busOptions,
        directional: direction ?? busOptions.directional,
      });
      const delay = maxDelay > 0 ? this.clamp(bus.dist / 95, 0, maxDelay) : 0;

      // Register voice for tracking
      if (category) {
        this.voices.registerVoice(
          category,
          dist,
          busOptions.voiceDuration ?? 0.5,
          [bus.input], // disconnect input to silence entire bus chain
        );
      }

      return { ctx: bus.ctx, t: bus.t, out: bus.input, delay };
    }

    // Non-spatial (UI sounds, hit marker, etc.)
    const ctx = this.ensure();
    const busName = busOptions.bus ?? 'ui';
    return { ctx, t: ctx.currentTime, out: this.getBus(busName), delay: 0 };
  }

  scheduleSpatialLayer(
    spatial: SpatialSoundOptions | undefined,
    busOptions: SpatialBusOptions,
    maxDelay: number,
    eventDelaySec: number,
    emit: (ctx: AudioContext, t: number, out: AudioNode) => void,
  ): void {
    const trigger = (): void => {
      const result = this.resolveOutput(spatial, busOptions, maxDelay);
      if (!result) return; // voice was culled
      emit(result.ctx, result.t + result.delay, result.out);
    };
    if (eventDelaySec <= 0) {
      trigger();
    } else {
      window.setTimeout(trigger, eventDelaySec * 1000);
    }
  }

  // ── Sample playback ──

  /**
   * Play a decoded sample spatially through the full panner/bus/reverb/occlusion
   * chain. Returns `true` if a sample existed (played or culled), `false` if no
   * sample is loaded for `name` — callers use that to fall back to procedural synth.
   * voiceDuration is widened to the sample length so the spatial nodes aren't
   * disconnected mid-playback.
   */
  playSample(
    name: string,
    spatial: SpatialSoundOptions | undefined,
    busOptions: SpatialBusOptions,
    opts?: SamplePlayOptions,
  ): boolean {
    const buf = this.samples.get(name);
    if (!buf) return false;
    const rate = jitter(opts?.rate ?? 1, opts?.pitchVary);
    const gain = jitter(opts?.gain ?? 1, opts?.gainVary);
    const playDur = buf.duration / rate;
    const bo: SpatialBusOptions = {
      ...busOptions,
      voiceDuration: Math.max(busOptions.voiceDuration ?? 0, playDur),
    };
    const result = this.resolveOutput(spatial, bo, opts?.maxDelay ?? 0);
    if (!result) return true; // sample exists but voice was culled — don't fall back
    const { ctx, t, out, delay } = result;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start(t + delay);
    src.stop(t + delay + playDur + 0.05);
    this.scheduleNodeCleanup(g, playDur + 0.1);
    return true;
  }

  /**
   * Play a decoded sample non-spatially straight to a submix bus (UI, music cues).
   * Returns `true` if a sample existed, `false` otherwise (procedural fallback).
   */
  playSampleOnBus(name: string, busName: AudioBusName, opts?: SamplePlayOptions): boolean {
    const buf = this.samples.get(name);
    if (!buf) return false;
    const ctx = this.ensure();
    const rate = jitter(opts?.rate ?? 1, opts?.pitchVary);
    const gain = jitter(opts?.gain ?? 1, opts?.gainVary);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.getBus(busName));
    src.start(t);
    src.stop(t + buf.duration / rate + 0.05);
    this.scheduleNodeCleanup(g, buf.duration / rate + 0.1);
    return true;
  }

  // ── Noise buffer (delegates to pool) ──

  noise(duration: number, decay: number): AudioBuffer {
    const ctx = this.ensure();
    return this.noisePool.get(ctx, duration, decay);
  }

  click(ctx: AudioContext, out: AudioNode, time: number, freq: number, dur: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(freq * 3, 8000);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(lp).connect(g).connect(out);
    osc.start(time);
    osc.stop(time + dur + 0.005);

    // Cleanup intermediate nodes
    this.scheduleNodeCleanup(lp, dur + 0.05);
    this.scheduleNodeCleanup(g, dur + 0.05);
  }

  setMasterVolume(volume: number): void {
    if (this.master && this.ctx) {
      const v = Math.max(0, Math.min(1, volume));
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }

  suspend(): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  dispose(): void {
    this.voices.dispose();
    this.noisePool.dispose();
    this.samples.dispose();
    this.rayState.reset();

    if (this.ctx) {
      // Only close if we own it (not external)
      if (!this.externalCtx) {
        this.ctx.close();
      }
      this.ctx = null;
      this.master = null;
      this.buses = null;
      this.compressor = null;
      this.limiter = null;
      this.saturator = null;
      this.highShelf = null;
      this.reverbSend = null;
      this.reverbDelay = null;
      this.reverbFilter = null;
      this.reverbDecayGain = null;
      this.reverbDelay2 = null;
      this.reverbFilter2 = null;
      this.reverbDecayGain2 = null;
    }
  }
}
