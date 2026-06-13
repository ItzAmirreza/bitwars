/**
 * Grenade launcher — procedural launch sound (weapon index 4).
 */

import type { AudioCore, SpatialSoundOptions } from '../AudioCore';

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
