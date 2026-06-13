/**
 * Machine gun — procedural fire sound (weapon index 3).
 */

import type { AudioCore, SpatialSoundOptions } from '../AudioCore';

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
