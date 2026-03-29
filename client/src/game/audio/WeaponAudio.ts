/**
 * WeaponAudio — weapon firing, reload, empty click, and switch sounds.
 *
 * Each function now specifies a VoiceCategory + AudioBusName + voiceDuration
 * so AudioCore can cull distant sounds, enforce polyphony limits, route
 * through the correct submix bus, and clean up nodes automatically.
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from './AudioCore';

export function playRifle(core: AudioCore, spatial?: SpatialSoundOptions): void {
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
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.15,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.22);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Initial transient crack
  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.1, 0.12);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2500;
  bp.Q.value = 1.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.35, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.11);

  // Low-end punch
  const punch = ctx.createOscillator();
  punch.type = 'sine';
  punch.frequency.setValueAtTime(180, t0);
  punch.frequency.exponentialRampToValueAtTime(60, t0 + 0.05);
  const pg = ctx.createGain();
  pg.gain.setValueAtTime(0.16, t0);
  pg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  punch.connect(pg).connect(out);
  punch.start(t0);
  punch.stop(t0 + 0.06);

  // Metallic ping
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(4500, t0);
  osc.frequency.exponentialRampToValueAtTime(3000, t0 + 0.06);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.07, t0);
  og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
  osc.connect(og).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.07);

  // Shell casing tinkle (delayed, tracks moving source)
  core.scheduleSpatialLayer(spatial, busOptions, 0.22, 0.08, (lateCtx, lateT, lateOut) => {
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

export function playShotgun(core: AudioCore, spatial?: SpatialSoundOptions): void {
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
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.3,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.24);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Heavy noise burst
  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.28, 0.1);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  lp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.42, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
  src.connect(lp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.29);

  // Sub thump
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(100, t0);
  sub.frequency.exponentialRampToValueAtTime(20, t0 + 0.2);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.40, t0);
  sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  sub.connect(sg).connect(out);
  sub.start(t0);
  sub.stop(t0 + 0.21);

  // High snap (mechanical action)
  const snap = ctx.createOscillator();
  snap.type = 'square';
  snap.frequency.value = 3500;
  const snapLp = ctx.createBiquadFilter();
  snapLp.type = 'lowpass';
  snapLp.frequency.value = 6000;
  const snapG = ctx.createGain();
  snapG.gain.setValueAtTime(0.07, t0);
  snapG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.025);
  snap.connect(snapLp).connect(snapG).connect(out);
  snap.start(t0);
  snap.stop(t0 + 0.03);

  // Mid-range body (the "whump")
  const body = ctx.createOscillator();
  body.type = 'sawtooth';
  body.frequency.setValueAtTime(250, t0);
  body.frequency.exponentialRampToValueAtTime(80, t0 + 0.08);
  const bodyLp = ctx.createBiquadFilter();
  bodyLp.type = 'lowpass';
  bodyLp.frequency.value = 500;
  const bg = ctx.createGain();
  bg.gain.setValueAtTime(0.18, t0);
  bg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
  body.connect(bodyLp).connect(bg).connect(out);
  body.start(t0);
  body.stop(t0 + 0.09);

  // Pump-action rack (delayed, tracks moving source)
  core.scheduleSpatialLayer(spatial, busOptions, 0.24, 0.2, (lateCtx, lateT, lateOut) => {
    const rack = lateCtx.createBufferSource();
    rack.buffer = core.noise(0.06, 0.2);
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

export function playRPGLaunch(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
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
      bus: 'weapon',
      voiceCategory: 'weapon',
      voiceDuration: 0.4,
    },
    0.2,
  );
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Whoosh
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  osc.connect(lp).connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.36);

  // Hiss
  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.3, 0.25);
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.10, t0);
  hg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  src.connect(hg).connect(out);
  src.start(t0);
  src.stop(t0 + 0.31);
}

export function playMachineGun(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
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
      bus: 'weapon',
      voiceCategory: 'weapon',
      voiceDuration: 0.08,
    },
    0.16,
  );
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.05, 0.1);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3200;
  bp.Q.value = 2.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.20, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.06);

  const crack = ctx.createOscillator();
  crack.type = 'square';
  crack.frequency.setValueAtTime(1900, t0);
  crack.frequency.exponentialRampToValueAtTime(1200, t0 + 0.03);
  const crackLp = ctx.createBiquadFilter();
  crackLp.type = 'lowpass';
  crackLp.frequency.value = 5000;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.06, t0);
  cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.03);
  crack.connect(crackLp).connect(cg).connect(out);
  crack.start(t0);
  crack.stop(t0 + 0.04);
}

export function playGrenadeLaunch(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
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
      bus: 'weapon',
      voiceCategory: 'weapon',
      voiceDuration: 0.2,
    },
    0.2,
  );
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  const thunk = ctx.createOscillator();
  thunk.type = 'sine';
  thunk.frequency.setValueAtTime(130, t0);
  thunk.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.28, t0);
  tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  thunk.connect(tg).connect(out);
  thunk.start(t0);
  thunk.stop(t0 + 0.13);

  const hiss = ctx.createBufferSource();
  hiss.buffer = core.noise(0.18, 0.2);
  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 1200;
  hp.Q.value = 0.9;
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.10, t0);
  hg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
  hiss.connect(hp).connect(hg).connect(out);
  hiss.start(t0);
  hiss.stop(t0 + 0.19);
}

export function playSniper(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 3,
    maxDistance: 220,
    rolloff: 1.1,
    coneInner: 80,
    coneOuter: 250,
    coneOuterGain: 0.15,
    occlusionStrength: 0.95,
    baseLowpass: 16000,
    reverbAmount: 0.18,
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.4,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.35);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Sharp supersonic crack (the defining sniper sound)
  const crack = ctx.createBufferSource();
  crack.buffer = core.noise(0.04, 0.06);
  const crackHp = ctx.createBiquadFilter();
  crackHp.type = 'highpass';
  crackHp.frequency.value = 3000;
  const crackG = ctx.createGain();
  crackG.gain.setValueAtTime(0.45, t0);
  crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
  crack.connect(crackHp).connect(crackG).connect(out);
  crack.start(t0);
  crack.stop(t0 + 0.05);

  // Heavy low-end boom (large caliber)
  const boom = ctx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(120, t0);
  boom.frequency.exponentialRampToValueAtTime(35, t0 + 0.2);
  const boomG = ctx.createGain();
  boomG.gain.setValueAtTime(0.35, t0);
  boomG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  boom.connect(boomG).connect(out);
  boom.start(t0);
  boom.stop(t0 + 0.22);

  // Mid-range resonance (barrel ring)
  const ring = ctx.createOscillator();
  ring.type = 'sine';
  ring.frequency.setValueAtTime(2800, t0);
  ring.frequency.exponentialRampToValueAtTime(1800, t0 + 0.12);
  const ringG = ctx.createGain();
  ringG.gain.setValueAtTime(0.1, t0);
  ringG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  ring.connect(ringG).connect(out);
  ring.start(t0);
  ring.stop(t0 + 0.13);

  // Echo tail (delayed, tracks moving source)
  core.scheduleSpatialLayer(spatial, busOptions, 0.35, 0.15, (lateCtx, lateT, lateOut) => {
    const echo = lateCtx.createBufferSource();
    echo.buffer = core.noise(0.2, 0.3);
    const echoBp = lateCtx.createBiquadFilter();
    echoBp.type = 'bandpass';
    echoBp.frequency.value = 1200;
    echoBp.Q.value = 0.6;
    const eg = lateCtx.createGain();
    eg.gain.setValueAtTime(0.08, lateT);
    eg.gain.exponentialRampToValueAtTime(0.001, lateT + 0.2);
    echo.connect(echoBp).connect(eg).connect(lateOut);
    echo.start(lateT);
    echo.stop(lateT + 0.22);
  });

  // Bolt action rack (delayed)
  core.scheduleSpatialLayer(spatial, busOptions, 0.35, 0.35, (lateCtx, lateT, lateOut) => {
    const bolt = lateCtx.createOscillator();
    bolt.type = 'square';
    bolt.frequency.setValueAtTime(1800, lateT);
    bolt.frequency.exponentialRampToValueAtTime(1100, lateT + 0.04);
    const boltLp = lateCtx.createBiquadFilter();
    boltLp.type = 'lowpass';
    boltLp.frequency.value = 4000;
    const bg = lateCtx.createGain();
    bg.gain.setValueAtTime(0.06, lateT);
    bg.gain.exponentialRampToValueAtTime(0.001, lateT + 0.04);
    bolt.connect(boltLp).connect(bg).connect(lateOut);
    bolt.start(lateT);
    bolt.stop(lateT + 0.05);
  });
}

export function playReload(core: AudioCore, spatial?: SpatialSoundOptions): void {
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
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.1,
  };

  // Use Web Audio scheduling instead of setTimeout for timing accuracy.
  // All 4 clicks share a single resolveOutput call (single voice slot).
  const result = core.resolveOutput(spatial, busOptions, 0.08);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  core.click(ctx, out, t0, 1100, 0.035);          // mag release
  core.click(ctx, out, t0 + 0.25, 800, 0.04);     // mag out
  core.click(ctx, out, t0 + 0.45, 1400, 0.05);    // mag in
  core.click(ctx, out, t0 + 0.6, 2200, 0.03);     // chamber rack
}

export function playEmpty(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
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
      bus: 'weapon',
      voiceCategory: 'weapon',
      voiceDuration: 0.05,
    },
    0.05,
  );
  if (!result) return;
  const { ctx, t, out } = result;

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

// ── Vehicle-specific weapon sounds (louder, heavier than infantry) ──

export function playVehicleMinigun(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 6,
    maxDistance: 240,
    rolloff: 1.1,
    coneInner: 110,
    coneOuter: 280,
    coneOuterGain: 0.35,
    occlusionStrength: 0.7,
    baseLowpass: 14000,
    reverbAmount: 0.12,
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.1,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.28);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Heavy noise burst
  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.08, 0.12);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.42, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.09);

  // Low-end thump
  const punch = ctx.createOscillator();
  punch.type = 'sine';
  punch.frequency.setValueAtTime(140, t0);
  punch.frequency.exponentialRampToValueAtTime(55, t0 + 0.06);
  const pg = ctx.createGain();
  pg.gain.setValueAtTime(0.22, t0);
  pg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
  punch.connect(pg).connect(out);
  punch.start(t0);
  punch.stop(t0 + 0.07);

  // Mechanical rattle
  const crack = ctx.createOscillator();
  crack.type = 'square';
  crack.frequency.setValueAtTime(1600, t0);
  crack.frequency.exponentialRampToValueAtTime(900, t0 + 0.04);
  const crackLp = ctx.createBiquadFilter();
  crackLp.type = 'lowpass';
  crackLp.frequency.value = 4000;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.10, t0);
  cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
  crack.connect(crackLp).connect(cg).connect(out);
  crack.start(t0);
  crack.stop(t0 + 0.05);
}

export function playVehicleRocket(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 5,
    maxDistance: 260,
    rolloff: 1.0,
    coneInner: 60,
    coneOuter: 240,
    coneOuterGain: 0.2,
    occlusionStrength: 0.85,
    baseLowpass: 10000,
    reverbAmount: 0.16,
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.5,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.3);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Heavy whoosh
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.45);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 550;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.38, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
  osc.connect(lp).connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.46);

  // Ignition hiss
  const hiss = ctx.createBufferSource();
  hiss.buffer = core.noise(0.4, 0.22);
  const hg = ctx.createGain();
  hg.gain.setValueAtTime(0.18, t0);
  hg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
  hiss.connect(hg).connect(out);
  hiss.start(t0);
  hiss.stop(t0 + 0.41);

  // Sub-bass punch
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(65, t0);
  sub.frequency.exponentialRampToValueAtTime(25, t0 + 0.18);
  const sGain = ctx.createGain();
  sGain.gain.setValueAtTime(0.30, t0);
  sGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
  sub.connect(sGain).connect(out);
  sub.start(t0);
  sub.stop(t0 + 0.19);
}

// ── Projectile flyby / whiz ──

export function playProjectileFlyby(
  core: AudioCore,
  speed: number,
  spatial?: SpatialSoundOptions,
): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 2,
    maxDistance: 45,
    rolloff: 1.6,
    coneInner: 360,
    coneOuter: 360,
    coneOuterGain: 1,
    occlusionStrength: 0.5,
    baseLowpass: 16000,
    reverbAmount: 0.06,
    bus: 'weapon',
    voiceCategory: 'flyby',
    voiceDuration: 0.3,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.1);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  const speedFactor = core.clamp(speed / 120, 0.4, 2.0);

  // Main whiz
  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.25, 0.35);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1800 * speedFactor, t0);
  bp.frequency.exponentialRampToValueAtTime(800 * speedFactor, t0 + 0.18 / speedFactor);
  bp.Q.value = 2.5;
  const g = ctx.createGain();
  const whizVol = 0.18 * core.clamp(speedFactor, 0.5, 1.5);
  g.gain.setValueAtTime(whizVol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22 / speedFactor);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.25 / speedFactor);

  // Tonal whistle
  const whistle = ctx.createOscillator();
  whistle.type = 'sine';
  whistle.frequency.setValueAtTime(3200 * speedFactor, t0);
  whistle.frequency.exponentialRampToValueAtTime(1200 * speedFactor, t0 + 0.15 / speedFactor);
  const wg = ctx.createGain();
  wg.gain.setValueAtTime(0.06 * speedFactor, t0);
  wg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15 / speedFactor);
  whistle.connect(wg).connect(out);
  whistle.start(t0);
  whistle.stop(t0 + 0.18 / speedFactor);

  // Air crack for fast projectiles
  if (speed > 60) {
    const crack = ctx.createBufferSource();
    crack.buffer = core.noise(0.02, 0.05);
    const crackHp = ctx.createBiquadFilter();
    crackHp.type = 'highpass';
    crackHp.frequency.value = 4000;
    const crackG = ctx.createGain();
    crackG.gain.setValueAtTime(0.12, t0);
    crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.02);
    crack.connect(crackHp).connect(crackG).connect(out);
    crack.start(t0);
    crack.stop(t0 + 0.025);
  }
}

export function playSwitch(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
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
      bus: 'weapon',
      voiceCategory: 'weapon',
      voiceDuration: 0.1,
    },
    0.06,
  );
  if (!result) return;
  const { ctx, t, out } = result;

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

// ── Fighter Jet weapon sounds ──

export function playKineticPenetratorFire(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 8,
    maxDistance: 350,
    rolloff: 0.8,
    coneInner: 90,
    coneOuter: 270,
    coneOuterGain: 0.3,
    occlusionStrength: 0.7,
    baseLowpass: 10000,
    reverbAmount: 0.2,
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.6,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.5);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // High-energy electric discharge zap (ascending)
  const zap = ctx.createOscillator();
  zap.type = 'sawtooth';
  zap.frequency.setValueAtTime(200, t0);
  zap.frequency.exponentialRampToValueAtTime(4000, t0 + 0.05);
  zap.frequency.exponentialRampToValueAtTime(800, t0 + 0.15);
  const zapHp = ctx.createBiquadFilter();
  zapHp.type = 'highpass';
  zapHp.frequency.value = 400;
  const zapG = ctx.createGain();
  zapG.gain.setValueAtTime(0.3, t0);
  zapG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  zap.connect(zapHp).connect(zapG).connect(out);
  zap.start(t0);
  zap.stop(t0 + 0.22);

  // Heavy metallic thud (mass accelerator)
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(60, t0);
  thud.frequency.exponentialRampToValueAtTime(25, t0 + 0.2);
  const thudG = ctx.createGain();
  thudG.gain.setValueAtTime(0.45, t0);
  thudG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
  thud.connect(thudG).connect(out);
  thud.start(t0);
  thud.stop(t0 + 0.27);

  // Crackling energy noise
  const crack = ctx.createBufferSource();
  crack.buffer = core.noise(0.3, 0.5);
  const crackBp = ctx.createBiquadFilter();
  crackBp.type = 'bandpass';
  crackBp.frequency.value = 3500;
  crackBp.Q.value = 1.2;
  const crackG = ctx.createGain();
  crackG.gain.setValueAtTime(0.2, t0);
  crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  crack.connect(crackBp).connect(crackG).connect(out);
  crack.start(t0);
  crack.stop(t0 + 0.32);
}

export function playKineticPenetratorDetonation(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 10,
    maxDistance: 350,
    rolloff: 0.7,
    coneInner: 360,
    coneOuter: 360,
    coneOuterGain: 1,
    occlusionStrength: 0.6,
    baseLowpass: 6000,
    reverbAmount: 0.3,
    bus: 'combat',
    voiceCategory: 'combat',
    voiceDuration: 1.5,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.5);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Deep sub-bass rumble (foundation collapsing)
  const subOsc = ctx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(45, t0);
  subOsc.frequency.exponentialRampToValueAtTime(18, t0 + 1.2);
  const subG = ctx.createGain();
  subG.gain.setValueAtTime(0.45, t0);
  subG.gain.exponentialRampToValueAtTime(0.001, t0 + 1.2);
  subOsc.connect(subG).connect(out);
  subOsc.start(t0);
  subOsc.stop(t0 + 1.22);

  // Heavy blast noise
  const blast = ctx.createBufferSource();
  blast.buffer = core.noise(0.8, 0.2);
  const blastLp = ctx.createBiquadFilter();
  blastLp.type = 'lowpass';
  blastLp.frequency.setValueAtTime(1200, t0);
  blastLp.frequency.exponentialRampToValueAtTime(300, t0 + 0.8);
  const blastG = ctx.createGain();
  blastG.gain.setValueAtTime(0.35, t0);
  blastG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
  blast.connect(blastLp).connect(blastG).connect(out);
  blast.start(t0);
  blast.stop(t0 + 0.92);

  // Crumbling aftermath
  const crumble = ctx.createBufferSource();
  crumble.buffer = core.noise(1.2, 0.15);
  const crumbleBp = ctx.createBiquadFilter();
  crumbleBp.type = 'bandpass';
  crumbleBp.frequency.value = 400;
  crumbleBp.Q.value = 0.4;
  const crumbleG = ctx.createGain();
  crumbleG.gain.setValueAtTime(0.001, t0);
  crumbleG.gain.linearRampToValueAtTime(0.18, t0 + 0.2);
  crumbleG.gain.exponentialRampToValueAtTime(0.001, t0 + 1.3);
  crumble.connect(crumbleBp).connect(crumbleG).connect(out);
  crumble.start(t0);
  crumble.stop(t0 + 1.32);
}

export function playCarpetBombDrop(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 5,
    maxDistance: 250,
    rolloff: 1.0,
    coneInner: 90,
    coneOuter: 260,
    coneOuterGain: 0.3,
    occlusionStrength: 0.75,
    baseLowpass: 9000,
    reverbAmount: 0.14,
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.4,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.25);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Thuddy bomb release clunk
  const clunk = ctx.createOscillator();
  clunk.type = 'sine';
  clunk.frequency.setValueAtTime(120, t0);
  clunk.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.30, t0);
  cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  clunk.connect(cg).connect(out);
  clunk.start(t0);
  clunk.stop(t0 + 0.13);

  // Mechanical release noise
  const mech = ctx.createBufferSource();
  mech.buffer = core.noise(0.08, 0.1);
  const mechBp = ctx.createBiquadFilter();
  mechBp.type = 'bandpass';
  mechBp.frequency.value = 1800;
  mechBp.Q.value = 1.2;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(0.18, t0);
  mg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
  mech.connect(mechBp).connect(mg).connect(out);
  mech.start(t0);
  mech.stop(t0 + 0.09);

  // Short whoosh as bomb departs
  const whoosh = ctx.createBufferSource();
  whoosh.buffer = core.noise(0.2, 0.2);
  const whooshBp = ctx.createBiquadFilter();
  whooshBp.type = 'bandpass';
  whooshBp.frequency.setValueAtTime(800, t0);
  whooshBp.frequency.exponentialRampToValueAtTime(400, t0 + 0.18);
  whooshBp.Q.value = 0.5;
  const wg = ctx.createGain();
  wg.gain.setValueAtTime(0.12, t0 + 0.03);
  wg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  whoosh.connect(whooshBp).connect(wg).connect(out);
  whoosh.start(t0);
  whoosh.stop(t0 + 0.22);
}
