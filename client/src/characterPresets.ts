export type CharacterPreset = {
  id: number;
  name: string;
  role: string;
  bodyColor: number;
  vestColor: number;
  headColor: number;
  visorColor: number;
  accentColor: number;
  gunColor: number;
};

// bodyColor = shirt/torso (the dominant identity colour), vestColor = trousers,
// headColor = skin, visorColor = eye glow, accentColor = belt + tactical-map dot,
// gunColor = gun body (also tinted darker for hair). Kept saturated so each
// soldier reads as clearly distinct in-world.
export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    id: 0,
    name: 'Nomad',
    role: 'Balanced Scout',
    bodyColor: 0x2f9e8f,
    vestColor: 0x18403b,
    headColor: 0xe2b184,
    visorColor: 0x67d3ff,
    accentColor: 0x00e5ff,
    gunColor: 0x202a30,
  },
  {
    id: 1,
    name: 'Vanguard',
    role: 'Frontline Breacher',
    bodyColor: 0xc23b2e,
    vestColor: 0x4a1f1a,
    headColor: 0xd49b73,
    visorColor: 0xffb45f,
    accentColor: 0xff6d42,
    gunColor: 0x2a1a16,
  },
  {
    id: 2,
    name: 'Warden',
    role: 'Defensive Anchor',
    bodyColor: 0x3f9e57,
    vestColor: 0x1f3a26,
    headColor: 0xc99873,
    visorColor: 0x79ffb0,
    accentColor: 0x53d67d,
    gunColor: 0x1d2a20,
  },
  {
    id: 3,
    name: 'Circuit',
    role: 'Tech Specialist',
    bodyColor: 0x3d6cc4,
    vestColor: 0x18233a,
    headColor: 0xd6a37c,
    visorColor: 0x5fd1ff,
    accentColor: 0x00c2ff,
    gunColor: 0x1a2230,
  },
  {
    id: 4,
    name: 'Ranger',
    role: 'Precision Hunter',
    bodyColor: 0xc2a23a,
    vestColor: 0x3a2f1c,
    headColor: 0xdcb186,
    visorColor: 0xf5ff8d,
    accentColor: 0xffd600,
    gunColor: 0x2c2418,
  },
];

export function normalizeCharacterPreset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0;
  if (value < 0 || value >= CHARACTER_PRESETS.length) return 0;
  return value;
}

export function getCharacterPreset(value: unknown): CharacterPreset {
  return CHARACTER_PRESETS[normalizeCharacterPreset(value)];
}

/**
 * Deterministically pick a character appearance from a player's name.
 *
 * Character selection was removed in favour of getting straight into the game,
 * so each player is auto-assigned a stable variant derived from their call sign.
 * Same name always maps to the same look, and players stay visually distinct
 * from each other (in-world models + tactical map dots).
 */
export function characterPresetForName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash % CHARACTER_PRESETS.length;
}

export function colorHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
