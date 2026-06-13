/**
 * Carpet bomb — fighter-jet bomb-release sound (weapon index 103).
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

export function playCarpetBombDrop(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 5,
    maxDistance: 250,
    rolloff: 1.0,
    coneInner: 90,
    coneOuter: 260,
    coneOuterGain: 0.3,
    occlusionStrength: 0.75,
    baseLowpass: 9000,
    reverbAmount: 0.14,
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.4,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.25);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Thuddy bomb release clunk
  const clunk = ctx.createOscillator();
  clunk.type = 'sine';
  clunk.frequency.setValueAtTime(120, t0);
  clunk.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.30, t0);
  cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  clunk.connect(cg).connect(out);
  clunk.start(t0);
  clunk.stop(t0 + 0.13);

  // Mechanical release noise
  const mech = ctx.createBufferSource();
  mech.buffer = core.noise(0.08, 0.1);
  const mechBp = ctx.createBiquadFilter();
  mechBp.type = 'bandpass';
  mechBp.frequency.value = 1800;
  mechBp.Q.value = 1.2;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(0.18, t0);
  mg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
  mech.connect(mechBp).connect(mg).connect(out);
  mech.start(t0);
  mech.stop(t0 + 0.09);

  // Short whoosh as bomb departs
  const whoosh = ctx.createBufferSource();
  whoosh.buffer = core.noise(0.2, 0.2);
  const whooshBp = ctx.createBiquadFilter();
  whooshBp.type = 'bandpass';
  whooshBp.frequency.setValueAtTime(800, t0);
  whooshBp.frequency.exponentialRampToValueAtTime(400, t0 + 0.18);
  whooshBp.Q.value = 0.5;
  const wg = ctx.createGain();
  wg.gain.setValueAtTime(0.12, t0 + 0.03);
  wg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  whoosh.connect(whooshBp).connect(wg).connect(out);
  whoosh.start(t0);
  whoosh.stop(t0 + 0.22);
}
