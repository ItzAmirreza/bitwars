/**
 * VehicleAudio — persistent spatial engine loops for vehicles.
 * Helicopter: rotor chop + engine drone + tail rotor + wind
 * Fighter Jet: turbine whine + broadband roar + afterburner scaling
 */

import type { AudioCore, Vec3Like, HeliSoundNodes } from './AudioCore';

// ── Shared state ──

const heliSounds = new Map<number, HeliSoundNodes>();
let helicopterNoiseBuffer: AudioBuffer | null = null;

function getOrCreateNoiseBuffer(core: AudioCore): AudioBuffer {
  if (helicopterNoiseBuffer) return helicopterNoiseBuffer;
  const ctx = core.ensure();
  const sr = ctx.sampleRate;
  const len = sr * 2; // 2-second loop
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  helicopterNoiseBuffer = buf;
  return buf;
}

// ── Public API ──

export function startHelicopterSound(core: AudioCore, id: number): void {
  const existing = heliSounds.get(id);
  if (existing) {
    if (!existing.stopping) return; // genuinely running — nothing to do
    // Old sound is fading out (e.g. after map reset); kill it immediately
    // so we can start a fresh one.
    if (existing.stopTimer) clearTimeout(existing.stopTimer);
    cleanupHeliSound(id);
  }
  const ctx = core.ensure();
  const t = ctx.currentTime;
  const noiseBuf = getOrCreateNoiseBuffer(core);
  const allSources: (AudioBufferSourceNode | OscillatorNode)[] = [];

  // ── Layer 1: Blade Chop ──
  const chopSrc = ctx.createBufferSource();
  chopSrc.buffer = noiseBuf;
  chopSrc.loop = true;
  allSources.push(chopSrc);

  const chopBp = ctx.createBiquadFilter();
  chopBp.type = 'bandpass';
  chopBp.frequency.value = 100;
  chopBp.Q.value = 0.7;

  const chopAmGain = ctx.createGain();
  chopAmGain.gain.value = 0.35;

  const chopLfo = ctx.createOscillator();
  chopLfo.type = 'sine';
  chopLfo.frequency.value = 6;
  allSources.push(chopLfo);

  const chopLfoGain = ctx.createGain();
  chopLfoGain.gain.value = 0.35;

  chopLfo.connect(chopLfoGain).connect(chopAmGain.gain);

  const chopOutput = ctx.createGain();
  chopOutput.gain.value = 0.14;

  chopSrc.connect(chopBp).connect(chopAmGain).connect(chopOutput);

  // ── Layer 2: Engine Drone ──
  const engineOsc1 = ctx.createOscillator();
  engineOsc1.type = 'sine';
  engineOsc1.frequency.value = 80;
  allSources.push(engineOsc1);

  const engineOsc2 = ctx.createOscillator();
  engineOsc2.type = 'triangle';
  engineOsc2.frequency.value = 82;
  allSources.push(engineOsc2);

  const engineLp = ctx.createBiquadFilter();
  engineLp.type = 'lowpass';
  engineLp.frequency.value = 220;

  const engineGain = ctx.createGain();
  engineGain.gain.value = 0.07;

  const engineMerge = ctx.createGain();
  engineMerge.gain.value = 0.5;
  engineOsc1.connect(engineMerge);
  engineOsc2.connect(engineMerge);
  engineMerge.connect(engineLp).connect(engineGain);

  // ── Layer 3: Tail Rotor ──
  const tailOsc = ctx.createOscillator();
  tailOsc.type = 'sawtooth';
  tailOsc.frequency.value = 340;
  allSources.push(tailOsc);

  const tailLp = ctx.createBiquadFilter();
  tailLp.type = 'lowpass';
  tailLp.frequency.value = 800;

  const tailGain = ctx.createGain();
  tailGain.gain.value = 0.015;

  tailOsc.connect(tailLp).connect(tailGain);

  // ── Layer 4: Wind Noise ──
  const windSrc = ctx.createBufferSource();
  windSrc.buffer = noiseBuf;
  windSrc.loop = true;
  allSources.push(windSrc);

  const windBp = ctx.createBiquadFilter();
  windBp.type = 'bandpass';
  windBp.frequency.value = 600;
  windBp.Q.value = 0.4;

  const windGain = ctx.createGain();
  windGain.gain.value = 0;

  windSrc.connect(windBp).connect(windGain);

  // ── Output chain ──
  const mixGain = ctx.createGain();
  mixGain.gain.setValueAtTime(0, t);
  mixGain.gain.linearRampToValueAtTime(0.13, t + 1.5);

  chopOutput.connect(mixGain);
  engineGain.connect(mixGain);
  tailGain.connect(mixGain);
  windGain.connect(mixGain);

  const outputFilter = ctx.createBiquadFilter();
  outputFilter.type = 'lowpass';
  outputFilter.frequency.value = 4500;

  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 18;
  panner.maxDistance = 100;
  panner.rolloffFactor = 1.8;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;

  mixGain.connect(outputFilter).connect(panner).connect(core.getBus('vehicle'));

  // Start all sources
  chopSrc.start(t);
  chopLfo.start(t);
  engineOsc1.start(t);
  engineOsc2.start(t);
  tailOsc.start(t);
  windSrc.start(t);

  heliSounds.set(id, {
    chopLfo, chopOutput,
    engineOsc1, engineOsc2, engineGain,
    tailOsc, tailGain,
    windFilter: windBp, windGain,
    mixGain, outputFilter, panner,
    allSources,
    wasLocal: false,
    stopping: false,
    stopTimer: null,
  });
}

export function updateHelicopterSound(
  core: AudioCore,
  id: number,
  position: Vec3Like,
  spinRate: number,
  speed: number,
  isLocal: boolean,
  apparentPosition?: Vec3Like,
  propagationOcclusion?: number,
): void {
  const nodes = heliSounds.get(id);
  if (!nodes || nodes.stopping || !core.ctx) return;
  const t = core.ctx.currentTime;

  // ── Blade-pass frequency ──
  const bladePassHz = (spinRate / (2 * Math.PI)) * 4;
  nodes.chopLfo.frequency.setTargetAtTime(
    Math.max(0.5, bladePassHz), t, 0.08,
  );

  const chopVol = 0.08 + Math.min(spinRate / 18, 1) * 0.10;
  nodes.chopOutput.gain.setTargetAtTime(chopVol, t, 0.15);

  // ── Engine drone pitch ──
  const engineBase = 72 + spinRate * 0.8;
  nodes.engineOsc1.frequency.setTargetAtTime(engineBase, t, 0.15);
  nodes.engineOsc2.frequency.setTargetAtTime(engineBase * 1.025, t, 0.15);

  const engineVol = 0.05 + Math.min(spinRate / 18, 1) * 0.04;
  nodes.engineGain.gain.setTargetAtTime(engineVol, t, 0.2);

  // ── Tail rotor ──
  const tailFreq = 240 + spinRate * 10;
  nodes.tailOsc.frequency.setTargetAtTime(tailFreq, t, 0.1);
  const tailVol = 0.010 + Math.min(spinRate / 18, 1) * 0.012;
  nodes.tailGain.gain.setTargetAtTime(tailVol, t, 0.15);

  // ── Wind noise ──
  const windAmount = Math.min(1, speed / 30);
  nodes.windGain.gain.setTargetAtTime(windAmount * 0.05, t, 0.25);
  nodes.windFilter.frequency.setTargetAtTime(500 + windAmount * 900, t, 0.2);

  // ── Local vs remote tonal adjustment ──
  if (isLocal !== nodes.wasLocal) {
    nodes.wasLocal = isLocal;
    const cutoff = isLocal ? 1800 : 4500;
    const vol = isLocal ? 0.10 : 0.13;
    nodes.outputFilter.frequency.setTargetAtTime(cutoff, t, 0.3);
    nodes.mixGain.gain.setTargetAtTime(vol, t, 0.3);
  }

  // ── Panner position: use apparent position if available (sound propagation) ──
  core.setPannerPosition(nodes.panner, apparentPosition ?? position, t);

  // ── Propagation occlusion: muffle the sound when it travels through walls ──
  if (propagationOcclusion !== undefined && propagationOcclusion > 0.01) {
    // Lower the output filter cutoff to simulate muffling through walls/openings
    const baseCutoff = nodes.wasLocal ? 1800 : 4500;
    const occludedCutoff = baseCutoff * (1 - propagationOcclusion * 0.7);
    nodes.outputFilter.frequency.setTargetAtTime(Math.max(200, occludedCutoff), t, 0.1);
    // Reduce volume slightly for heavily occluded sources
    const baseVol = nodes.wasLocal ? 0.10 : 0.13;
    const occludedVol = baseVol * (1 - propagationOcclusion * 0.4);
    nodes.mixGain.gain.setTargetAtTime(occludedVol, t, 0.15);
  }
}

export function stopHelicopterSound(core: AudioCore, id: number, destroyed = false): void {
  const nodes = heliSounds.get(id);
  if (!nodes || nodes.stopping) return;
  nodes.stopping = true;
  if (!core.ctx) {
    heliSounds.delete(id);
    return;
  }
  const t = core.ctx.currentTime;

  if (destroyed) {
    const fadeTime = 0.6;
    nodes.chopLfo.frequency.setTargetAtTime(0.8, t, 0.12);
    nodes.engineOsc1.frequency.setTargetAtTime(40, t, 0.15);
    nodes.engineOsc2.frequency.setTargetAtTime(41, t, 0.15);
    nodes.tailOsc.frequency.setTargetAtTime(120, t, 0.1);
    nodes.mixGain.gain.setTargetAtTime(0, t, 0.15);
    nodes.stopTimer = setTimeout(() => {
      cleanupHeliSound(id);
    }, fadeTime * 1000);
  } else {
    const fadeTime = 0.8;
    nodes.mixGain.gain.setTargetAtTime(0, t, 0.2);
    nodes.stopTimer = setTimeout(() => {
      cleanupHeliSound(id);
    }, fadeTime * 1000);
  }
}

function cleanupHeliSound(id: number): void {
  const nodes = heliSounds.get(id);
  if (!nodes) return;
  for (const src of nodes.allSources) {
    try { src.stop(); } catch { /* already stopped */ }
    src.disconnect();
  }
  nodes.mixGain.disconnect();
  nodes.outputFilter.disconnect();
  nodes.panner.disconnect();
  heliSounds.delete(id);
}

/** Called by AudioSystem.dispose() to clean up all helicopter sounds. */
export function disposeAllHelicopterSounds(): void {
  for (const id of Array.from(heliSounds.keys())) {
    const nodes = heliSounds.get(id);
    if (nodes?.stopTimer) clearTimeout(nodes.stopTimer);
    cleanupHeliSound(id);
  }
  heliSounds.clear();
  helicopterNoiseBuffer = null;
}

// ══════════════════════════════════════════════════════════════
//  FIGHTER JET ENGINE SOUND
// ══════════════════════════════════════════════════════════════

interface JetSoundNodes {
  turbineOsc: OscillatorNode;
  turbineGain: GainNode;
  roarSrc: AudioBufferSourceNode;
  roarBp: BiquadFilterNode;
  roarGain: GainNode;
  mixGain: GainNode;
  outputFilter: BiquadFilterNode;
  panner: PannerNode;
  allSources: (AudioBufferSourceNode | OscillatorNode)[];
  wasLocal: boolean;
  stopping: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

const jetSounds = new Map<number, JetSoundNodes>();
let jetNoiseBuffer: AudioBuffer | null = null;

function getOrCreateJetNoiseBuffer(core: AudioCore): AudioBuffer {
  if (jetNoiseBuffer) return jetNoiseBuffer;
  const ctx = core.ensure();
  const sr = ctx.sampleRate;
  const len = sr * 2;
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  jetNoiseBuffer = buf;
  return buf;
}

export function startJetEngineSound(core: AudioCore, id: number): void {
  const existing = jetSounds.get(id);
  if (existing) {
    if (!existing.stopping) return;
    if (existing.stopTimer) clearTimeout(existing.stopTimer);
    cleanupJetSound(id);
  }
  const ctx = core.ensure();
  const t = ctx.currentTime;
  const noiseBuf = getOrCreateJetNoiseBuffer(core);
  const allSources: (AudioBufferSourceNode | OscillatorNode)[] = [];

  // ── Layer 1: Turbine Whine (triangle wave, ~200Hz) ──
  const turbineOsc = ctx.createOscillator();
  turbineOsc.type = 'triangle';
  turbineOsc.frequency.value = 200;
  allSources.push(turbineOsc);

  const turbineGain = ctx.createGain();
  turbineGain.gain.value = 0.06;

  turbineOsc.connect(turbineGain);

  // ── Layer 2: Broadband Jet Roar (filtered noise) ──
  const roarSrc = ctx.createBufferSource();
  roarSrc.buffer = noiseBuf;
  roarSrc.loop = true;
  allSources.push(roarSrc);

  const roarBp = ctx.createBiquadFilter();
  roarBp.type = 'highpass';
  roarBp.frequency.value = 400;
  roarBp.Q.value = 0.5;

  const roarGain = ctx.createGain();
  roarGain.gain.value = 0.04;

  roarSrc.connect(roarBp).connect(roarGain);

  // ── Output chain ──
  const mixGain = ctx.createGain();
  mixGain.gain.setValueAtTime(0, t);
  mixGain.gain.linearRampToValueAtTime(0.12, t + 1.2);

  turbineGain.connect(mixGain);
  roarGain.connect(mixGain);

  const outputFilter = ctx.createBiquadFilter();
  outputFilter.type = 'lowpass';
  outputFilter.frequency.value = 5000;

  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 20;
  panner.maxDistance = 120;
  panner.rolloffFactor = 1.6;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;

  mixGain.connect(outputFilter).connect(panner).connect(core.getBus('vehicle'));

  turbineOsc.start(t);
  roarSrc.start(t);

  jetSounds.set(id, {
    turbineOsc,
    turbineGain,
    roarSrc,
    roarBp,
    roarGain,
    mixGain,
    outputFilter,
    panner,
    allSources,
    wasLocal: false,
    stopping: false,
    stopTimer: null,
  });
}

export function updateJetEngineSound(
  core: AudioCore,
  id: number,
  position: Vec3Like,
  speed: number,
  isLocal: boolean,
  apparentPosition?: Vec3Like,
  propagationOcclusion?: number,
): void {
  const nodes = jetSounds.get(id);
  if (!nodes || nodes.stopping || !core.ctx) return;
  const t = core.ctx.currentTime;

  // Speed factor 0–1 (maxSpeed ~65)
  const speedFactor = Math.min(1, speed / 65);

  // ── Turbine pitch: higher with speed ──
  const turbineFreq = 180 + speedFactor * 220;
  nodes.turbineOsc.frequency.setTargetAtTime(turbineFreq, t, 0.12);
  const turbineVol = 0.04 + speedFactor * 0.06;
  nodes.turbineGain.gain.setTargetAtTime(turbineVol, t, 0.15);

  // ── Roar volume & filter: louder and brighter with speed ──
  const roarVol = 0.02 + speedFactor * 0.08;
  nodes.roarGain.gain.setTargetAtTime(roarVol, t, 0.2);
  const roarCutoff = 350 + speedFactor * 600;
  nodes.roarBp.frequency.setTargetAtTime(roarCutoff, t, 0.15);

  // ── Local vs remote tonal adjustment ──
  if (isLocal !== nodes.wasLocal) {
    nodes.wasLocal = isLocal;
    const cutoff = isLocal ? 2200 : 5000;
    const vol = isLocal ? 0.09 : 0.12;
    nodes.outputFilter.frequency.setTargetAtTime(cutoff, t, 0.3);
    nodes.mixGain.gain.setTargetAtTime(vol, t, 0.3);
  }

  // ── Panner position: use apparent position if available (sound propagation) ──
  core.setPannerPosition(nodes.panner, apparentPosition ?? position, t);

  // ── Propagation occlusion ──
  if (propagationOcclusion !== undefined && propagationOcclusion > 0.01) {
    const baseCutoff = nodes.wasLocal ? 2200 : 5000;
    const occludedCutoff = baseCutoff * (1 - propagationOcclusion * 0.7);
    nodes.outputFilter.frequency.setTargetAtTime(Math.max(200, occludedCutoff), t, 0.1);
    const baseVol = nodes.wasLocal ? 0.09 : 0.12;
    const occludedVol = baseVol * (1 - propagationOcclusion * 0.4);
    nodes.mixGain.gain.setTargetAtTime(occludedVol, t, 0.15);
  }
}

export function stopJetEngineSound(core: AudioCore, id: number, destroyed = false): void {
  const nodes = jetSounds.get(id);
  if (!nodes || nodes.stopping) return;
  nodes.stopping = true;
  if (!core.ctx) {
    jetSounds.delete(id);
    return;
  }
  const t = core.ctx.currentTime;

  if (destroyed) {
    const fadeTime = 0.5;
    nodes.turbineOsc.frequency.setTargetAtTime(100, t, 0.1);
    nodes.mixGain.gain.setTargetAtTime(0, t, 0.12);
    nodes.stopTimer = setTimeout(() => cleanupJetSound(id), fadeTime * 1000);
  } else {
    const fadeTime = 0.7;
    nodes.mixGain.gain.setTargetAtTime(0, t, 0.18);
    nodes.stopTimer = setTimeout(() => cleanupJetSound(id), fadeTime * 1000);
  }
}

function cleanupJetSound(id: number): void {
  const nodes = jetSounds.get(id);
  if (!nodes) return;
  for (const src of nodes.allSources) {
    try { src.stop(); } catch { /* already stopped */ }
    src.disconnect();
  }
  nodes.mixGain.disconnect();
  nodes.outputFilter.disconnect();
  nodes.panner.disconnect();
  jetSounds.delete(id);
}

/** Called by AudioSystem.dispose() to clean up all jet sounds. */
export function disposeAllJetSounds(): void {
  for (const id of Array.from(jetSounds.keys())) {
    const nodes = jetSounds.get(id);
    if (nodes?.stopTimer) clearTimeout(nodes.stopTimer);
    cleanupJetSound(id);
  }
  jetSounds.clear();
  jetNoiseBuffer = null;
}
