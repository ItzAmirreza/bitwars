/**
 * SampleLibrary — loads, decodes, and caches audio sample files.
 *
 * The audio system was historically 100% procedural (oscillators + noise). Real
 * recorded/produced samples are what make sounds read as "designed" rather than
 * synthetic. Samples are played through the SAME spatial panner + submix bus +
 * reverb + occlusion chain as procedural sounds (see AudioCore.playSample), so
 * they are positioned in 3D, occluded by walls, and picked up by room reverb.
 *
 * Manifest entries map a logical name → one file, or an array of files (variants
 * picked at random for natural repetition, e.g. footsteps). Files live in
 * `client/public/audio/` and are served at `${BASE_URL}audio/...`. Replacing a
 * sound = drop a new file with the same path; no code change needed.
 *
 * Anything without a sample falls back to the procedural synth in the play
 * function, so loading is non-blocking and partial sets work fine.
 */

const SAMPLE_MANIFEST: Record<string, string | string[]> = {
  // Weapons (CC0 real firearm recordings — multiple takes per gun so each shot
  // can pull a different recording; combined with per-shot pitch/gain jitter no
  // two shots sound identical).
  weapon_rifle: ['weapons/rifle.mp3', 'weapons/rifle_1.mp3'],
  weapon_shotgun: ['weapons/shotgun.mp3', 'weapons/shotgun_1.mp3'],
  weapon_sniper: ['weapons/sniper.mp3', 'weapons/sniper_1.mp3'],
  weapon_machinegun: ['weapons/machinegun.mp3', 'weapons/machinegun_1.mp3', 'weapons/machinegun_2.mp3'],
  weapon_minigun: ['weapons/minigun.mp3', 'weapons/minigun_1.mp3', 'weapons/minigun_2.mp3'],
  weapon_rpg: 'weapons/rpg.mp3', // real missile/rocket launch (not a gun)

  // Combat (explosion has 5 variants — biggest "different every time" win)
  explosion: [
    'combat/explosion.mp3', 'combat/explosion_1.mp3', 'combat/explosion_2.mp3',
    'combat/explosion_3.mp3', 'combat/explosion_4.mp3',
  ],
  explosion_boom: ['combat/explosion_boom.mp3', 'combat/explosion_boom_1.mp3'],
  blockbreak: [
    'combat/blockbreak.mp3', 'combat/blockbreak_1.mp3', 'combat/blockbreak_2.mp3',
    'combat/blockbreak_3.mp3', 'combat/blockbreak_4.mp3',
  ],
  hitmarker: 'combat/hitmarker.mp3',
  killconfirm: 'combat/killconfirm.mp3',
  damage: [
    'combat/damage.mp3', 'combat/damage_1.mp3', 'combat/damage_2.mp3',
    'combat/damage_3.mp3', 'combat/damage_4.mp3',
  ],

  // Movement (footstep variants picked at random)
  footstep_grass: [
    'movement/footstep_grass_0.mp3',
    'movement/footstep_grass_1.mp3',
    'movement/footstep_grass_2.mp3',
    'movement/footstep_grass_3.mp3',
    'movement/footstep_grass_4.mp3',
  ],
  land: 'movement/land.mp3',

  // UI (non-spatial)
  ui_hover: 'ui/hover.mp3',
  ui_click: 'ui/click.mp3',
  ui_navigate: 'ui/navigate.mp3',
  ui_deploy: 'ui/deploy.mp3',
  ui_error: 'ui/error.mp3',

  // Music
  music_menu: 'music/menu.mp3',
};

export class SampleLibrary {
  private buffers = new Map<string, AudioBuffer[]>();
  private loadPromise: Promise<void> | null = null;

  /** Kick off (or return the in-flight) decode of all manifest files. Idempotent. */
  load(ctx: AudioContext): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.loadAll(ctx);
    return this.loadPromise;
  }

  private async loadAll(ctx: AudioContext): Promise<void> {
    const base = import.meta.env.BASE_URL;
    await Promise.all(
      Object.entries(SAMPLE_MANIFEST).map(async ([name, value]) => {
        const urls = Array.isArray(value) ? value : [value];
        const bufs = await Promise.all(
          urls.map(async (u) => {
            try {
              const res = await fetch(`${base}audio/${u}`);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const arr = await res.arrayBuffer();
              return await ctx.decodeAudioData(arr);
            } catch (e) {
              console.warn(`[audio] failed to load sample "${u}":`, e);
              return null;
            }
          }),
        );
        const valid = bufs.filter((b): b is AudioBuffer => b !== null);
        if (valid.length) this.buffers.set(name, valid);
      }),
    );
  }

  /** Return a decoded buffer for a name (random variant if multiple), or null. */
  get(name: string): AudioBuffer | null {
    const arr = this.buffers.get(name);
    if (!arr || arr.length === 0) return null;
    if (arr.length === 1) return arr[0];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  dispose(): void {
    this.buffers.clear();
    this.loadPromise = null;
  }
}
