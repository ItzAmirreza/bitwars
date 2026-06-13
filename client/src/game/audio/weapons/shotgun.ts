/**
 * Shotgun — procedural fire sound (weapon index 1).
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

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
  // Real sample first; fall back to procedural synth below if not loaded.
  if (core.playSample('weapon_shotgun', spatial, busOptions, { gain: 0.9, pitchVary: 0.05, gainVary: 0.1 })) return;

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
