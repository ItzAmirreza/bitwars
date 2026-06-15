import { create } from 'zustand';
import type { DbConnection } from './module_bindings';
import { normalizeCharacterPreset } from './characterPresets';
import { normalizeGameMode } from './gameModes';

export type Screen = 'login' | 'lobby' | 'game';

export interface GameSettings {
  sensitivity: number;
  fov: number;
  masterVolume: number;
  shadowsEnabled: boolean;
  postFXEnabled: boolean;
  sprintToggle: boolean;
  graphicsQuality: 'low' | 'medium' | 'high';
  minimapSide: 'left' | 'right';
}

const DEFAULT_SETTINGS: GameSettings = {
  sensitivity: 0.002,
  fov: 75,
  masterVolume: 0.35,
  shadowsEnabled: true,
  postFXEnabled: true,
  sprintToggle: false,
  graphicsQuality: 'high',
  minimapSide: 'left',
};

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem('bitwars-settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: GameSettings): void {
  try { localStorage.setItem('bitwars-settings', JSON.stringify(s)); } catch { /* ignore */ }
}

function loadCharacterPreset(): number {
  try {
    const raw = localStorage.getItem('bitwars-character-preset');
    if (raw !== null) return normalizeCharacterPreset(Number(raw));
  } catch {
    // ignore
  }
  return 0;
}

function saveCharacterPreset(preset: number): void {
  try {
    localStorage.setItem('bitwars-character-preset', String(normalizeCharacterPreset(preset)));
  } catch {
    // ignore
  }
}

function loadGameMode(): string {
  try {
    const raw = localStorage.getItem('bitwars-game-mode');
    if (raw !== null) return normalizeGameMode(raw);
  } catch {
    // ignore
  }
  return normalizeGameMode(null);
}

function saveGameMode(mode: string): void {
  try {
    localStorage.setItem('bitwars-game-mode', normalizeGameMode(mode));
  } catch {
    // ignore
  }
}

interface GameStore {
  screen: Screen;
  username: string;
  identity: string | null;
  connected: boolean;
  connection: DbConnection | null;
  error: string | null;
  versionStale: boolean;
  settings: GameSettings;
  showSettings: boolean;
  selectedCharacterPreset: number;
  selectedGameMode: string;

  setScreen: (screen: Screen) => void;
  setUsername: (username: string) => void;
  setIdentity: (identity: string | null) => void;
  setConnected: (connected: boolean) => void;
  setConnection: (conn: DbConnection | null) => void;
  setError: (error: string | null) => void;
  setVersionStale: () => void;
  setSettings: (partial: Partial<GameSettings>) => void;
  resetSettings: () => void;
  setShowSettings: (show: boolean) => void;
  setSelectedCharacterPreset: (preset: number) => void;
  setSelectedGameMode: (mode: string) => void;
  resetSession: (error?: string | null) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  screen: 'login',
  username: '',
  identity: null,
  connected: false,
  connection: null,
  error: null,
  versionStale: false,
  settings: loadSettings(),
  showSettings: false,
  selectedCharacterPreset: loadCharacterPreset(),
  selectedGameMode: loadGameMode(),

  setScreen: (screen) => set({ screen }),
  setUsername: (username) => set({ username }),
  setIdentity: (identity) => set({ identity }),
  setConnected: (connected) => set({ connected }),
  setConnection: (connection) => set({ connection }),
  setError: (error) => set({ error }),
  setVersionStale: () => set({ versionStale: true }),
  setSettings: (partial) =>
    set((state) => {
      const next = { ...state.settings, ...partial };
      saveSettings(next);
      return { settings: next };
    }),
  resetSettings: () => {
    saveSettings(DEFAULT_SETTINGS);
    set({ settings: { ...DEFAULT_SETTINGS } });
  },
  setShowSettings: (show) => set({ showSettings: show }),
  setSelectedCharacterPreset: (preset) => {
    const normalized = normalizeCharacterPreset(preset);
    saveCharacterPreset(normalized);
    set({ selectedCharacterPreset: normalized });
  },
  setSelectedGameMode: (mode) => {
    const normalized = normalizeGameMode(mode);
    saveGameMode(normalized);
    set({ selectedGameMode: normalized });
  },
  resetSession: (error = null) => set({
    screen: 'login',
    username: '',
    identity: null,
    connected: false,
    connection: null,
    error,
    showSettings: false,
  }),
}));

export { DEFAULT_SETTINGS };
