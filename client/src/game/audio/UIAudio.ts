/**
 * UIAudio — hover, click, deploy, navigate, error, and type sounds.
 * All non-spatial — routed through the 'ui' submix bus.
 */

import type { AudioCore } from './AudioCore';

export function playUIHover(core: AudioCore): void {
  if (core.playSampleOnBus('ui_hover', 'ui', { gain: 0.35 })) return;
  const ctx = core.ensure();
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1800; // softened from 2400 (eased off the piercing band)
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.04, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
  osc.connect(g).connect(uiBus);
  osc.start(t);
  osc.stop(t + 0.035);
}

export function playUIClick(core: AudioCore): void {
  if (core.playSampleOnBus('ui_click', 'ui', { gain: 0.5 })) return;
  const ctx = core.ensure();
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1500, t); // warmer click sweep (was 1800→2600)
  osc.frequency.exponentialRampToValueAtTime(2100, t + 0.04);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.08, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(g).connect(uiBus);
  osc.start(t);
  osc.stop(t + 0.06);
}

export function playUIDeploy(core: AudioCore): void {
  if (core.playSampleOnBus('ui_deploy', 'ui', { gain: 0.6 })) return;
  const ctx = core.ensure();
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

  // Rising sweep
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(g).connect(uiBus);
  osc.start(t);
  osc.stop(t + 0.15);

  // Harmonic ping
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 1600;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0, t);
  g2.gain.setValueAtTime(0.12, t + 0.08);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc2.connect(g2).connect(uiBus);
  osc2.start(t);
  osc2.stop(t + 0.25);
}

export function playUINavigate(core: AudioCore): void {
  if (core.playSampleOnBus('ui_navigate', 'ui', { gain: 0.5 })) return;
  const ctx = core.ensure();
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, t);
  osc.frequency.exponentialRampToValueAtTime(1400, t + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(g).connect(uiBus);
  osc.start(t);
  osc.stop(t + 0.1);
}

export function playUIError(core: AudioCore): void {
  if (core.playSampleOnBus('ui_error', 'ui', { gain: 0.5 })) return;
  const ctx = core.ensure();
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.setValueAtTime(200, t + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600; // rounds the square to a soft "bonk" (was 800)
  osc.connect(lp).connect(g).connect(uiBus);
  osc.start(t);
  osc.stop(t + 0.16);
}

export function playUIType(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  // Lowered from 3000-3600 Hz — fires rapidly while typing, so a softer,
  // lowpassed click avoids fatigue/sharpness.
  osc.frequency.value = 2200 + Math.random() * 300;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.018, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4000;
  osc.connect(lp).connect(g).connect(uiBus);
  osc.start(t);
  osc.stop(t + 0.02);
}
