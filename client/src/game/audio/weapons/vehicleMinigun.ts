/**
 * Vehicle minigun — procedural fire sound (louder, heavier than infantry).
 * Shared by the helicopter minigun (weapon index 100) and the APC autocannon
 * (weapon index 104).
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

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
  // Real sample first; fall back to procedural synth below if not loaded.
  // Per-shot pitch jitter prevents comb-filtering/phasing when fast cannons
  // (e.g. anti-air) overlap many copies of the same sample.
  if (core.playSample('weapon_minigun', spatial, busOptions, {
    gain: 0.45,
    pitchVary: 0.1,
    gainVary: 0.12,
  })) return;

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
