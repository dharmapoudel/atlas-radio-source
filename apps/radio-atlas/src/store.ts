// Local persistence - ported from omarchy-radio-atlas/radio-state
// Original stored JSON in ~/.local/share/radio-atlas/state.json;
// on Bridgething we use localStorage (per-webapp KV).

import type { Station } from './types';
import { cleanStationName } from './radioApi';

const FAVORITES_KEY = 'radio-atlas:favorites';
const RECENT_KEY = 'radio-atlas:recent';
// v2: station names are cleaned at ingest, so older caches with dirty names
// are ignored
const STATION_CACHE_KEY = 'radio-atlas:station-cache:v2';
const NOW_PLAYING_KEY = 'radio-atlas:now-playing';

export interface CachedStations {
  data: Station[];
  at: number;
}

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
  // older entries predate name cleaning; clean on read so they heal
  getFavorites(): Station[] {
    return read<Station[]>(FAVORITES_KEY, []).map(s => ({ ...s, name: cleanStationName(s.name) }));
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
    return read<Station[]>(RECENT_KEY, []).map(s => ({ ...s, name: cleanStationName(s.name) }));
  },
  recordPlayed(station: Station): Station[] {
    const recent = store.getRecent().filter(s => s.uuid !== station.uuid);
    recent.unshift(station);
    write(RECENT_KEY, recent.slice(0, 100));
    return store.getRecent();
  },

  getCachedStations(key: string): CachedStations | null {
    const entry = read<Record<string, CachedStations>>(STATION_CACHE_KEY, {})[key];
    return entry && Array.isArray(entry.data) ? entry : null;
  },
  setCachedStations(key: string, data: Station[]): void {
    const cache = read<Record<string, CachedStations>>(STATION_CACHE_KEY, {});
    cache[key] = { data: data.slice(0, 200), at: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > 24) {
      keys.sort((a, b) => cache[a].at - cache[b].at);
      for (const k of keys.slice(0, keys.length - 24)) delete cache[k];
    }
    write(STATION_CACHE_KEY, cache);
  },

  getNowPlaying(): Station | null {
    const s = read<Station | null>(NOW_PLAYING_KEY, null);
    return s ? { ...s, name: cleanStationName(s.name) } : null;
  },
  setNowPlaying(s: Station | null): void {
    write(NOW_PLAYING_KEY, s);
  },
};
