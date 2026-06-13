/**
 * RPG — procedural launch sound (weapon index 2).
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

export function playRPGLaunch(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
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
  };
  // Real sample first; fall back to procedural synth below if not loaded.
  if (core.playSample('weapon_rpg', spatial, busOptions, { gain: 0.85, pitchVary: 0.06, gainVary: 0.1 })) return;

  const result = core.resolveOutput(spatial, busOptions, 0.2);
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
