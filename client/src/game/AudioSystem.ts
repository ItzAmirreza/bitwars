/**
 * Procedural audio system using Web Audio API.
 * All sounds are generated in real-time — zero file dependencies.
 */

type Vec3Like = { x: number; y: number; z: number };
type OcclusionSampler = (x: number, y: number, z: number) => boolean;
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

interface SpatialBusOptions {
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

interface SpatialSoundOptions {
  position?: Vec3Like;
  direction?: Vec3Like;
  getPosition?: () => Vec3Like;
  getDirection?: () => Vec3Like;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private stepIndex = 0; // alternates left/right foot
  private occlusionSampler: OcclusionSampler | null = null;
  private listenerPos: Vec3Like = { x: 0, y: 0, z: 0 };
  private listenerForward: Vec3Like = { x: 0, y: 0, z: -1 };
  private listenerUp: Vec3Like = { x: 0, y: 1, z: 0 };

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      this.applyListenerToContext(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

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
        this.listenerForward.x,
        this.listenerForward.y,
        this.listenerForward.z,
        this.listenerUp.x,
        this.listenerUp.y,
        this.listenerUp.z,
      );
    }
  }

  private clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
  }

  private normalize(v: Vec3Like): Vec3Like {
    const len = Math.hypot(v.x, v.y, v.z);
    if (len < 1e-5) return { x: 0, y: 0, z: -1 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  private distance(a: Vec3Like, b: Vec3Like): number {
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

  private setPannerPosition(panner: PannerNode, pos: Vec3Like, t: number): void {
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

  private computeOcclusion(source: Vec3Like): number {
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

  private createSpatialBus(position: Vec3Like, options: SpatialBusOptions): {
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

  private resolveOutput(
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

  private scheduleSpatialLayer(
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

  private noise(duration: number, decay: number): AudioBuffer {
    const ctx = this.ensure();
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * decay));
    }
    return buf;
  }

  // ── RIFLE: Sharp crack with metallic ring + punch ──
  playRifle(spatial?: SpatialSoundOptions): void {
    const busOptions: SpatialBusOptions = {
      gain: 1,
      minDistance: 2.4,
      maxDistance: 160,
      rolloff: 1.35,
      coneInner: 95,
      coneOuter: 230,
      coneOuterGain: 0.2,
      occlusionStrength: 0.9,
      baseLowpass: 14500,
      reverbAmount: 0.1,
    };
    const { ctx, t, out, delay } = this.resolveOutput(spatial, busOptions, 0.22);
    const t0 = t + delay;

    // Initial transient crack — wider bandwidth
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.1, 0.12);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500;
    bp.Q.value = 1.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);

    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.1);

    // Low-end punch for body
    const punch = ctx.createOscillator();
    punch.type = 'sine';
    punch.frequency.setValueAtTime(180, t0);
    punch.frequency.exponentialRampToValueAtTime(60, t0 + 0.05);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.25, t0);
    pg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    punch.connect(pg).connect(out);
    punch.start(t0);
    punch.stop(t0 + 0.05);

    // Metallic ping — brighter
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(4500, t0);
    osc.frequency.exponentialRampToValueAtTime(3000, t0 + 0.06);

    const og = ctx.createGain();
    og.gain.setValueAtTime(0.1, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);

    osc.connect(og).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.06);

    // Shell casing tinkle (delayed, tracks moving source)
    this.scheduleSpatialLayer(spatial, busOptions, 0.22, 0.08, (lateCtx, lateT, lateOut) => {
      const casing = lateCtx.createOscillator();
      casing.type = 'sine';
      casing.frequency.setValueAtTime(6000 + Math.random() * 1000, lateT);
      const cg = lateCtx.createGain();
      cg.gain.setValueAtTime(0.03, lateT);
      cg.gain.exponentialRampToValueAtTime(0.001, lateT + 0.04);
      casing.connect(cg).connect(lateOut);
      casing.start(lateT);
      casing.stop(lateT + 0.04);
    });
  }

  // ── SHOTGUN: Massive boom with pump-action feel ──
  playShotgun(spatial?: SpatialSoundOptions): void {
    const busOptions: SpatialBusOptions = {
      gain: 1,
      minDistance: 2.6,
      maxDistance: 170,
      rolloff: 1.25,
      coneInner: 85,
      coneOuter: 240,
      coneOuterGain: 0.18,
      occlusionStrength: 1,
      baseLowpass: 12500,
      reverbAmount: 0.14,
    };
    const { ctx, t, out, delay } = this.resolveOutput(spatial, busOptions, 0.24);
    const t0 = t + delay;

    // Heavy noise burst — wider bandwidth
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.28, 0.1);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.Q.value = 1.2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.75, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);

    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.28);

    // Sub thump — deeper and wider
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(100, t0);
    sub.frequency.exponentialRampToValueAtTime(20, t0 + 0.2);

    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.7, t0);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);

    sub.connect(sg).connect(out);
    sub.start(t0);
    sub.stop(t0 + 0.2);

    // High snap (mechanical action)
    const snap = ctx.createOscillator();
    snap.type = 'square';
    snap.frequency.value = 3500;
    const snapG = ctx.createGain();
    snapG.gain.setValueAtTime(0.12, t0);
    snapG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.025);
    snap.connect(snapG).connect(out);
    snap.start(t0);
    snap.stop(t0 + 0.025);

    // Mid-range body (the "whump")
    const body = ctx.createOscillator();
    body.type = 'sawtooth';
    body.frequency.setValueAtTime(250, t0);
    body.frequency.exponentialRampToValueAtTime(80, t0 + 0.08);
    const bodyLp = ctx.createBiquadFilter();
    bodyLp.type = 'lowpass';
    bodyLp.frequency.value = 500;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.3, t0);
    bg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    body.connect(bodyLp).connect(bg).connect(out);
    body.start(t0);
    body.stop(t0 + 0.08);

    // Pump-action rack (delayed, tracks moving source)
    this.scheduleSpatialLayer(spatial, busOptions, 0.24, 0.2, (lateCtx, lateT, lateOut) => {
      const rack = lateCtx.createBufferSource();
      rack.buffer = this.noise(0.06, 0.2);
      const rackBp = lateCtx.createBiquadFilter();
      rackBp.type = 'bandpass';
      rackBp.frequency.value = 2000;
      rackBp.Q.value = 2;
      const rg = lateCtx.createGain();
      rg.gain.setValueAtTime(0.1, lateT);
      rg.gain.exponentialRampToValueAtTime(0.001, lateT + 0.06);
      rack.connect(rackBp).connect(rg).connect(lateOut);
      rack.start(lateT);
      rack.stop(lateT + 0.06);
    });
  }

  // ── RPG: Whoosh launch + delayed boom ──
  playRPGLaunch(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out, delay } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 2.2,
        maxDistance: 140,
        rolloff: 1.2,
        coneInner: 55,
        coneOuter: 220,
        coneOuterGain: 0.1,
        occlusionStrength: 0.95,
        baseLowpass: 9000,
        reverbAmount: 0.12,
      },
      0.2,
    );
    const t0 = t + delay;

    // Whoosh
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.35);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;

    osc.connect(lp).connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.35);

    // Hiss
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.3, 0.25);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.15, t0);
    hg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    src.connect(hg).connect(out);
    src.start(t0);
    src.stop(t0 + 0.3);
  }

  // ── MACHINE GUN: Tight, bright chatter ──
  playMachineGun(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out, delay } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 2,
        maxDistance: 125,
        rolloff: 1.5,
        coneInner: 90,
        coneOuter: 220,
        coneOuterGain: 0.24,
        occlusionStrength: 0.85,
        baseLowpass: 13000,
        reverbAmount: 0.08,
      },
      0.16,
    );
    const t0 = t + delay;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.05, 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.05);

    const crack = ctx.createOscillator();
    crack.type = 'square';
    crack.frequency.setValueAtTime(1900, t0);
    crack.frequency.exponentialRampToValueAtTime(1200, t0 + 0.03);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.1, t0);
    cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.03);
    crack.connect(cg).connect(out);
    crack.start(t0);
    crack.stop(t0 + 0.03);
  }

  // ── GRENADE LAUNCHER: Heavy thunk + pressurized pop ──
  playGrenadeLaunch(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out, delay } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 2.2,
        maxDistance: 150,
        rolloff: 1.22,
        coneInner: 50,
        coneOuter: 220,
        coneOuterGain: 0.1,
        occlusionStrength: 0.95,
        baseLowpass: 9200,
        reverbAmount: 0.13,
      },
      0.2,
    );
    const t0 = t + delay;

    const thunk = ctx.createOscillator();
    thunk.type = 'sine';
    thunk.frequency.setValueAtTime(130, t0);
    thunk.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.42, t0);
    tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    thunk.connect(tg).connect(out);
    thunk.start(t0);
    thunk.stop(t0 + 0.12);

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise(0.18, 0.2);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1200;
    hp.Q.value = 0.9;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.16, t0);
    hg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    hiss.connect(hp).connect(hg).connect(out);
    hiss.start(t0);
    hiss.stop(t0 + 0.18);
  }

  // ── EXPLOSION: Massive boom ──
  playExplosion(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out, delay } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 3.5,
        maxDistance: 240,
        rolloff: 1.08,
        coneInner: 360,
        coneOuter: 360,
        coneOuterGain: 1,
        occlusionStrength: 1.2,
        baseLowpass: 9200,
        reverbAmount: 0.22,
      },
      0.35,
    );
    const t0 = t + delay;

    // Explosion noise
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.6, 0.18);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t0);
    lp.frequency.exponentialRampToValueAtTime(80, t0 + 0.6);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);

    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.6);

    // Deep sub
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(65, t0);
    sub.frequency.exponentialRampToValueAtTime(18, t0 + 0.5);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.8, t0);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    sub.connect(sg).connect(out);
    sub.start(t0);
    sub.stop(t0 + 0.5);

    // Crackle overtone
    const src2 = ctx.createBufferSource();
    src2.buffer = this.noise(0.3, 0.1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.25, t0);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    src2.connect(hp).connect(g2).connect(out);
    src2.start(t0);
    src2.stop(t0 + 0.3);

    // Reverb echo tail — delayed quieter explosion for distance feel
    const echo = ctx.createBufferSource();
    echo.buffer = this.noise(0.5, 0.25);
    const echoLp = ctx.createBiquadFilter();
    echoLp.type = 'lowpass';
    echoLp.frequency.setValueAtTime(400, t0 + 0.15);
    echoLp.frequency.exponentialRampToValueAtTime(60, t0 + 0.9);
    const echoG = ctx.createGain();
    echoG.gain.setValueAtTime(0, t0);
    echoG.gain.setValueAtTime(0.2, t0 + 0.15);
    echoG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    echo.connect(echoLp).connect(echoG).connect(out);
    echo.start(t0 + 0.15);
    echo.stop(t0 + 0.9);
  }

  // ── BLOCK BREAK: Short crumble ──
  playBlockBreak(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out, delay } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 1.4,
        maxDistance: 70,
        rolloff: 1.85,
        coneInner: 360,
        coneOuter: 360,
        coneOuterGain: 1,
        occlusionStrength: 0.75,
        baseLowpass: 12000,
        reverbAmount: 0.03,
      },
      0.12,
    );
    const t0 = t + delay;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.07, 0.25);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);

    src.connect(hp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.07);
  }

  // ── RELOAD: Mechanical click sequence ──
  playReload(spatial?: SpatialSoundOptions): void {
    const busOptions: SpatialBusOptions = {
      gain: 1,
      minDistance: 1.4,
      maxDistance: 65,
      rolloff: 1.8,
      coneInner: 120,
      coneOuter: 260,
      coneOuterGain: 0.22,
      occlusionStrength: 0.75,
      baseLowpass: 11000,
      reverbAmount: 0.04,
    };

    const emitClick = (offsetSec: number, freq: number, dur: number): void => {
      const trigger = () => {
        const { ctx, t, out, delay } = this.resolveOutput(spatial, busOptions, 0.08);
        this.click(ctx, out, t + delay, freq, dur);
      };
      if (offsetSec <= 0) {
        trigger();
      } else {
        window.setTimeout(trigger, offsetSec * 1000);
      }
    };

    emitClick(0, 1100, 0.035);   // mag release
    emitClick(0.25, 800, 0.04);  // mag out
    emitClick(0.45, 1400, 0.05); // mag in
    emitClick(0.6, 2200, 0.03);  // chamber rack
  }

  private click(ctx: AudioContext, out: AudioNode, time: number, freq: number, dur: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g).connect(out);
    osc.start(time);
    osc.stop(time + dur);
  }

  // ── EMPTY CLICK ──
  playEmpty(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 1.2,
        maxDistance: 45,
        rolloff: 2.2,
        coneInner: 110,
        coneOuter: 260,
        coneOuterGain: 0.2,
        occlusionStrength: 0.65,
        baseLowpass: 8500,
        reverbAmount: 0.02,
      },
      0.05,
    );

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 350;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  // ── HIT MARKER: Crispy satisfying ding ──
  playHitMarker(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    // Primary tone — sharp attack
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(1200, t);
    o1.frequency.setValueAtTime(1600, t + 0.02);

    // Harmonic overlay
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 2000;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    o1.connect(g).connect(this.master!);
    o2.connect(g);
    o1.start(t);
    o1.stop(t + 0.1);
    o2.start(t);
    o2.stop(t + 0.1);

    // Crispy noise transient for impact feel
    const crunch = ctx.createBufferSource();
    crunch.buffer = this.noise(0.03, 0.15);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.1, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    crunch.connect(hp).connect(cg).connect(this.master!);
    crunch.start(t);
    crunch.stop(t + 0.03);
  }

  // ── KILL CONFIRMED: Triumphant ascending tones ──
  playKillConfirm(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    // Three ascending tones for a satisfying "ding-ding-DING"
    const freqs = [880, 1175, 1760];
    const delays = [0, 0.06, 0.12];
    const vols = [0.15, 0.18, 0.25];

    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqs[i], t + delays[i]);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(vols[i], t + delays[i]);
      g.gain.exponentialRampToValueAtTime(0.001, t + delays[i] + 0.15);

      osc.connect(g).connect(this.master!);
      osc.start(t + delays[i]);
      osc.stop(t + delays[i] + 0.15);
    }

    // Bright shimmer overlay
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(2640, t + 0.12);
    shimmer.frequency.exponentialRampToValueAtTime(3520, t + 0.3);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.setValueAtTime(0.06, t + 0.12);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    shimmer.connect(sg).connect(this.master!);
    shimmer.start(t + 0.12);
    shimmer.stop(t + 0.35);
  }

  // ── DEATH: Dramatic descending thud ──
  playDeath(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 1.8,
        maxDistance: 120,
        rolloff: 1.35,
        coneInner: 360,
        coneOuter: 360,
        coneOuterGain: 1,
        occlusionStrength: 1,
        baseLowpass: 8600,
        reverbAmount: 0.08,
      },
      0.16,
    );

    // Deep descending tone
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.8);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 0.8);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.8);

    // Impact noise
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.3, 0.12);
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 300;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.6, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(lp2).connect(g2).connect(out);
    src.start(t);
    src.stop(t + 0.3);

    // Flatline beep (delayed)
    const beep = ctx.createOscillator();
    beep.type = 'sine';
    beep.frequency.value = 440;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.setValueAtTime(0.08, t + 0.4);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    beep.connect(bg).connect(out);
    beep.start(t + 0.4);
    beep.stop(t + 1.2);
  }

  // ── HEARTBEAT: Low bass pulse for critical health ──
  playHeartbeat(spatial?: SpatialSoundOptions): void {
    const busOptions: SpatialBusOptions = {
      gain: 1,
      minDistance: 1.2,
      maxDistance: 55,
      rolloff: 2,
      coneInner: 360,
      coneOuter: 360,
      coneOuterGain: 1,
      occlusionStrength: 0.9,
      baseLowpass: 3800,
      reverbAmount: 0.01,
    };
    const { ctx, t, out } = this.resolveOutput(spatial, busOptions, 0.05);

    // First beat (lub)
    const lub = ctx.createOscillator();
    lub.type = 'sine';
    lub.frequency.setValueAtTime(55, t);
    lub.frequency.exponentialRampToValueAtTime(30, t + 0.1);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0.35, t);
    lg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    lub.connect(lg).connect(out);
    lub.start(t);
    lub.stop(t + 0.12);

    // Second beat (dub) - slightly delayed, tracks source
    this.scheduleSpatialLayer(spatial, busOptions, 0.05, 0.15, (lateCtx, lateT, lateOut) => {
      const dub = lateCtx.createOscillator();
      dub.type = 'sine';
      dub.frequency.setValueAtTime(45, lateT);
      dub.frequency.exponentialRampToValueAtTime(25, lateT + 0.1);
      const dg = lateCtx.createGain();
      dg.gain.setValueAtTime(0.25, lateT);
      dg.gain.exponentialRampToValueAtTime(0.001, lateT + 0.12);
      dub.connect(dg).connect(lateOut);
      dub.start(lateT);
      dub.stop(lateT + 0.12);
    });

    // Subtle body resonance noise
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.15, 0.3);
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 120;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.08, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(bp).connect(ng).connect(out);
    src.start(t);
    src.stop(t + 0.15);
  }

  // ── RESPAWN: Rising ethereal sweep ──
  playRespawn(spatial?: SpatialSoundOptions): void {
    const busOptions: SpatialBusOptions = {
      gain: 1,
      minDistance: 1.8,
      maxDistance: 110,
      rolloff: 1.25,
      coneInner: 360,
      coneOuter: 360,
      coneOuterGain: 1,
      occlusionStrength: 0.9,
      baseLowpass: 12500,
      reverbAmount: 0.1,
    };
    const { ctx, t, out } = this.resolveOutput(spatial, busOptions, 0.15);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.5);

    // Harmonic overlay, tracks source
    this.scheduleSpatialLayer(spatial, busOptions, 0.15, 0.1, (lateCtx, lateT, lateOut) => {
      const osc2 = lateCtx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(330, lateT);
      osc2.frequency.exponentialRampToValueAtTime(1320, lateT + 0.35);
      const g2 = lateCtx.createGain();
      g2.gain.setValueAtTime(0.08, lateT);
      g2.gain.exponentialRampToValueAtTime(0.001, lateT + 0.4);
      osc2.connect(g2).connect(lateOut);
      osc2.start(lateT);
      osc2.stop(lateT + 0.4);
    });
  }

  // ── WEAPON SWITCH: Quick slide sound ──
  playSwitch(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 1.1,
        maxDistance: 50,
        rolloff: 2,
        coneInner: 120,
        coneOuter: 260,
        coneOuterGain: 0.25,
        occlusionStrength: 0.7,
        baseLowpass: 10000,
        reverbAmount: 0.03,
      },
      0.06,
    );

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.06);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;

    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  // ── DAMAGE TAKEN: Low impact thud ──
  playDamage(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 1.6,
        maxDistance: 75,
        rolloff: 1.7,
        coneInner: 360,
        coneOuter: 360,
        coneOuterGain: 1,
        occlusionStrength: 0.95,
        baseLowpass: 7000,
        reverbAmount: 0.05,
      },
      0.08,
    );

    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.15, 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.15);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 50;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.4, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 0.12);
  }

  // ── CRUMBLE: Blocks becoming unstable ──
  playCrumble(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out, delay } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 2.3,
        maxDistance: 130,
        rolloff: 1.3,
        coneInner: 360,
        coneOuter: 360,
        coneOuterGain: 1,
        occlusionStrength: 1.1,
        baseLowpass: 8500,
        reverbAmount: 0.1,
      },
      0.18,
    );
    const t0 = t + delay;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.25, 0.15);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.25);
  }

  // ── BLOCK LAND: Falling blocks hit ground ──
  playBlockLand(intensity: number = 0.5, spatial?: SpatialSoundOptions): void {
    const { ctx, t, out, delay } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 2,
        maxDistance: 110,
        rolloff: 1.45,
        coneInner: 360,
        coneOuter: 360,
        coneOuterGain: 1,
        occlusionStrength: 1,
        baseLowpass: 7200,
        reverbAmount: 0.08,
      },
      0.16,
    );
    const t0 = t + delay;
    const vol = 0.15 + intensity * 0.35;

    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.1, 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    src.connect(lp).connect(g).connect(out);
    src.start(t0);
    src.stop(t0 + 0.1);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 40;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(vol * 0.8, t0);
    sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    sub.connect(sg).connect(out);
    sub.start(t0);
    sub.stop(t0 + 0.08);
  }

  // ── FOOTSTEP: Layered boot-on-stone with impact, surface texture, and transient ──
  playStep(sprinting = false, spatial?: SpatialSoundOptions): void {
    const { ctx, t, out } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 1.5,
        maxDistance: 70,
        rolloff: 1.9,
        coneInner: 360,
        coneOuter: 360,
        coneOuterGain: 1,
        occlusionStrength: 0.95,
        baseLowpass: 9500,
        reverbAmount: 0.04,
      },
      0.08,
    );

    // Alternate left/right foot: ±5% pitch variation
    this.stepIndex++;
    const footPitch = this.stepIndex % 2 === 0 ? 1.05 : 0.95;
    // Random organic variation ±15%
    const variation = 0.85 + Math.random() * 0.30;

    const baseVol = sprinting ? 0.10 : 0.06;

    // ── Layer 1: Impact thump (low-frequency sine for "weight") ──
    const impact = ctx.createOscillator();
    impact.type = 'sine';
    const impactFreq = (sprinting ? 100 : 80) * footPitch * variation;
    impact.frequency.setValueAtTime(impactFreq, t);
    impact.frequency.exponentialRampToValueAtTime(impactFreq * 0.5, t + 0.04);
    const impactGain = ctx.createGain();
    const impactVol = baseVol * 1.2;
    impactGain.gain.setValueAtTime(impactVol, t);
    impactGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    impact.connect(impactGain).connect(out);
    impact.start(t);
    impact.stop(t + 0.04);

    // ── Layer 2: Surface texture (filtered noise for grit/stone) ──
    const surface = ctx.createBufferSource();
    surface.buffer = this.noise(0.08, 0.25);
    const surfBp = ctx.createBiquadFilter();
    surfBp.type = 'bandpass';
    surfBp.frequency.value = (sprinting ? 1000 : 700) * variation;
    surfBp.Q.value = 0.8;
    const surfGain = ctx.createGain();
    const surfVol = sprinting ? baseVol * 1.0 : baseVol * 0.7;
    surfGain.gain.setValueAtTime(surfVol, t);
    surfGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    surface.connect(surfBp).connect(surfGain).connect(out);
    surface.start(t);
    surface.stop(t + 0.08);

    // ── Layer 3: High transient click for crispness ──
    const transient = ctx.createBufferSource();
    transient.buffer = this.noise(0.015, 0.1);
    const tranHp = ctx.createBiquadFilter();
    tranHp.type = 'bandpass';
    tranHp.frequency.value = (sprinting ? 3500 : 2500) * variation;
    tranHp.Q.value = 1.5;
    const tranGain = ctx.createGain();
    const tranVol = sprinting ? baseVol * 0.6 : baseVol * 0.3;
    tranGain.gain.setValueAtTime(tranVol, t);
    tranGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    transient.connect(tranHp).connect(tranGain).connect(out);
    transient.start(t);
    transient.stop(t + 0.015);

    // ── Sprint extra: Slightly longer tail with more mid energy ──
    if (sprinting) {
      const tail = ctx.createBufferSource();
      tail.buffer = this.noise(0.06, 0.2);
      const tailBp = ctx.createBiquadFilter();
      tailBp.type = 'bandpass';
      tailBp.frequency.value = 1800 * variation;
      tailBp.Q.value = 0.6;
      const tailGain = ctx.createGain();
      tailGain.gain.setValueAtTime(0, t);
      tailGain.gain.setValueAtTime(baseVol * 0.4, t + 0.01);
      tailGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      tail.connect(tailBp).connect(tailGain).connect(out);
      tail.start(t + 0.01);
      tail.stop(t + 0.07);
    }
  }

  // ── JUMP: Ascending whoosh + subtle gear rustle ──
  playJump(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 1.6,
        maxDistance: 85,
        rolloff: 1.75,
        coneInner: 360,
        coneOuter: 360,
        coneOuterGain: 1,
        occlusionStrength: 0.9,
        baseLowpass: 10500,
        reverbAmount: 0.05,
      },
      0.1,
    );

    // ── Ascending frequency sweep (quick whoosh) ──
    const sweep = ctx.createOscillator();
    sweep.type = 'sawtooth';
    sweep.frequency.setValueAtTime(80, t);
    sweep.frequency.exponentialRampToValueAtTime(300, t + 0.1);
    const sweepLp = ctx.createBiquadFilter();
    sweepLp.type = 'lowpass';
    sweepLp.frequency.setValueAtTime(400, t);
    sweepLp.frequency.exponentialRampToValueAtTime(800, t + 0.1);
    const sweepGain = ctx.createGain();
    sweepGain.gain.setValueAtTime(0.06, t);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    sweep.connect(sweepLp).connect(sweepGain).connect(out);
    sweep.start(t);
    sweep.stop(t + 0.1);

    // ── Noise whoosh layer for air movement ──
    const whoosh = ctx.createBufferSource();
    whoosh.buffer = this.noise(0.1, 0.2);
    const whooshBp = ctx.createBiquadFilter();
    whooshBp.type = 'bandpass';
    whooshBp.frequency.setValueAtTime(600, t);
    whooshBp.frequency.exponentialRampToValueAtTime(1500, t + 0.08);
    whooshBp.Q.value = 0.6;
    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0.05, t);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    whoosh.connect(whooshBp).connect(whooshGain).connect(out);
    whoosh.start(t);
    whoosh.stop(t + 0.1);

    // ── Subtle gear/fabric rustle (brief filtered noise) ──
    const rustle = ctx.createBufferSource();
    rustle.buffer = this.noise(0.06, 0.12);
    const rustleBp = ctx.createBiquadFilter();
    rustleBp.type = 'bandpass';
    rustleBp.frequency.value = 3500 + Math.random() * 1000;
    rustleBp.Q.value = 0.8;
    const rustleGain = ctx.createGain();
    rustleGain.gain.setValueAtTime(0.03, t);
    rustleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    rustle.connect(rustleBp).connect(rustleGain).connect(out);
    rustle.start(t);
    rustle.stop(t + 0.06);
  }

  // ── LANDING: Layered boot-slap impact with sub-bass and gear rattle ──
  playLanding(intensity: number, spatial?: SpatialSoundOptions): void {
    const busOptions: SpatialBusOptions = {
      gain: 1,
      minDistance: 1.7,
      maxDistance: 95,
      rolloff: 1.65,
      coneInner: 360,
      coneOuter: 360,
      coneOuterGain: 1,
      occlusionStrength: 0.95,
      baseLowpass: 9500,
      reverbAmount: 0.06,
    };
    const { ctx, t, out } = this.resolveOutput(spatial, busOptions, 0.12);
    const vol = 0.12 + intensity * 0.5;

    // ── Boot-slap transient: sharp initial contact ──
    const slap = ctx.createBufferSource();
    slap.buffer = this.noise(0.025, 0.08);
    const slapBp = ctx.createBiquadFilter();
    slapBp.type = 'bandpass';
    slapBp.frequency.value = 1500 + intensity * 1000;
    slapBp.Q.value = 1.2;
    const slapGain = ctx.createGain();
    slapGain.gain.setValueAtTime(vol * 0.8, t);
    slapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    slap.connect(slapBp).connect(slapGain).connect(out);
    slap.start(t);
    slap.stop(t + 0.025);

    // ── Impact body: filtered noise thud ──
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.15, 0.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 250 + intensity * 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.15);

    // ── Sub-bass thump: scales dramatically with intensity ──
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const subFreq = 30 + (1 - intensity) * 20; // heavier = lower
    sub.frequency.setValueAtTime(subFreq, t);
    sub.frequency.exponentialRampToValueAtTime(subFreq * 0.4, t + 0.12);
    const sg = ctx.createGain();
    const subVol = vol * (0.3 + intensity * 0.7); // dramatic scaling
    sg.gain.setValueAtTime(subVol, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 0.12);

    // ── Gear rattle for heavy landings: delayed high-frequency noise ──
    if (intensity > 0.35) {
      const rattleVol = (intensity - 0.35) * 0.12;
      this.scheduleSpatialLayer(spatial, busOptions, 0.12, 0.05, (lateCtx, lateT, lateOut) => {
        const rattle = lateCtx.createBufferSource();
        rattle.buffer = this.noise(0.08, 0.15);
        const rattleBp = lateCtx.createBiquadFilter();
        rattleBp.type = 'bandpass';
        rattleBp.frequency.value = 3000 + Math.random() * 1500;
        rattleBp.Q.value = 1.0;
        const rattleGain = lateCtx.createGain();
        rattleGain.gain.setValueAtTime(rattleVol, lateT);
        rattleGain.gain.exponentialRampToValueAtTime(0.001, lateT + 0.08);
        rattle.connect(rattleBp).connect(rattleGain).connect(lateOut);
        rattle.start(lateT);
        rattle.stop(lateT + 0.08);
      });
    }
  }

  // ── SLIDE: Skid transient + low rumble + fabric scrape ──
  playSlideStart(spatial?: SpatialSoundOptions): void {
    const { ctx, t, out } = this.resolveOutput(
      spatial,
      {
        gain: 1,
        minDistance: 1.7,
        maxDistance: 95,
        rolloff: 1.7,
        coneInner: 360,
        coneOuter: 360,
        coneOuterGain: 1,
        occlusionStrength: 1,
        baseLowpass: 7600,
        reverbAmount: 0.06,
      },
      0.12,
    );

    // ── Initial skid transient: quick burst like boots catching surface ──
    const skid = ctx.createBufferSource();
    skid.buffer = this.noise(0.04, 0.1);
    const skidBp = ctx.createBiquadFilter();
    skidBp.type = 'bandpass';
    skidBp.frequency.value = 1200 + Math.random() * 400;
    skidBp.Q.value = 1.5;
    const skidGain = ctx.createGain();
    skidGain.gain.setValueAtTime(0.15, t);
    skidGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    skid.connect(skidBp).connect(skidGain).connect(out);
    skid.start(t);
    skid.stop(t + 0.04);

    // ── Low-frequency rumble: decays over ~300ms ──
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise(0.35, 0.25);
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = 'lowpass';
    rumbleLp.frequency.setValueAtTime(350, t);
    rumbleLp.frequency.exponentialRampToValueAtTime(80, t + 0.3);
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.14, t);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    rumble.connect(rumbleLp).connect(rumbleGain).connect(out);
    rumble.start(t);
    rumble.stop(t + 0.35);

    // ── Sub oscillator for weight ──
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(60, t);
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.25);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.10, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    sub.connect(subGain).connect(out);
    sub.start(t);
    sub.stop(t + 0.25);

    // ── Fabric scraping: high bandpass noise for clothing/gear texture ──
    const fabric = ctx.createBufferSource();
    fabric.buffer = this.noise(0.3, 0.35);
    const fabricBp = ctx.createBiquadFilter();
    fabricBp.type = 'bandpass';
    fabricBp.frequency.value = 4000 + Math.random() * 1000;
    fabricBp.Q.value = 0.5;
    const fabricGain = ctx.createGain();
    fabricGain.gain.setValueAtTime(0.04, t);
    fabricGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    fabric.connect(fabricBp).connect(fabricGain).connect(out);
    fabric.start(t);
    fabric.stop(t + 0.3);
  }

  // ── UI: Hover tick ──
  playUIHover(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.04, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.03);
  }

  // ── UI: Click / select ──
  playUIClick(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, t);
    osc.frequency.exponentialRampToValueAtTime(2600, t + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  // ── UI: Deploy / confirm action ──
  playUIDeploy(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    // Rising sweep
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.15);

    // Harmonic ping
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 1600;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, t);
    g2.gain.setValueAtTime(0.12, t + 0.08);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc2.connect(g2).connect(this.master!);
    osc2.start(t);
    osc2.stop(t + 0.25);
  }

  // ── UI: Navigate / screen transition ──
  playUINavigate(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(1400, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  // ── UI: Error / denied ──
  playUIError(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.setValueAtTime(200, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    osc.connect(lp).connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  // ── UI: Type keystroke ──
  playUIType(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 3000 + Math.random() * 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.02);
  }

  // ── AMBIENT: Menu background drone ──
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientLfo: OscillatorNode | null = null;

  startMenuAmbience(): void {
    const ctx = this.ensure();
    const t = ctx.currentTime;

    if (this.ambientOsc) return; // already playing

    // Deep pad
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.setValueAtTime(0, t);
    this.ambientGain.gain.linearRampToValueAtTime(0.03, t + 2);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;

    this.ambientOsc = ctx.createOscillator();
    this.ambientOsc.type = 'sawtooth';
    this.ambientOsc.frequency.value = 55;

    // LFO for subtle movement
    this.ambientLfo = ctx.createOscillator();
    this.ambientLfo.type = 'sine';
    this.ambientLfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 8;
    this.ambientLfo.connect(lfoGain).connect(this.ambientOsc.frequency);

    this.ambientOsc.connect(lp).connect(this.ambientGain).connect(this.master!);
    this.ambientOsc.start(t);
    this.ambientLfo.start(t);
  }

  stopMenuAmbience(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    if (this.ambientGain) {
      this.ambientGain.gain.linearRampToValueAtTime(0, t + 0.5);
    }
    setTimeout(() => {
      this.ambientOsc?.stop();
      this.ambientLfo?.stop();
      this.ambientOsc = null;
      this.ambientLfo = null;
      this.ambientGain = null;
    }, 600);
  }

  setMasterVolume(volume: number): void {
    if (this.master) {
      this.master.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  dispose(): void {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
  }
}
