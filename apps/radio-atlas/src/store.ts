// Local persistence - ported from omarchy-radio-atlas/radio-state
// Original stored JSON in ~/.local/share/radio-atlas/state.json;
// on Bridgething we use localStorage (per-webapp KV).

import type { Station } from './types';

const FAVORITES_KEY = 'radio-atlas:favorites';
const RECENT_KEY = 'radio-atlas:recent';
const VOLUME_KEY = 'radio-atlas:volume';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable; ignore
  }
}

export const store = {
  getFavorites(): Station[] {
    return read<Station[]>(FAVORITES_KEY, []);
  },
  isFavorite(uuid: string): boolean {
    return store.getFavorites().some(s => s.uuid === uuid);
  },
  toggleFavorite(station: Station): Station[] {
    const favs = store.getFavorites();
    const idx = favs.findIndex(s => s.uuid === station.uuid);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.unshift(station);
    write(FAVORITES_KEY, favs.slice(0, 500));
    return store.getFavorites();
  },

  getRecent(): Station[] {
    return read<Station[]>(RECENT_KEY, []);
  },
  recordPlayed(station: Station): Station[] {
    const recent = store.getRecent().filter(s => s.uuid !== station.uuid);
    recent.unshift(station);
    write(RECENT_KEY, recent.slice(0, 100));
    return store.getRecent();
  },

  getVolume(): number {
    const v = read<number>(VOLUME_KEY, 70);
    return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 70;
  },
  setVolume(v: number): void {
    write(VOLUME_KEY, Math.max(0, Math.min(100, Math.round(v))));
  },
};
