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

export const CHARACTER_PRESETS: CharacterPreset[] = [
  {
    id: 0,
    name: 'Nomad',
    role: 'Balanced Scout',
    bodyColor: 0x4d5868,
    vestColor: 0x1f2631,
    headColor: 0xe2b184,
    visorColor: 0x67d3ff,
    accentColor: 0x2f8cff,
    gunColor: 0x273244,
  },
  {
    id: 1,
    name: 'Vanguard',
    role: 'Frontline Breacher',
    bodyColor: 0x6d3c2f,
    vestColor: 0x2d1f1a,
    headColor: 0xd49b73,
    visorColor: 0xffb45f,
    accentColor: 0xff6d42,
    gunColor: 0x372821,
  },
  {
    id: 2,
    name: 'Warden',
    role: 'Defensive Anchor',
    bodyColor: 0x3f5d47,
    vestColor: 0x1f3024,
    headColor: 0xc99873,
    visorColor: 0x79ffb0,
    accentColor: 0x53d67d,
    gunColor: 0x243327,
  },
  {
    id: 3,
    name: 'Circuit',
    role: 'Tech Specialist',
    bodyColor: 0x394f66,
    vestColor: 0x172232,
    headColor: 0xd6a37c,
    visorColor: 0x5fd1ff,
    accentColor: 0x00c2ff,
    gunColor: 0x1d2938,
  },
  {
    id: 4,
    name: 'Ranger',
    role: 'Precision Hunter',
    bodyColor: 0x5f5445,
    vestColor: 0x2e271e,
    headColor: 0xdcb186,
    visorColor: 0xf5ff8d,
    accentColor: 0xd4c25a,
    gunColor: 0x332c22,
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

export function colorHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
