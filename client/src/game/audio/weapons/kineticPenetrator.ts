/**
 * Kinetic penetrator — fighter-jet mass-accelerator weapon (weapon index 102).
 * Exports both the fire sound and the ground-impact detonation.
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

export function playKineticPenetratorFire(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 8,
    maxDistance: 350,
    rolloff: 0.8,
    coneInner: 90,
    coneOuter: 270,
    coneOuterGain: 0.3,
    occlusionStrength: 0.7,
    baseLowpass: 10000,
    reverbAmount: 0.2,
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.6,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.5);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // High-energy electric discharge zap (ascending)
  const zap = ctx.createOscillator();
  zap.type = 'sawtooth';
  zap.frequency.setValueAtTime(200, t0);
  zap.frequency.exponentialRampToValueAtTime(4000, t0 + 0.05);
  zap.frequency.exponentialRampToValueAtTime(800, t0 + 0.15);
  const zapHp = ctx.createBiquadFilter();
  zapHp.type = 'highpass';
  zapHp.frequency.value = 400;
  const zapG = ctx.createGain();
  zapG.gain.setValueAtTime(0.3, t0);
  zapG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  zap.connect(zapHp).connect(zapG).connect(out);
  zap.start(t0);
  zap.stop(t0 + 0.22);

  // Heavy metallic thud (mass accelerator)
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(60, t0);
  thud.frequency.exponentialRampToValueAtTime(25, t0 + 0.2);
  const thudG = ctx.createGain();
  thudG.gain.setValueAtTime(0.45, t0);
  thudG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
  thud.connect(thudG).connect(out);
  thud.start(t0);
  thud.stop(t0 + 0.27);

  // Crackling energy noise
  const crack = ctx.createBufferSource();
  crack.buffer = core.noise(0.3, 0.5);
  const crackBp = ctx.createBiquadFilter();
  crackBp.type = 'bandpass';
  crackBp.frequency.value = 3500;
  crackBp.Q.value = 1.2;
  const crackG = ctx.createGain();
  crackG.gain.setValueAtTime(0.2, t0);
  crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  crack.connect(crackBp).connect(crackG).connect(out);
  crack.start(t0);
  crack.stop(t0 + 0.32);
}

export function playKineticPenetratorDetonation(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 10,
    maxDistance: 350,
    rolloff: 0.7,
    coneInner: 360,
    coneOuter: 360,
    coneOuterGain: 1,
    occlusionStrength: 0.6,
    baseLowpass: 6000,
    reverbAmount: 0.3,
    bus: 'combat',
    voiceCategory: 'combat',
    voiceDuration: 1.5,
  };
  const result = core.resolveOutput(spatial, busOptions, 0.5);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Deep sub-bass rumble (foundation collapsing)
  const subOsc = ctx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(45, t0);
  subOsc.frequency.exponentialRampToValueAtTime(18, t0 + 1.2);
  const subG = ctx.createGain();
  subG.gain.setValueAtTime(0.45, t0);
  subG.gain.exponentialRampToValueAtTime(0.001, t0 + 1.2);
  subOsc.connect(subG).connect(out);
  subOsc.start(t0);
  subOsc.stop(t0 + 1.22);

  // Heavy blast noise
  const blast = ctx.createBufferSource();
  blast.buffer = core.noise(0.8, 0.2);
  const blastLp = ctx.createBiquadFilter();
  blastLp.type = 'lowpass';
  blastLp.frequency.setValueAtTime(1200, t0);
  blastLp.frequency.exponentialRampToValueAtTime(300, t0 + 0.8);
  const blastG = ctx.createGain();
  blastG.gain.setValueAtTime(0.35, t0);
  blastG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
  blast.connect(blastLp).connect(blastG).connect(out);
  blast.start(t0);
  blast.stop(t0 + 0.92);

  // Crumbling aftermath
  const crumble = ctx.createBufferSource();
  crumble.buffer = core.noise(1.2, 0.15);
  const crumbleBp = ctx.createBiquadFilter();
  crumbleBp.type = 'bandpass';
  crumbleBp.frequency.value = 400;
  crumbleBp.Q.value = 0.4;
  const crumbleG = ctx.createGain();
  crumbleG.gain.setValueAtTime(0.001, t0);
  crumbleG.gain.linearRampToValueAtTime(0.18, t0 + 0.2);
  crumbleG.gain.exponentialRampToValueAtTime(0.001, t0 + 1.3);
  crumble.connect(crumbleBp).connect(crumbleG).connect(out);
  crumble.start(t0);
  crumble.stop(t0 + 1.32);
}
