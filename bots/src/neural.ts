/**
 * Lightweight LSTM Actor-Critic inference for navigation.
 *
 * Loads a safetensors checkpoint and runs forward passes to produce
 * movement actions (forward, strafe, yaw/pitch deltas, jump, sprint).
 */

import fs from 'node:fs';

// ── Architecture constants (must match training/src-tauri/src/rl/network.rs) ──

const OBS_DIM = 106;
const HIDDEN_SIZE = 256;
const HEAD_HIDDEN = 128;
const ACTION_PARAM_DIM = 7; // 4 continuous + 3 binary
const WEAPON_HEAD_DIM = 5;
const POLICY_WEAPON_DIM = 3;

// ── Types ──

interface Linear {
  weight: Float32Array; // [outSize, inSize] row-major
  bias: Float32Array; // [outSize]
  inSize: number;
  outSize: number;
}

export interface NeuralAction {
  forward: number; // [-1, 1]
  strafe: number; // [-1, 1]
  yawDelta: number; // [-1, 1] raw, caller scales by MAX_YAW_DELTA * timestepRatio
  pitchDelta: number; // [-1, 1] raw
  jump: boolean;
  sprint: boolean;
  fire: boolean;
  weaponSelect: number;
}

// ── Neural navigator ──

export class NeuralNavigator {
  private inputProj: Linear;
  private lstmGates: Linear;
  private actorHidden: Linear;
  private actorMean: Linear;
  private weaponHead: Linear;
  // LSTM hidden state
  private h: Float32Array;
  private c: Float32Array;
  // Reusable scratch buffers to avoid per-step allocation
  private _projected = new Float32Array(HIDDEN_SIZE);
  private _combined = new Float32Array(HIDDEN_SIZE * 2);
  private _gates = new Float32Array(HIDDEN_SIZE * 4);
  private _actorH = new Float32Array(HEAD_HIDDEN);
  private _actionParams = new Float32Array(ACTION_PARAM_DIM);
  private _weaponLogits = new Float32Array(WEAPON_HEAD_DIM);

  constructor(modelPath: string) {
    const tensors = loadSafetensors(modelPath);

    this.inputProj = makeLinear(tensors, 'input_proj', OBS_DIM, HIDDEN_SIZE);
    this.lstmGates = makeLinear(tensors, 'lstm_gates', HIDDEN_SIZE * 2, HIDDEN_SIZE * 4);
    this.actorHidden = makeLinear(tensors, 'actor_hidden', HIDDEN_SIZE, HEAD_HIDDEN);
    this.actorMean = makeLinear(tensors, 'actor_mean', HEAD_HIDDEN, ACTION_PARAM_DIM);
    this.weaponHead = makeLinear(tensors, 'weapon_head', HEAD_HIDDEN, WEAPON_HEAD_DIM);

    this.h = new Float32Array(HIDDEN_SIZE);
    this.c = new Float32Array(HIDDEN_SIZE);
  }

  resetState(): void {
    this.h.fill(0);
    this.c.fill(0);
  }

  /** Run a single inference step. Returns deterministic (mean) actions. */
  forward(obs: Float32Array): NeuralAction {
    // Input projection: Linear(106 → 256) + ReLU
    linearForwardInto(this.inputProj, obs, this._projected);
    reluInPlace(this._projected);

    // LSTM cell: concat [projected, h] → gates → update c, h
    const combined = this._combined;
    combined.set(this._projected);
    combined.set(this.h, HIDDEN_SIZE);

    linearForwardInto(this.lstmGates, combined, this._gates);

    const g = this._gates;
    const h = this.h;
    const c = this.c;
    for (let i = 0; i < HIDDEN_SIZE; i++) {
      const ig = sigmoid(g[i]!); // input gate
      const fg = sigmoid(g[HIDDEN_SIZE + i]!); // forget gate
      const gg = Math.tanh(g[HIDDEN_SIZE * 2 + i]!); // cell candidate
      const og = sigmoid(g[HIDDEN_SIZE * 3 + i]!); // output gate
      c[i] = fg * c[i]! + ig * gg;
      h[i] = og * Math.tanh(c[i]!);
    }

    // Actor head: Linear(256→128)+ReLU → Linear(128→7)
    linearForwardInto(this.actorHidden, h, this._actorH);
    reluInPlace(this._actorH);
    linearForwardInto(this.actorMean, this._actorH, this._actionParams);
    linearForwardInto(this.weaponHead, this._actorH, this._weaponLogits);

    const a = this._actionParams;
    const forward = Math.tanh(a[0]!);
    const strafe = Math.tanh(a[1]!);
    const yawDelta = Math.tanh(a[2]!);
    const pitchDelta = Math.tanh(a[3]!);
    const jump = sigmoid(a[4]!) > 0.5;
    const sprint = sigmoid(a[5]!) > 0.5;
    const fire = sigmoid(a[6]!) > 0.5;

    // Weapon: argmax of first POLICY_WEAPON_DIM logits
    const wl = this._weaponLogits;
    let weaponSelect = 0;
    let best = wl[0]!;
    for (let i = 1; i < POLICY_WEAPON_DIM; i++) {
      if (wl[i]! > best) {
        best = wl[i]!;
        weaponSelect = i;
      }
    }

    return { forward, strafe, yawDelta, pitchDelta, jump, sprint, fire, weaponSelect };
  }
}

// ── Linear algebra helpers ──

function linearForwardInto(layer: Linear, input: Float32Array, output: Float32Array): void {
  const { weight, bias, inSize, outSize } = layer;
  for (let i = 0; i < outSize; i++) {
    let sum = bias[i]!;
    const off = i * inSize;
    for (let j = 0; j < inSize; j++) {
      sum += weight[off + j]! * input[j]!;
    }
    output[i] = sum;
  }
}

function reluInPlace(arr: Float32Array): void {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]! < 0) arr[i] = 0;
  }
}

function sigmoid(x: number): number {
  if (x > 15) return 1;
  if (x < -15) return 0;
  return 1 / (1 + Math.exp(-x));
}

// ── Safetensors loader ──

function makeLinear(
  tensors: Record<string, Float32Array>,
  prefix: string,
  inSize: number,
  outSize: number,
): Linear {
  const weight = tensors[`${prefix}.weight`];
  const bias = tensors[`${prefix}.bias`];
  if (!weight || !bias) throw new Error(`Missing tensors for ${prefix}`);
  if (weight.length !== outSize * inSize) {
    throw new Error(`${prefix}.weight: expected ${outSize}x${inSize}=${outSize * inSize}, got ${weight.length}`);
  }
  return { weight, bias, inSize, outSize };
}

function loadSafetensors(filePath: string): Record<string, Float32Array> {
  const buf = fs.readFileSync(filePath);
  // Header: 8-byte LE uint64 header size, then JSON header, then raw data
  const headerSize = Number(buf.readBigUInt64LE(0));
  const header: Record<string, { dtype: string; shape: number[]; data_offsets: [number, number] }> =
    JSON.parse(buf.subarray(8, 8 + headerSize).toString('utf8'));

  const dataStart = 8 + headerSize;
  const tensors: Record<string, Float32Array> = {};

  for (const [name, info] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    const start = dataStart + info.data_offsets[0];
    const end = dataStart + info.data_offsets[1];
    const slice = buf.subarray(start, end);
    // Copy into a properly aligned Float32Array
    const f32 = new Float32Array(slice.byteLength / 4);
    const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
    for (let i = 0; i < f32.length; i++) {
      f32[i] = view.getFloat32(i * 4, true); // little-endian
    }
    tensors[name] = f32;
  }

  return tensors;
}
