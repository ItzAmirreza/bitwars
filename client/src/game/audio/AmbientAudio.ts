/**
 * AmbientAudio — menu background ambience.
 * Fixed race condition: uses a state flag instead of relying on nulling
 * the oscillator reference inside a delayed setTimeout callback.
 */

import type { AudioCore } from './AudioCore';

// ── Persistent ambient state ──

let ambientOsc: OscillatorNode | null = null;
let ambientGain: GainNode | null = null;
let ambientLfo: OscillatorNode | null = null;
/** Guards against the start-during-stop race condition. */
let ambientState: 'stopped' | 'playing' | 'stopping' = 'stopped';
let stopTimer: ReturnType<typeof setTimeout> | null = null;

export function startMenuAmbience(core: AudioCore): void {
  // If we're in the middle of stopping, cancel the stop and restart.
  if (ambientState === 'stopping') {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    // Kill old oscillators immediately so we can start fresh.
    try { ambientOsc?.stop(); } catch { /* ok */ }
    try { ambientLfo?.stop(); } catch { /* ok */ }
    ambientOsc = null;
    ambientLfo = null;
    ambientGain = null;
    ambientState = 'stopped';
  }

  if (ambientState === 'playing') return; // already playing

  const ctx = core.ensure();
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

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

  ambientOsc.connect(lp).connect(ambientGain).connect(uiBus);
  ambientOsc.start(t);
  ambientLfo.start(t);

  ambientState = 'playing';
}

export function stopMenuAmbience(core: AudioCore): void {
  if (ambientState !== 'playing' || !core.ctx) return;
  ambientState = 'stopping';
  const t = core.ctx.currentTime;

  if (ambientGain) {
    ambientGain.gain.linearRampToValueAtTime(0, t + 0.5);
  }

  stopTimer = setTimeout(() => {
    stopTimer = null;
    try { ambientOsc?.stop(); } catch { /* ok */ }
    try { ambientLfo?.stop(); } catch { /* ok */ }
    ambientOsc = null;
    ambientLfo = null;
    ambientGain = null;
    ambientState = 'stopped';
  }, 600);
}
