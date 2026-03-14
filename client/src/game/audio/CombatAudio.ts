/**
 * Combat audio: playHitMarker, playKillConfirm, playDeath, playHeartbeat, playRespawn, playDamage
 */
import type { AudioCore, SpatialSoundOptions } from '../AudioCore';

// ── HIT MARKER: Crispy satisfying ding ──
export function playHitMarker(core: AudioCore): void {
  const ctx = core.ensure();
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
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

  o1.connect(g).connect(core.master!);
  o2.connect(g);
  o1.start(t);
  o1.stop(t + 0.11);
  o2.start(t);
  o2.stop(t + 0.11);

  // Crispy noise transient for impact feel
  const crunch = ctx.createBufferSource();
  crunch.buffer = core.noise(0.03, 0.15);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3000;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.06, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  crunch.connect(hp).connect(cg).connect(core.master!);
  crunch.start(t);
  crunch.stop(t + 0.04);
}

// ── KILL CONFIRMED: Triumphant ascending tones ──
export function playKillConfirm(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;

  // Three ascending tones for a satisfying "ding-ding-DING"
  const freqs = [880, 1175, 1760];
  const delays = [0, 0.06, 0.12];
  const vols = [0.10, 0.12, 0.16];

  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqs[i], t + delays[i]);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueAtTime(vols[i], t + delays[i]);
    g.gain.exponentialRampToValueAtTime(0.001, t + delays[i] + 0.15);

    osc.connect(g).connect(core.master!);
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
  shimmer.connect(sg).connect(core.master!);
  shimmer.start(t + 0.12);
  shimmer.stop(t + 0.35);
}

// ── DEATH: Dramatic descending thud ──
export function playDeath(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out } = core.resolveOutput(
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
  g.gain.setValueAtTime(0.30, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

  osc.connect(lp).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.81);

  // Impact noise
  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.3, 0.12);
  const lp2 = ctx.createBiquadFilter();
  lp2.type = 'lowpass';
  lp2.frequency.value = 300;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.35, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  src.connect(lp2).connect(g2).connect(out);
  src.start(t);
  src.stop(t + 0.31);

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
export function playHeartbeat(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions = {
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
  const { ctx, t, out } = core.resolveOutput(spatial, busOptions, 0.05);

  // First beat (lub)
  const lub = ctx.createOscillator();
  lub.type = 'sine';
  lub.frequency.setValueAtTime(55, t);
  lub.frequency.exponentialRampToValueAtTime(30, t + 0.1);
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0.22, t);
  lg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  lub.connect(lg).connect(out);
  lub.start(t);
  lub.stop(t + 0.13);

  // Second beat (dub) - slightly delayed, tracks source
  core.scheduleSpatialLayer(spatial, busOptions, 0.05, 0.15, (lateCtx, lateT, lateOut) => {
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
  src.buffer = core.noise(0.15, 0.3);
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
export function playRespawn(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions = {
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
  const { ctx, t, out } = core.resolveOutput(spatial, busOptions, 0.15);

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
  core.scheduleSpatialLayer(spatial, busOptions, 0.15, 0.1, (lateCtx, lateT, lateOut) => {
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

// ── DAMAGE TAKEN: Low impact thud ──
export function playDamage(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out } = core.resolveOutput(
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
  src.buffer = core.noise(0.15, 0.2);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.30, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  src.connect(lp).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.16);

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 50;
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.24, t);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  sub.connect(sg).connect(out);
  sub.start(t);
  sub.stop(t + 0.13);
}
