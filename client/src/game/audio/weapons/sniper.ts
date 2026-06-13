/**
 * Sniper — procedural fire sound (weapon index 5).
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

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
