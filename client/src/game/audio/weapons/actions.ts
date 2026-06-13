/**
 * Weapon-handling actions shared across all weapons — reload, empty (dry-fire)
 * click, and weapon switch. These are not keyed by weapon index, so they live
 * here rather than in a per-weapon file.
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

export function playReload(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 1.4,
    maxDistance: 65,
    rolloff: 1.8,
    coneInner: 120,
    coneOuter: 260,
    coneOuterGain: 0.22,
    occlusionStrength: 0.75,
    baseLowpass: 11000,
    reverbAmount: 0.04,
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.1,
  };

  // Use Web Audio scheduling instead of setTimeout for timing accuracy.
  // All 4 clicks share a single resolveOutput call (single voice slot).
  const result = core.resolveOutput(spatial, busOptions, 0.08);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  core.click(ctx, out, t0, 1100, 0.035);          // mag release
  core.click(ctx, out, t0 + 0.25, 800, 0.04);     // mag out
  core.click(ctx, out, t0 + 0.45, 1400, 0.05);    // mag in
  core.click(ctx, out, t0 + 0.6, 2200, 0.03);     // chamber rack
}

export function playEmpty(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
    spatial,
    {
      gain: 1,
      minDistance: 1.2,
      maxDistance: 45,
      rolloff: 2.2,
      coneInner: 110,
      coneOuter: 260,
      coneOuterGain: 0.2,
      occlusionStrength: 0.65,
      baseLowpass: 8500,
      reverbAmount: 0.02,
      bus: 'weapon',
      voiceCategory: 'weapon',
      voiceDuration: 0.05,
    },
    0.05,
  );
  if (!result) return;
  const { ctx, t, out } = result;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 350;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.04);
}

export function playSwitch(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const result = core.resolveOutput(
    spatial,
    {
      gain: 1,
      minDistance: 1.1,
      maxDistance: 50,
      rolloff: 2,
      coneInner: 120,
      coneOuter: 260,
      coneOuterGain: 0.25,
      occlusionStrength: 0.7,
      baseLowpass: 10000,
      reverbAmount: 0.03,
      bus: 'weapon',
      voiceCategory: 'weapon',
      voiceDuration: 0.1,
    },
    0.06,
  );
  if (!result) return;
  const { ctx, t, out } = result;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(600, t);
  osc.frequency.exponentialRampToValueAtTime(1200, t + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2000;
  osc.connect(lp).connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.08);
}
