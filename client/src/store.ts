import { create } from 'zustand';
import type { DbConnection } from './module_bindings';

export type Screen = 'login' | 'lobby' | 'game';

interface GameStore {
  screen: Screen;
  username: string;
  identity: string | null;
  connected: boolean;
  connection: DbConnection | null;
  error: string | null;

  setScreen: (screen: Screen) => void;
  setUsername: (username: string) => void;
  setIdentity: (identity: string) => void;
  setConnected: (connected: boolean) => void;
  setConnection: (conn: DbConnection | null) => void;
  setError: (error: string | null) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  screen: 'login',
  username: '',
  identity: null,
  connected: false,
  connection: null,
  error: null,

  setScreen: (screen) => set({ screen }),
  setUsername: (username) => set({ username }),
  setIdentity: (identity) => set({ identity }),
  setConnected: (connected) => set({ connected }),
  setConnection: (connection) => set({ connection }),
  setError: (error) => set({ error }),
}));
