/**
 * Weapon audio: playRifle, playShotgun, playRPGLaunch, playMachineGun, playGrenadeLaunch
 */
import type { AudioCore, SpatialBusOptions, SpatialSoundOptions } from '../AudioCore';

// ── RIFLE: Sharp crack with metallic ring + punch ──
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
  };
  const { ctx, t, out, delay } = core.resolveOutput(spatial, busOptions, 0.22);
  const t0 = t + delay;

  // Initial transient crack — wider bandwidth
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

  // Low-end punch for body
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

  // Metallic ping — brighter
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

// ── SHOTGUN: Massive boom with pump-action feel ──
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
  };
  const { ctx, t, out, delay } = core.resolveOutput(spatial, busOptions, 0.24);
  const t0 = t + delay;

  // Heavy noise burst — wider bandwidth
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

  // Sub thump — deeper and wider
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

// ── RPG: Whoosh launch + delayed boom ──
export function playRPGLaunch(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out, delay } = core.resolveOutput(
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

// ── MACHINE GUN: Tight, bright chatter ──
export function playMachineGun(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out, delay } = core.resolveOutput(
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

// ── GRENADE LAUNCHER: Heavy thunk + pressurized pop ──
export function playGrenadeLaunch(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out, delay } = core.resolveOutput(
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
