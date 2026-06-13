/**
 * Rifle — procedural fire sound (weapon index 0).
 *
 * Specifies VoiceCategory + AudioBusName + voiceDuration so AudioCore can cull
 * distant sounds, enforce polyphony limits, route through the correct submix
 * bus, and clean up nodes automatically.
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from '../AudioCore';

export function playRifle(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 2.4,
    maxDistance: 160,
    rolloff: 1.35,
    coneInner: 95,
    coneOuter: 230,
    coneOuterGain: 0.2,
    occlusionStrength: 0.9,
    baseLowpass: 14500,
    reverbAmount: 0.1,
    bus: 'weapon',
    voiceCategory: 'weapon',
    voiceDuration: 0.15,
  };
  // Real sample first; fall back to procedural synth below if not loaded.
  if (core.playSample('weapon_rifle', spatial, busOptions, { gain: 0.85, pitchVary: 0.05, gainVary: 0.1 })) return;

  const result = core.resolveOutput(spatial, busOptions, 0.22);
  if (!result) return;
  const { ctx, t, out, delay } = result;
  const t0 = t + delay;

  // Initial transient crack
  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.1, 0.12);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2500;
  bp.Q.value = 1.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.35, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
  src.connect(bp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.11);

  // Low-end punch
  const punch = ctx.createOscillator();
  punch.type = 'sine';
  punch.frequency.setValueAtTime(180, t0);
  punch.frequency.exponentialRampToValueAtTime(60, t0 + 0.05);
  const pg = ctx.createGain();
  pg.gain.setValueAtTime(0.16, t0);
  pg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  punch.connect(pg).connect(out);
  punch.start(t0);
  punch.stop(t0 + 0.06);

  // Metallic ping (softened from 4500→3000 / 0.07 — was the harshest per-shot element)
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(3600, t0);
  osc.frequency.exponentialRampToValueAtTime(2600, t0 + 0.06);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.05, t0);
  og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
  osc.connect(og).connect(out);
  osc.start(t0);
  osc.stop(t0 + 0.07);

  // Shell casing tinkle (delayed, tracks moving source)
  core.scheduleSpatialLayer(spatial, busOptions, 0.22, 0.08, (lateCtx, lateT, lateOut) => {
    const casing = lateCtx.createOscillator();
    casing.type = 'sine';
    // Lowered from 6-7 kHz "tinkle fizz" to a softer 4.5-5.3 kHz casing.
    casing.frequency.setValueAtTime(4500 + Math.random() * 800, lateT);
    const cg = lateCtx.createGain();
    cg.gain.setValueAtTime(0.025, lateT);
    cg.gain.exponentialRampToValueAtTime(0.001, lateT + 0.04);
    casing.connect(cg).connect(lateOut);
    casing.start(lateT);
    casing.stop(lateT + 0.04);
  });
}
