// Local persistence - ported from omarchy-radio-atlas/radio-state
// Original stored JSON in ~/.local/share/radio-atlas/state.json;
// on Bridgething we use localStorage (per-webapp KV).

import type { Station } from './types';
import { cleanStationName, POPULAR_COUNTRIES } from './radioApi';

const FAVORITES_KEY = 'radio-atlas:favorites';
const RECENT_KEY = 'radio-atlas:recent';
const TILES_KEY = 'radio-atlas:country-tiles';
const COUNTRIES_CACHE_KEY = 'radio-atlas:countries-cache';
// the directory's country list barely changes; a week-old cache is fine
const COUNTRIES_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
  clearRecent(): Station[] {
    write(RECENT_KEY, []);
    return [];
  },
  clearFavorites(): Station[] {
    write(FAVORITES_KEY, []);
    return [];
  },

  /** Country tiles for the Countries tab; persisted so long-press swaps stick */
  getCountryTiles(): { code: string; name: string }[] {
    const tiles = read<{ code: string; name: string }[]>(TILES_KEY, []);
    if (!Array.isArray(tiles) || tiles.length === 0) return POPULAR_COUNTRIES;
    return tiles
      .filter(t => t && typeof t.code === 'string' && typeof t.name === 'string')
      .map(t => ({ code: t.code.toUpperCase().slice(0, 2), name: t.name.slice(0, 100) }))
      .slice(0, 24);
  },
  setCountryTiles(tiles: { code: string; name: string }[]): void {
    write(TILES_KEY, tiles);
  },

  /** the full stream-country list, cached for a week so the picker opens instantly */
  getCachedCountries(): { code: string; name: string; stationCount: number }[] | null {
    const cached = read<{ fetchedAt: number; countries: { code: string; name: string; stationCount: number }[] } | null>(COUNTRIES_CACHE_KEY, null);
    if (!cached || typeof cached.fetchedAt !== 'number') return null;
    if (Date.now() - cached.fetchedAt > COUNTRIES_CACHE_TTL_MS) return null;
    if (!Array.isArray(cached.countries) || cached.countries.length === 0) return null;
    return cached.countries;
  },
  setCachedCountries(countries: { code: string; name: string; stationCount: number }[]): void {
    write(COUNTRIES_CACHE_KEY, { fetchedAt: Date.now(), countries });
  },

  getCachedStations(key: string): CachedStations | null {
    const entry = read<Record<string, CachedStations>>(STATION_CACHE_KEY, {})[key];
    return entry && Array.isArray(entry.data) ? entry : null;
  },
  setCachedStations(key: string, data: Station[], limit = 200): void {
    const cache = read<Record<string, CachedStations>>(STATION_CACHE_KEY, {});
    cache[key] = { data: data.slice(0, limit), at: Date.now() };
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
