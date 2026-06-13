/**
 * AmbientAudio — menu background music / ambience.
 *
 * Prefers a real, looping CC0 music track (`music_menu` sample) for a warm,
 * non-synthetic menu bed. If that sample hasn't decoded (or is missing), it
 * falls back to a gentle procedural A-minor pad so the menu is never silent.
 *
 * A state flag guards the start-during-stop race (instead of relying on nulling
 * refs inside a delayed setTimeout callback).
 */

import type { AudioCore } from './AudioCore';

const MUSIC_LEVEL = 0.5; // looping track gain
const PAD_LEVEL = 0.05;  // procedural fallback pad gain

// Procedural fallback pad chord (A minor, low-warm register).
const PAD_VOICES: ReadonlyArray<{
  freq: number;
  type: OscillatorType;
  detune: number;
  gain: number;
}> = [
  { freq: 110.0,  type: 'triangle', detune: -4, gain: 0.45 }, // A2 root
  { freq: 110.0,  type: 'sine',     detune: 5,  gain: 0.30 }, // A2 root double
  { freq: 164.81, type: 'triangle', detune: -3, gain: 0.28 }, // E3 fifth
  { freq: 220.0,  type: 'triangle', detune: 4,  gain: 0.20 }, // A3 octave
  { freq: 261.63, type: 'sine',     detune: 2,  gain: 0.12 }, // C4 minor third
];

// ── Persistent ambient state ──

let musicSource: AudioBufferSourceNode | null = null;
let ambientOscs: OscillatorNode[] = [];
let ambientGain: GainNode | null = null;
let ambientState: 'stopped' | 'playing' | 'stopping' = 'stopped';
let stopTimer: ReturnType<typeof setTimeout> | null = null;

function teardownNodes(): void {
  for (const osc of ambientOscs) {
    try { osc.stop(); } catch { /* ok */ }
  }
  ambientOscs = [];
  if (musicSource) {
    try { musicSource.stop(); } catch { /* ok */ }
    musicSource = null;
  }
  ambientGain = null;
}

export function startMenuAmbience(core: AudioCore): void {
  // If mid-stop, cancel and restart fresh.
  if (ambientState === 'stopping') {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    teardownNodes();
    ambientState = 'stopped';
  }

  if (ambientState === 'playing') return;

  const ctx = core.ensure();
  ambientState = 'playing';

  // Prefer the real looping track; the sample may still be decoding, so wait on
  // the (idempotent) load. Fall back to the procedural pad if it isn't available.
  void core.samples.load(ctx).then(() => {
    if (ambientState !== 'playing') return;       // user already left the menu
    if (musicSource || ambientOscs.length) return; // already started
    const buf = core.samples.get('music_menu');
    if (buf) startMusicLoop(core, ctx, buf);
    else startProceduralPad(core, ctx);
  });
}

function startMusicLoop(core: AudioCore, ctx: AudioContext, buf: AudioBuffer): void {
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(MUSIC_LEVEL, t + 2.5); // gentle fade-in
  g.connect(core.getBus('ui'));

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(g);
  src.start(t);

  musicSource = src;
  ambientGain = g;
}

function startProceduralPad(core: AudioCore, ctx: AudioContext): void {
  const t = ctx.currentTime;
  const uiBus = core.getBus('ui');

  const padGain = ctx.createGain();
  padGain.gain.setValueAtTime(0, t);
  padGain.gain.linearRampToValueAtTime(PAD_LEVEL, t + 3);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  lp.Q.value = 0.5;
  lp.connect(padGain).connect(uiBus);

  const padBus = ctx.createGain();
  padBus.gain.value = 1;
  padBus.connect(lp);

  for (const voice of PAD_VOICES) {
    const osc = ctx.createOscillator();
    osc.type = voice.type;
    osc.frequency.value = voice.freq;
    osc.detune.value = voice.detune;
    const vg = ctx.createGain();
    vg.gain.value = voice.gain;
    osc.connect(vg).connect(padBus);
    osc.start(t);
    ambientOscs.push(osc);
  }

  // Slow filter "breathing" + subtle tremolo at incommensurate rates.
  const filtLfo = ctx.createOscillator();
  filtLfo.type = 'sine';
  filtLfo.frequency.value = 0.05;
  const filtLfoGain = ctx.createGain();
  filtLfoGain.gain.value = 350;
  filtLfo.connect(filtLfoGain).connect(lp.frequency);
  filtLfo.start(t);
  ambientOscs.push(filtLfo);

  const ampLfo = ctx.createOscillator();
  ampLfo.type = 'sine';
  ampLfo.frequency.value = 0.07;
  const ampLfoGain = ctx.createGain();
  ampLfoGain.gain.value = 0.004;
  ampLfo.connect(ampLfoGain).connect(padGain.gain);
  ampLfo.start(t);
  ambientOscs.push(ampLfo);

  ambientGain = padGain;
}

export function stopMenuAmbience(core: AudioCore): void {
  if (ambientState !== 'playing' || !core.ctx) return;
  ambientState = 'stopping';
  const t = core.ctx.currentTime;

  if (ambientGain) {
    ambientGain.gain.cancelScheduledValues(t);
    ambientGain.gain.setValueAtTime(ambientGain.gain.value, t);
    ambientGain.gain.linearRampToValueAtTime(0, t + 2); // smooth release
  }

  stopTimer = setTimeout(() => {
    stopTimer = null;
    teardownNodes();
    ambientState = 'stopped';
  }, 2100);
}
