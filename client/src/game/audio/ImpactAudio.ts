/**
 * Impact audio: playExplosion, playBlockBreak, playCrumble, playBlockLand
 */
import type { AudioCore, SpatialSoundOptions } from '../AudioCore';

// ── EXPLOSION: Massive boom ──
export function playExplosion(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out, delay } = core.resolveOutput(
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

  // Reverb echo tail — delayed quieter explosion for distance feel
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

// ── BLOCK BREAK: Short crumble ──
export function playBlockBreak(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out, delay } = core.resolveOutput(
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

// ── CRUMBLE: Blocks becoming unstable ──
export function playCrumble(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out, delay } = core.resolveOutput(
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

// ── BLOCK LAND: Falling blocks hit ground ──
export function playBlockLand(core: AudioCore, intensity: number = 0.5, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out, delay } = core.resolveOutput(
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
