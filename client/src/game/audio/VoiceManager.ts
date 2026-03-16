/**
 * VoiceManager — polyphony limiter, distance culler, and voice stealer.
 *
 * Tracks all active one-shot sound "voices" per category and enforces
 * maximum concurrency. When a new sound is requested:
 *
 *   1. Distance cull — if the source is beyond the max audible distance,
 *      skip entirely (never create audio nodes).
 *   2. Category limit — if the category is at capacity, steal the
 *      least-important voice (farthest / oldest depending on strategy).
 *   3. If under limit, allow the sound.
 *
 * Each voice is tracked with a cleanup timer so it auto-removes when the
 * sound's scheduled duration expires.
 */

import type { Vec3Like } from './AudioCore';

// ── Voice categories ──

export type VoiceCategory = 'weapon' | 'combat' | 'movement' | 'ui' | 'flyby';

export type StealStrategy = 'farthest' | 'oldest';

interface CategoryConfig {
  maxVoices: number;
  stealStrategy: StealStrategy;
  /** Sounds beyond this distance are culled entirely (never created). */
  cullDistance: number;
}

const CATEGORY_CONFIGS: Record<VoiceCategory, CategoryConfig> = {
  weapon:   { maxVoices: 12, stealStrategy: 'farthest', cullDistance: 280 },
  combat:   { maxVoices: 8,  stealStrategy: 'oldest',   cullDistance: 300 },
  movement: { maxVoices: 8,  stealStrategy: 'farthest', cullDistance: 60 },
  ui:       { maxVoices: 4,  stealStrategy: 'oldest',   cullDistance: Infinity },
  flyby:    { maxVoices: 6,  stealStrategy: 'farthest', cullDistance: 60 },
};

/** Tracked active voice. */
interface ActiveVoice {
  id: number;
  category: VoiceCategory;
  distance: number;
  createdAt: number;       // performance.now()
  /** Nodes to disconnect when stolen. */
  disconnectNodes: AudioNode[];
  /** Timer that auto-removes this voice when its sound ends. */
  cleanupTimer: ReturnType<typeof setTimeout>;
}

export class VoiceManager {
  private nextVoiceId = 0;
  private voices = new Map<number, ActiveVoice>();
  private byCategoryCount: Record<VoiceCategory, number> = {
    weapon: 0, combat: 0, movement: 0, ui: 0, flyby: 0,
  };

  /**
   * Request permission to play a new sound.
   *
   * @returns `true` if the sound is allowed (caller should create nodes).
   *          `false` if the sound was culled (too far away or stolen failed).
   *
   * If a voice is stolen to make room, it is cleaned up automatically.
   */
  requestVoice(
    category: VoiceCategory,
    distance: number,
    listenerPos?: Vec3Like,
    sourcePos?: Vec3Like,
  ): boolean {
    const config = CATEGORY_CONFIGS[category];

    // ── Distance cull ──
    // Compute actual distance if positions are provided; otherwise use
    // the caller-provided distance value.
    let dist = distance;
    if (listenerPos && sourcePos) {
      dist = Math.hypot(
        sourcePos.x - listenerPos.x,
        sourcePos.y - listenerPos.y,
        sourcePos.z - listenerPos.z,
      );
    }
    if (dist > config.cullDistance) return false;

    // ── Under limit? Allow immediately. ──
    if (this.byCategoryCount[category] < config.maxVoices) return true;

    // ── At limit — try to steal ──
    return this.stealVoice(category, config, dist);
  }

  /**
   * Register a newly-created voice so it can be tracked and eventually stolen.
   *
   * @param durationSec  How long the sound will play. After this time +
   *                     a small buffer, the voice is automatically removed.
   * @param disconnectNodes  Audio nodes to disconnect if the voice is stolen
   *                         (typically the spatial bus input node is enough).
   */
  registerVoice(
    category: VoiceCategory,
    distance: number,
    durationSec: number,
    disconnectNodes: AudioNode[],
  ): number {
    const id = this.nextVoiceId++;

    // Auto-cleanup after the sound finishes + 100ms buffer for tail/reverb.
    const cleanupTimer = setTimeout(() => {
      this.removeVoice(id);
    }, (durationSec + 0.1) * 1000);

    const voice: ActiveVoice = {
      id,
      category,
      distance,
      createdAt: performance.now(),
      disconnectNodes,
      cleanupTimer,
    };

    this.voices.set(id, voice);
    this.byCategoryCount[category]++;
    return id;
  }

  /** Remove a voice from tracking (called by cleanup timer or steal). */
  private removeVoice(id: number): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    clearTimeout(voice.cleanupTimer);
    this.voices.delete(id);
    this.byCategoryCount[voice.category] = Math.max(0, this.byCategoryCount[voice.category] - 1);
  }

  /** Try to steal the least-important voice in the category. */
  private stealVoice(
    category: VoiceCategory,
    config: CategoryConfig,
    newDistance: number,
  ): boolean {
    let victim: ActiveVoice | null = null;

    if (config.stealStrategy === 'farthest') {
      // Steal the farthest voice — but only if the new sound is closer.
      let maxDist = -1;
      for (const voice of this.voices.values()) {
        if (voice.category !== category) continue;
        if (voice.distance > maxDist) {
          maxDist = voice.distance;
          victim = voice;
        }
      }
      // If the new sound is farther than all existing ones, deny it.
      if (victim && newDistance >= victim.distance) return false;
    } else {
      // 'oldest' — steal the oldest voice.
      let oldestTime = Infinity;
      for (const voice of this.voices.values()) {
        if (voice.category !== category) continue;
        if (voice.createdAt < oldestTime) {
          oldestTime = voice.createdAt;
          victim = voice;
        }
      }
    }

    if (!victim) return false;

    // Kill the victim: disconnect its nodes so it goes silent immediately.
    for (const node of victim.disconnectNodes) {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    this.removeVoice(victim.id);
    return true;
  }

  /** Get current voice count for a category (useful for debugging). */
  getCount(category: VoiceCategory): number {
    return this.byCategoryCount[category];
  }

  /** Get total active voices across all categories. */
  getTotalCount(): number {
    return this.voices.size;
  }

  /** Dispose all tracked voices and reset state. */
  dispose(): void {
    for (const voice of this.voices.values()) {
      clearTimeout(voice.cleanupTimer);
      for (const node of voice.disconnectNodes) {
        try { node.disconnect(); } catch { /* ok */ }
      }
    }
    this.voices.clear();
    this.byCategoryCount = { weapon: 0, combat: 0, movement: 0, ui: 0, flyby: 0 };
  }
}
