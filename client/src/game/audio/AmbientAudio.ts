/**
 * AmbientAudio — menu background ambience.
 */

import type { AudioCore } from './AudioCore';

// ── Persistent ambient state ──

let ambientOsc: OscillatorNode | null = null;
let ambientGain: GainNode | null = null;
let ambientLfo: OscillatorNode | null = null;

export function startMenuAmbience(core: AudioCore): void {
  const ctx = core.ensure();
  const t = ctx.currentTime;

  if (ambientOsc) return; // already playing

  // Deep pad
  ambientGain = ctx.createGain();
  ambientGain.gain.setValueAtTime(0, t);
  ambientGain.gain.linearRampToValueAtTime(0.03, t + 2);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 300;

  ambientOsc = ctx.createOscillator();
  ambientOsc.type = 'sawtooth';
  ambientOsc.frequency.value = 55;

  // LFO for subtle movement
  ambientLfo = ctx.createOscillator();
  ambientLfo.type = 'sine';
  ambientLfo.frequency.value = 0.15;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 8;
  ambientLfo.connect(lfoGain).connect(ambientOsc.frequency);

  ambientOsc.connect(lp).connect(ambientGain).connect(core.master!);
  ambientOsc.start(t);
  ambientLfo.start(t);
}

export function stopMenuAmbience(core: AudioCore): void {
  if (!core.ctx) return;
  const t = core.ctx.currentTime;

  if (ambientGain) {
    ambientGain.gain.linearRampToValueAtTime(0, t + 0.5);
  }
  setTimeout(() => {
    ambientOsc?.stop();
    ambientLfo?.stop();
    ambientOsc = null;
    ambientLfo = null;
    ambientGain = null;
  }, 600);
}
