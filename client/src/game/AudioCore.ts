/**
 * AudioCore — base class with all audio infrastructure.
 * Provides AudioContext management, spatial audio bus creation,
 * occlusion computation, and utility methods.
 *
 * Sub-modules receive the core instance and call its public/protected methods.
 */

export type Vec3Like = { x: number; y: number; z: number };
export type OcclusionSampler = (x: number, y: number, z: number) => boolean;

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
    x: number,
    y: number,
    z: number,
    upX: number,
    upY: number,
    upZ: number,
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
}

export interface SpatialSoundOptions {
  position?: Vec3Like;
  direction?: Vec3Like;
  getPosition?: () => Vec3Like;
  getDirection?: () => Vec3Like;
}

/** Persistent audio state for a single helicopter's looping sound. */
export interface HeliSoundNodes {
  // Nodes that need per-frame parameter updates
  chopLfo: OscillatorNode;        // frequency = blade-pass rate
  chopOutput: GainNode;           // layer volume
  engineOsc1: OscillatorNode;     // engine fundamental
  engineOsc2: OscillatorNode;     // engine detuned harmonic
  engineGain: GainNode;           // layer volume
  tailOsc: OscillatorNode;        // tail rotor frequency
  tailGain: GainNode;             // layer volume
  windFilter: BiquadFilterNode;   // wind band center shifts with speed
  windGain: GainNode;             // wind layer volume (speed-dependent)
  mixGain: GainNode;              // overall mix volume
  outputFilter: BiquadFilterNode; // lowpass cutoff (cockpit muffling vs open air)
  panner: PannerNode;             // spatial position
  // Cleanup
  allSources: (AudioBufferSourceNode | OscillatorNode)[];
  // State tracking
  wasLocal: boolean;
  stopping: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

export class AudioCore {
  /** @internal — exposed for sub-module access */
  ctx: AudioContext | null = null;
  /** @internal — exposed for sub-module access */
  master: GainNode | null = null;
  protected compressor: DynamicsCompressorNode | null = null;
  protected limiter: DynamicsCompressorNode | null = null;
  /** @internal — exposed for sub-module access */
  stepIndex = 0; // alternates left/right foot
  protected occlusionSampler: OcclusionSampler | null = null;
  listenerPos: Vec3Like = { x: 0, y: 0, z: 0 };
  protected listenerForward: Vec3Like = { x: 0, y: 0, z: -1 };
  protected listenerUp: Vec3Like = { x: 0, y: 1, z: 0 };
  /** @internal — exposed for sub-module access */
  helicopterNoiseBuffer: AudioBuffer | null = null;
  /** @internal — exposed for sub-module access */
  heliSounds = new Map<number, HeliSoundNodes>();

  // Ambient state
  /** @internal — exposed for sub-module access */
  ambientOsc: OscillatorNode | null = null;
  /** @internal — exposed for sub-module access */
  ambientGain: GainNode | null = null;
  /** @internal — exposed for sub-module access */
  ambientLfo: OscillatorNode | null = null;

  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;

      // ── Dynamics processing chain ──
      // Compressor: tames overlapping sounds (gunfire + explosion + heli)
      // so they don't stack into hard clipping.
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;  // start compressing at -12 dB
      this.compressor.knee.value = 10;        // soft onset for transparency
      this.compressor.ratio.value = 6;        // moderate squeeze
      this.compressor.attack.value = 0.003;   // 3 ms — catches transients
      this.compressor.release.value = 0.15;   // 150 ms — smooth recovery

      // Brick-wall limiter: absolute safety net at -1 dB.
      // Catches anything the compressor missed so the DAC never clips.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.001;
      this.limiter.release.value = 0.05;

      this.master
        .connect(this.compressor)
        .connect(this.limiter)
        .connect(this.ctx.destination);
      this.applyListenerToContext(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  protected applyListenerToContext(ctx: AudioContext): void {
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
        this.listenerForward.x,
        this.listenerForward.y,
        this.listenerForward.z,
        this.listenerUp.x,
        this.listenerUp.y,
        this.listenerUp.z,
      );
    }
  }

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

  setPannerOrientation(panner: PannerNode, dir: Vec3Like, t: number): void {
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

    input.connect(lp).connect(dryGain).connect(panner).connect(this.master!);

    const reverbAmount = options.reverbAmount ?? 0;
    if (reverbAmount > 0.001) {
      const far = this.clamp(dist / Math.max(1, options.maxDistance), 0, 1);
      const tail = reverbAmount * (0.35 + 0.65 * far) * (0.25 + 0.75 * occlusion);
      const tapDelays = [0.05, 0.1, 0.16];
      for (let i = 0; i < tapDelays.length; i++) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400 - i * 300, t);

        const delay = ctx.createDelay(0.4);
        delay.delayTime.setValueAtTime(tapDelays[i] + occlusion * 0.03, t);

        const g = ctx.createGain();
        g.gain.setValueAtTime(tail * (0.38 / (i + 1)), t);

        input.connect(filter).connect(delay).connect(g).connect(this.master!);
      }
    }

    return { ctx, t, input, dist, occlusion };
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
  } {
    const position = spatial?.getPosition?.() ?? spatial?.position;
    if (position) {
      const direction = spatial?.getDirection?.() ?? spatial?.direction;
      const bus = this.createSpatialBus(position, {
        ...busOptions,
        directional: direction ?? busOptions.directional,
      });
      const delay = maxDelay > 0 ? this.clamp(bus.dist / 95, 0, maxDelay) : 0;
      return { ctx: bus.ctx, t: bus.t, out: bus.input, delay };
    }

    const ctx = this.ensure();
    return { ctx, t: ctx.currentTime, out: this.master!, delay: 0 };
  }

  scheduleSpatialLayer(
    spatial: SpatialSoundOptions | undefined,
    busOptions: SpatialBusOptions,
    maxDelay: number,
    eventDelaySec: number,
    emit: (ctx: AudioContext, t: number, out: AudioNode) => void,
  ): void {
    const trigger = (): void => {
      const { ctx, t, out, delay } = this.resolveOutput(spatial, busOptions, maxDelay);
      emit(ctx, t + delay, out);
    };
    if (eventDelaySec <= 0) {
      trigger();
    } else {
      window.setTimeout(trigger, eventDelaySec * 1000);
    }
  }

  noise(duration: number, decay: number): AudioBuffer {
    const ctx = this.ensure();
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * decay));
    }
    return buf;
  }

  setMasterVolume(volume: number): void {
    if (this.master && this.ctx) {
      const v = Math.max(0, Math.min(1, volume));
      // Smooth ramp avoids clicks from abrupt gain changes
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }

  dispose(): void {
    // Stop all helicopter sounds immediately
    for (const id of Array.from(this.heliSounds.keys())) {
      const nodes = this.heliSounds.get(id);
      if (nodes?.stopTimer) clearTimeout(nodes.stopTimer);
      this.cleanupHeliSound(id);
    }
    this.heliSounds.clear();
    this.helicopterNoiseBuffer = null;
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.master = null;
      this.compressor = null;
      this.limiter = null;
    }
  }

  cleanupHeliSound(id: number): void {
    const nodes = this.heliSounds.get(id);
    if (!nodes) return;
    for (const src of nodes.allSources) {
      try { src.stop(); } catch { /* already stopped */ }
      src.disconnect();
    }
    nodes.mixGain.disconnect();
    nodes.outputFilter.disconnect();
    nodes.panner.disconnect();
    this.heliSounds.delete(id);
  }
}
