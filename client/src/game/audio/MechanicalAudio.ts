/**
 * Mechanical audio: playReload, playEmpty, playSwitch
 */
import type { AudioCore, SpatialBusOptions, SpatialSoundOptions } from '../AudioCore';

function click(ctx: AudioContext, out: AudioNode, time: number, freq: number, dur: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = freq;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(freq * 3, 8000); // tame harsh square harmonics
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.08, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  osc.connect(lp).connect(g).connect(out);
  osc.start(time);
  osc.stop(time + dur + 0.005);
}

// ── RELOAD: Mechanical click sequence ──
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
  };

  const emitClick = (offsetSec: number, freq: number, dur: number): void => {
    const trigger = () => {
      const { ctx, t, out, delay } = core.resolveOutput(spatial, busOptions, 0.08);
      click(ctx, out, t + delay, freq, dur);
    };
    if (offsetSec <= 0) {
      trigger();
    } else {
      window.setTimeout(trigger, offsetSec * 1000);
    }
  };

  emitClick(0, 1100, 0.035);   // mag release
  emitClick(0.25, 800, 0.04);  // mag out
  emitClick(0.45, 1400, 0.05); // mag in
  emitClick(0.6, 2200, 0.03);  // chamber rack
}

// ── EMPTY CLICK ──
export function playEmpty(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out } = core.resolveOutput(
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
    },
    0.05,
  );

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

// ── WEAPON SWITCH: Quick slide sound ──
export function playSwitch(core: AudioCore, spatial?: SpatialSoundOptions): void {
  const { ctx, t, out } = core.resolveOutput(
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
    },
    0.06,
  );

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
