/**
 * CombatAudio — explosion, block break/land, crumble, hit marker,
 * kill confirm, death, heartbeat, damage, and respawn sounds.
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from './AudioCore';

export function playExplosion(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
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
    bus: 'combat',
    voiceCategory: 'combat',
    voiceDuration: 1.0,
  };
  // Real samples first (crunch + layered deep boom); fall back to synth below.
  if (core.playSample('explosion', spatial, busOptions, { gain: 0.95, pitchVary: 0.12, gainVary: 0.12 })) {
    core.playSample('explosion_boom', spatial, busOptions, { gain: 0.7, pitchVary: 0.12, gainVary: 0.1 });
    return;
  }

  const result = core.resolveOutput(spatial, busOptions, 0.35);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Explosion noise
  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.6, 0.18);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1200, t0);
  lp.frequency.exponentialRampToValueAtTime(80, t0 + 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.50, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
  src.connect(lp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.61);

  // Deep sub
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(65, t0);
  sub.frequency.exponentialRampToValueAtTime(18, t0 + 0.5);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.45, t0);
  sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
  sub.connect(sg).connect(out);
  sub.start(t0);
  sub.stop(t0 + 0.51);

  // Crackle overtone
  const src2 = ctx.createBufferSource();
  src2.buffer = core.noise(0.3, 0.1);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.14, t0);
  g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  src2.connect(hp).connect(g2).connect(out);
  src2.start(t0);
  src2.stop(t0 + 0.31);

  // Reverb echo tail
  const echo = ctx.createBufferSource();
  echo.buffer = core.noise(0.5, 0.25);
  const echoLp = ctx.createBiquadFilter();
  echoLp.type = 'lowpass';
  echoLp.frequency.setValueAtTime(400, t0 + 0.15);
  echoLp.frequency.exponentialRampToValueAtTime(60, t0 + 0.9);
  const echoG = ctx.createGain();
  echoG.gain.setValueAtTime(0, t0);
  echoG.gain.setValueAtTime(0.12, t0 + 0.15);
  echoG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
  echo.connect(echoLp).connect(echoG).connect(out);
  echo.start(t0 + 0.15);
  echo.stop(t0 + 0.91);
}

export function playBlockBreak(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
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
    bus: 'combat',
    voiceCategory: 'combat',
    voiceDuration: 0.1,
  };
  // Real sample first; fall back to procedural synth below if not loaded.
  if (core.playSample('blockbreak', spatial, busOptions, { gain: 0.55, pitchVary: 0.12, gainVary: 0.12 })) return;

  const result = core.resolveOutput(spatial, busOptions, 0.12);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.07, 0.25);
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

export function playBlockLand(core: AudioCore, intensity: number = 0.5, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
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
      bus: 'combat',
      voiceCategory: 'combat',
      voiceDuration: 0.15,
    },
    0.16,
  );
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;
  const vol = 0.15 + intensity * 0.35;

  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.1, 0.2);
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

export function playCrumble(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
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
      bus: 'combat',
      voiceCategory: 'combat',
      voiceDuration: 0.3,
    },
    0.18,
  );
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.25, 0.15);
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

export type HitMarkerKind = 'player' | 'block';

export function playHitMarker(core: AudioCore, kind: HitMarkerKind = 'player'): void {
  // Real sample first; fall back to procedural synth below if not loaded.
  if (core.playSampleOnBus('hitmarker', 'ui', { gain: 0.5 })) return;

  const ctx = core.ensure();
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

  // Player hits read as a bright "tick on flesh"; block hits as a lower, duller
  // "thud on terrain" (block hits previously played no sound at all). Frequencies
  // eased down from the original 1200/1600/2000/3000 to remove combat fizz.
  const cfg = kind === 'block'
    ? { f1: 900,  f2: 1300, harm: 1400, crunchHp: 1800, crunchGain: 0.04,  vol: 0.10 }
    : { f1: 1200, f2: 1600, harm: 1800, crunchHp: 2400, crunchGain: 0.045, vol: 0.15 };

  // Primary tone
  const o1 = ctx.createOscillator();
  o1.type = 'sine';
  o1.frequency.setValueAtTime(cfg.f1, t);
  o1.frequency.setValueAtTime(cfg.f2, t + 0.02);

  // Harmonic overlay
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = cfg.harm;

  const g = ctx.createGain();
  g.gain.setValueAtTime(cfg.vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

  o1.connect(g).connect(uiBus);
  o2.connect(g);
  o1.start(t);
  o1.stop(t + 0.11);
  o2.start(t);
  o2.stop(t + 0.11);

  // Crispy noise transient
  const crunch = ctx.createBufferSource();
  crunch.buffer = core.noise(0.03, 0.15);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = cfg.crunchHp;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(cfg.crunchGain, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  crunch.connect(hp).connect(cg).connect(uiBus);
  crunch.start(t);
  crunch.stop(t + 0.04);
}

export function playKillConfirm(core: AudioCore): void {
  // Real sample first; fall back to procedural synth below if not loaded.
  if (core.playSampleOnBus('killconfirm', 'ui', { gain: 0.6 })) return;

  const ctx = core.ensure();
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

  // Three ascending tones
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

    osc.connect(g).connect(uiBus);
    osc.start(t + delays[i]);
    osc.stop(t + delays[i] + 0.15);
  }

  // Bright shimmer overlay
  const shimmer = ctx.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(2200, t + 0.12); // softer ceiling (was 2640→3520)
  shimmer.frequency.exponentialRampToValueAtTime(2960, t + 0.3);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0, t);
  sg.gain.setValueAtTime(0.06, t + 0.12);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  shimmer.connect(sg).connect(uiBus);
  shimmer.start(t + 0.12);
  shimmer.stop(t + 0.35);
}

export function playDeath(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
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
      bus: 'combat',
      voiceCategory: 'combat',
      voiceDuration: 1.3,
    },
    0.16,
  );
  if (!result) return;
  const { ctx, t, out } = result;

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

export function playHeartbeat(core: AudioCore, spatial?: SpatialSoundOptions): void {
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
    bus: 'combat',
    voiceCategory: 'combat',
    voiceDuration: 0.3,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.05);
  if (!result) return;
  const { ctx, t, out } = result;

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

  // Second beat (dub) — slightly delayed, tracks source
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

export function playDamage(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
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
    bus: 'combat',
    voiceCategory: 'combat',
    voiceDuration: 0.2,
  };
  // Real sample first; fall back to procedural synth below if not loaded.
  if (core.playSample('damage', spatial, busOptions, { gain: 0.7, pitchVary: 0.08, gainVary: 0.1 })) return;

  const result = core.resolveOutput(spatial, busOptions, 0.08);
  if (!result) return;
  const { ctx, t, out } = result;

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

export function playRespawn(core: AudioCore, spatial?: SpatialSoundOptions): void {
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
    bus: 'combat',
    voiceCategory: 'combat',
    voiceDuration: 0.5,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.15);
  if (!result) return;
  const { ctx, t, out } = result;

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
