/**
 * Projectile flyby / whiz — the sound of a round passing near the listener.
 * Not keyed by weapon index; the pitch scales with projectile speed.
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

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
