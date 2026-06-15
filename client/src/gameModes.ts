// Registry of selectable game modes shown on the main menu.
// Only `available` modes are playable; the rest are surfaced as "Coming soon"
// so players can see what is planned. Add a new mode by appending an entry here.

export interface GameModeDef {
  id: string;
  name: string;
  tagline: string;
  description: string;
  color: string;
  available: boolean;
}

export const GAME_MODES: GameModeDef[] = [
  {
    id: 'sandbox',
    name: 'SANDBOX',
    tagline: 'DEATHMATCH',
    description: 'All weapons unlocked. No rules. Free-for-all combat.',
    color: '#ff6b35',
    available: true,
  },
  {
    id: 'tdm',
    name: 'TEAM DEATHMATCH',
    tagline: 'COMING SOON',
    description: 'Squad up and battle for team supremacy.',
    color: '#00e5ff',
    available: false,
  },
  {
    id: 'ctf',
    name: 'CAPTURE THE FLAG',
    tagline: 'COMING SOON',
    description: 'Steal the enemy flag and defend your own.',
    color: '#76ff03',
    available: false,
  },
];

export const DEFAULT_GAME_MODE = 'sandbox';

export function getGameMode(id: string): GameModeDef {
  return GAME_MODES.find((m) => m.id === id) ?? GAME_MODES[0];
}

// Collapses any stored/foreign value to a valid, playable mode id so the menu
// can never land on a "Coming soon" (or removed) mode.
export function normalizeGameMode(value: unknown): string {
  if (typeof value === 'string') {
    const mode = GAME_MODES.find((m) => m.id === value && m.available);
    if (mode) return mode.id;
  }
  return DEFAULT_GAME_MODE;
}
