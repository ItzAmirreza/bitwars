/**
 * Vehicle rocket — procedural launch sound (louder, heavier than infantry).
 * Shared by helicopter rockets (weapon index 101), the anti-air SAM missile
 * (105), and the fighter-jet air missile (106).
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

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
