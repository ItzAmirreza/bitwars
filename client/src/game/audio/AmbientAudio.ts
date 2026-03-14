/**
 * Ambient audio: startMenuAmbience, stopMenuAmbience
 */
import type { AudioCore } from '../AudioCore';

// ── AMBIENT: Menu background drone ──
export function startMenuAmbience(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;

  if (core.ambientOsc) return; // already playing

  // Deep pad
  core.ambientGain = ctx.createGain();
  core.ambientGain.gain.setValueAtTime(0, t);
  core.ambientGain.gain.linearRampToValueAtTime(0.03, t + 2);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 300;

  core.ambientOsc = ctx.createOscillator();
  core.ambientOsc.type = 'sawtooth';
  core.ambientOsc.frequency.value = 55;

  // LFO for subtle movement
  core.ambientLfo = ctx.createOscillator();
  core.ambientLfo.type = 'sine';
  core.ambientLfo.frequency.value = 0.15;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 8;
  core.ambientLfo.connect(lfoGain).connect(core.ambientOsc.frequency);

  core.ambientOsc.connect(lp).connect(core.ambientGain).connect(core.master!);
  core.ambientOsc.start(t);
  core.ambientLfo.start(t);
}

export function stopMenuAmbience(core: AudioCore): void {
  if (!core.ctx) return;
  const t = core.ctx.currentTime;

  if (core.ambientGain) {
    core.ambientGain.gain.linearRampToValueAtTime(0, t + 0.5);
  }
  setTimeout(() => {
    core.ambientOsc?.stop();
    core.ambientLfo?.stop();
    core.ambientOsc = null;
    core.ambientLfo = null;
    core.ambientGain = null;
  }, 600);
}
