/**
 * MovementAudio — footsteps, jump, landing, and slide sounds.
 */

import type { AudioCore, SpatialSoundOptions, SpatialBusOptions } from './AudioCore';

/** Tracks left/right foot alternation across calls. */
let stepIndex = 0;

export function playStep(core: AudioCore, sprinting = false, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out } = core.resolveOutput(
    spatial,
    {
      gain: 1,
      minDistance: 1.5,
      maxDistance: 45,
      rolloff: 2.2,
      coneInner: 360,
      coneOuter: 360,
      coneOuterGain: 1,
      occlusionStrength: 0.95,
      baseLowpass: 3500,
      reverbAmount: 0.08,
    },
    0.12,
  );

  stepIndex++;
  const footPitch = stepIndex % 2 === 0 ? 1.04 : 0.96;
  const variation = 0.92 + Math.random() * 0.16;
  const baseVol = sprinting ? 0.04 : 0.025;

  // ── Layer 1: Heel strike ──
  const heel = ctx.createBufferSource();
  const heelLen = sprinting ? 0.07 : 0.08;
  heel.buffer = core.noise(heelLen, 0.45);
  heel.playbackRate.value = footPitch * variation;
  const heelLp = ctx.createBiquadFilter();
  heelLp.type = 'lowpass';
  heelLp.frequency.value = (sprinting ? 350 : 280) * variation;
  heelLp.Q.value = 0.5;
  const heelGain = ctx.createGain();
  heelGain.gain.setValueAtTime(0, t);
  heelGain.gain.linearRampToValueAtTime(baseVol * 0.8, t + 0.005);
  heelGain.gain.linearRampToValueAtTime(baseVol * 0.35, t + 0.025);
  heelGain.gain.exponentialRampToValueAtTime(0.001, t + heelLen);
  heel.connect(heelLp).connect(heelGain).connect(out);
  heel.start(t);
  heel.stop(t + heelLen);

  // ── Layer 2: Scuff / sole scrape ──
  const scuff = ctx.createBufferSource();
  const scuffLen = sprinting ? 0.05 : 0.06;
  scuff.buffer = core.noise(scuffLen, 0.5);
  scuff.playbackRate.value = (0.9 + Math.random() * 0.2) * footPitch;
  const scuffBp = ctx.createBiquadFilter();
  scuffBp.type = 'lowpass';
  scuffBp.frequency.value = (sprinting ? 900 : 700) * variation;
  scuffBp.Q.value = 0.25;
  const scuffHp = ctx.createBiquadFilter();
  scuffHp.type = 'highpass';
  scuffHp.frequency.value = 250;
  scuffHp.Q.value = 0.25;
  const scuffGain = ctx.createGain();
  const scuffVol = baseVol * (sprinting ? 0.3 : 0.2);
  scuffGain.gain.setValueAtTime(0, t);
  scuffGain.gain.linearRampToValueAtTime(scuffVol, t + 0.01);
  scuffGain.gain.exponentialRampToValueAtTime(0.001, t + scuffLen);
  scuff.connect(scuffHp).connect(scuffBp).connect(scuffGain).connect(out);
  scuff.start(t);
  scuff.stop(t + scuffLen);

  // ── Layer 3: Subtle crunch ──
  const crunch = ctx.createBufferSource();
  crunch.buffer = core.noise(0.025, 0.15);
  crunch.playbackRate.value = (0.85 + Math.random() * 0.3) * footPitch;
  const crunchBp = ctx.createBiquadFilter();
  crunchBp.type = 'bandpass';
  crunchBp.frequency.value = (sprinting ? 1200 : 900) * variation;
  crunchBp.Q.value = 0.25;
  const crunchGain = ctx.createGain();
  crunchGain.gain.setValueAtTime(baseVol * 0.1, t);
  crunchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
  crunch.connect(crunchBp).connect(crunchGain).connect(out);
  crunch.start(t);
  crunch.stop(t + 0.025);

  // ── Sprint extra: Second impact from toe push-off ──
  if (sprinting) {
    const toe = ctx.createBufferSource();
    toe.buffer = core.noise(0.04, 0.4);
    toe.playbackRate.value = footPitch * (1.05 + Math.random() * 0.1);
    const toeLp = ctx.createBiquadFilter();
    toeLp.type = 'lowpass';
    toeLp.frequency.value = 450 * variation;
    toeLp.Q.value = 0.4;
    const toeGain = ctx.createGain();
    toeGain.gain.setValueAtTime(0, t + 0.03);
    toeGain.gain.linearRampToValueAtTime(baseVol * 0.25, t + 0.038);
    toeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    toe.connect(toeLp).connect(toeGain).connect(out);
    toe.start(t + 0.03);
    toe.stop(t + 0.08);
  }
}

export function playJump(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out } = core.resolveOutput(
    spatial,
    {
      gain: 1,
      minDistance: 1.6,
      maxDistance: 85,
      rolloff: 1.75,
      coneInner: 360,
      coneOuter: 360,
      coneOuterGain: 1,
      occlusionStrength: 0.9,
      baseLowpass: 10500,
      reverbAmount: 0.05,
    },
    0.1,
  );

  // ── Ascending frequency sweep ──
  const sweep = ctx.createOscillator();
  sweep.type = 'sawtooth';
  sweep.frequency.setValueAtTime(80, t);
  sweep.frequency.exponentialRampToValueAtTime(300, t + 0.1);
  const sweepLp = ctx.createBiquadFilter();
  sweepLp.type = 'lowpass';
  sweepLp.frequency.setValueAtTime(400, t);
  sweepLp.frequency.exponentialRampToValueAtTime(800, t + 0.1);
  const sweepGain = ctx.createGain();
  sweepGain.gain.setValueAtTime(0.06, t);
  sweepGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  sweep.connect(sweepLp).connect(sweepGain).connect(out);
  sweep.start(t);
  sweep.stop(t + 0.1);

  // ── Noise whoosh layer ──
  const whoosh = ctx.createBufferSource();
  whoosh.buffer = core.noise(0.1, 0.2);
  const whooshBp = ctx.createBiquadFilter();
  whooshBp.type = 'bandpass';
  whooshBp.frequency.setValueAtTime(600, t);
  whooshBp.frequency.exponentialRampToValueAtTime(1500, t + 0.08);
  whooshBp.Q.value = 0.6;
  const whooshGain = ctx.createGain();
  whooshGain.gain.setValueAtTime(0.05, t);
  whooshGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  whoosh.connect(whooshBp).connect(whooshGain).connect(out);
  whoosh.start(t);
  whoosh.stop(t + 0.1);

  // ── Subtle gear/fabric rustle ──
  const rustle = ctx.createBufferSource();
  rustle.buffer = core.noise(0.06, 0.12);
  const rustleBp = ctx.createBiquadFilter();
  rustleBp.type = 'bandpass';
  rustleBp.frequency.value = 3500 + Math.random() * 1000;
  rustleBp.Q.value = 0.8;
  const rustleGain = ctx.createGain();
  rustleGain.gain.setValueAtTime(0.03, t);
  rustleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  rustle.connect(rustleBp).connect(rustleGain).connect(out);
  rustle.start(t);
  rustle.stop(t + 0.06);
}

export function playLanding(core: AudioCore, intensity: number, spatial?: SpatialSoundOptions): void {
  const busOptions: SpatialBusOptions = {
    gain: 1,
    minDistance: 1.7,
    maxDistance: 55,
    rolloff: 2.0,
    coneInner: 360,
    coneOuter: 360,
    coneOuterGain: 1,
    occlusionStrength: 0.95,
    baseLowpass: 3500,
    reverbAmount: 0.08,
  };
  const { ctx, t, out } = core.resolveOutput(spatial, busOptions, 0.15);
  const vol = 0.03 + intensity * 0.07;

  // ── Boot-slap transient ──
  const slap = ctx.createBufferSource();
  slap.buffer = core.noise(0.04, 0.18);
  const slapBp = ctx.createBiquadFilter();
  slapBp.type = 'bandpass';
  slapBp.frequency.value = 600 + intensity * 300;
  slapBp.Q.value = 0.35;
  const slapGain = ctx.createGain();
  slapGain.gain.setValueAtTime(0, t);
  slapGain.gain.linearRampToValueAtTime(vol * 0.4, t + 0.002);
  slapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  slap.connect(slapBp).connect(slapGain).connect(out);
  slap.start(t);
  slap.stop(t + 0.04);

  // ── Impact body ──
  const src = ctx.createBufferSource();
  src.buffer = core.noise(0.15, 0.25);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 180 + intensity * 220;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol * 0.7, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  src.connect(lp).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.15);

  // ── Sub-bass thump ──
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  const subFreq = 55 + (1 - intensity) * 15;
  sub.frequency.setValueAtTime(subFreq, t);
  sub.frequency.exponentialRampToValueAtTime(subFreq * 0.6, t + 0.08);
  const sg = ctx.createGain();
  const subVol = vol * (0.15 + intensity * 0.2);
  sg.gain.setValueAtTime(0, t);
  sg.gain.linearRampToValueAtTime(subVol, t + 0.003);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  sub.connect(sg).connect(out);
  sub.start(t);
  sub.stop(t + 0.08);

  // ── Gear rattle for heavy landings ──
  if (intensity > 0.55) {
    const rattleVol = (intensity - 0.55) * 0.03;
    core.scheduleSpatialLayer(spatial, busOptions, 0.15, 0.05, (lateCtx, lateT, lateOut) => {
      const rattle = lateCtx.createBufferSource();
      rattle.buffer = core.noise(0.06, 0.25);
      const rattleBp = lateCtx.createBiquadFilter();
      rattleBp.type = 'bandpass';
      rattleBp.frequency.value = 1200 + Math.random() * 500;
      rattleBp.Q.value = 0.3;
      const rattleGain = lateCtx.createGain();
      rattleGain.gain.setValueAtTime(rattleVol, lateT);
      rattleGain.gain.exponentialRampToValueAtTime(0.001, lateT + 0.06);
      rattle.connect(rattleBp).connect(rattleGain).connect(lateOut);
      rattle.start(lateT);
      rattle.stop(lateT + 0.06);
    });
  }
}

export function playSlideStart(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out } = core.resolveOutput(
    spatial,
    {
      gain: 1,
      minDistance: 1.7,
      maxDistance: 95,
      rolloff: 1.7,
      coneInner: 360,
      coneOuter: 360,
      coneOuterGain: 1,
      occlusionStrength: 1,
      baseLowpass: 7600,
      reverbAmount: 0.06,
    },
    0.12,
  );

  // ── Initial skid transient ──
  const skid = ctx.createBufferSource();
  skid.buffer = core.noise(0.04, 0.1);
  const skidBp = ctx.createBiquadFilter();
  skidBp.type = 'bandpass';
  skidBp.frequency.value = 1200 + Math.random() * 400;
  skidBp.Q.value = 1.5;
  const skidGain = ctx.createGain();
  skidGain.gain.setValueAtTime(0.15, t);
  skidGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  skid.connect(skidBp).connect(skidGain).connect(out);
  skid.start(t);
  skid.stop(t + 0.04);

  // ── Low-frequency rumble ──
  const rumble = ctx.createBufferSource();
  rumble.buffer = core.noise(0.35, 0.25);
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = 'lowpass';
  rumbleLp.frequency.setValueAtTime(350, t);
  rumbleLp.frequency.exponentialRampToValueAtTime(80, t + 0.3);
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0.14, t);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  rumble.connect(rumbleLp).connect(rumbleGain).connect(out);
  rumble.start(t);
  rumble.stop(t + 0.35);

  // ── Sub oscillator ──
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(60, t);
  sub.frequency.exponentialRampToValueAtTime(30, t + 0.25);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.10, t);
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  sub.connect(subGain).connect(out);
  sub.start(t);
  sub.stop(t + 0.25);

  // ── Fabric scraping ──
  const fabric = ctx.createBufferSource();
  fabric.buffer = core.noise(0.3, 0.35);
  const fabricBp = ctx.createBiquadFilter();
  fabricBp.type = 'bandpass';
  fabricBp.frequency.value = 4000 + Math.random() * 1000;
  fabricBp.Q.value = 0.5;
  const fabricGain = ctx.createGain();
  fabricGain.gain.setValueAtTime(0.04, t);
  fabricGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  fabric.connect(fabricBp).connect(fabricGain).connect(out);
  fabric.start(t);
  fabric.stop(t + 0.3);
}
