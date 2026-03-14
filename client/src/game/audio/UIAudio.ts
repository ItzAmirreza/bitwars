/**
 * UI audio: playUIHover, playUIClick, playUIDeploy, playUINavigate, playUIError, playUIType
 */
import type { AudioCore } from '../AudioCore';

// ── UI: Hover tick ──
export function playUIHover(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 2400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.04, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  osc.connect(g).connect(core.master!);
  osc.start(t);
  osc.stop(t + 0.03);
}

// ── UI: Click / select ──
export function playUIClick(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1800, t);
  osc.frequency.exponentialRampToValueAtTime(2600, t + 0.04);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.08, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(g).connect(core.master!);
  osc.start(t);
  osc.stop(t + 0.06);
}

// ── UI: Deploy / confirm action ──
export function playUIDeploy(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;

  // Rising sweep
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(g).connect(core.master!);
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
  osc2.connect(g2).connect(core.master!);
  osc2.start(t);
  osc2.stop(t + 0.25);
}

// ── UI: Navigate / screen transition ──
export function playUINavigate(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, t);
  osc.frequency.exponentialRampToValueAtTime(1400, t + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  osc.connect(g).connect(core.master!);
  osc.start(t);
  osc.stop(t + 0.1);
}

// ── UI: Error / denied ──
export function playUIError(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.setValueAtTime(200, t + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 800;
  osc.connect(lp).connect(g).connect(core.master!);
  osc.start(t);
  osc.stop(t + 0.16);
}

// ── UI: Type keystroke ──
export function playUIType(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 3000 + Math.random() * 600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.02, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
  osc.connect(g).connect(core.master!);
  osc.start(t);
  osc.stop(t + 0.02);
}
