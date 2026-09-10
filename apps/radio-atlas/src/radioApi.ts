// Radio Browser API client
// Ported from omarchy-radio-atlas/radio-fetch (bash) to TypeScript
// API docs: https://www.radio-browser.info/

import type { Station } from './types';

const USER_AGENT = 'RadioAtlas-Bridgething/0.1.0 (https://github.com/JoeyEamigh/bridgething)';

// Radio Browser requires DNS-based server discovery, but for the Car Thing
// we use the fixed mirror which is proxied via the phone gateway's net.proxy.
const API_BASE = 'https://all.api.radio-browser.info';

interface RawStation {
  stationuuid: string;
  name: string;
  url_resolved?: string;
  url?: string;
  homepage?: string;
  favicon?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
  votes?: number;
  clickcount?: number;
  geo_lat?: number | null;
  geo_long?: number | null;
}

function normalize(raw: RawStation[]): Station[] {
  const seen = new Set<string>();
  const out: Station[] = [];

  for (const s of raw.slice(0, 500)) {
    const uuid = String(s.stationuuid || '').slice(0, 64);
    const url = String(s.url_resolved || s.url || '').slice(0, 2048);
    if (!uuid || !/^https?:\/\//i.test(url) || seen.has(uuid)) continue;
    seen.add(uuid);

    const lat = s.geo_lat == null ? null : Number(s.geo_lat);
    const lon = s.geo_long == null ? null : Number(s.geo_long);

    out.push({
      uuid,
      name: String(s.name || 'Unknown station').replace(/[\r\n\t]+/g, ' ').slice(0, 160) || 'Unknown station',
      url,
      homepage: String(s.homepage || '').slice(0, 2048),
      favicon: String(s.favicon || '').slice(0, 2048),
      country: String(s.country || '').replace(/[\r\n\t]+/g, ' ').slice(0, 100),
      countryCode: String(s.countrycode || '').replace(/[\r\n\t]+/g, '').slice(0, 2).toUpperCase(),
      state: String(s.state || '').slice(0, 100),
      language: String(s.language || '').slice(0, 120),
      tags: String(s.tags || '').slice(0, 500),
      codec: String(s.codec || '').slice(0, 32),
      bitrate: Number(s.bitrate) || 0,
      votes: Number(s.votes) || 0,
      clicks: Number(s.clickcount) || 0,
      latitude: lat != null && isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
      longitude: lon != null && isFinite(lon) && lon >= -180 && lon <= 180 ? lon : null,
    });
  }
  return out;
}

async function get(path: string, params: Record<string, string> = {}): Promise<Station[]> {
  const qs = new URLSearchParams({ hidebroken: 'true', ...params }).toString();
  const res = await fetch(`${API_BASE}${path}?${qs}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Radio Browser error ${res.status}`);
  const data = (await res.json()) as RawStation[];
  if (!Array.isArray(data)) throw new Error('Invalid station data');
  return normalize(data);
}

export const radioApi = {
  /** Top stations by click count (world view) */
  world(limit = 100): Promise<Station[]> {
    return get('/json/stations/search', {
      has_geo_info: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: String(limit),
    });
  },

  /** Stations for a 2-letter country code */
  byCountry(code: string, limit = 50): Promise<Station[]> {
    return get(`/json/stations/bycountrycodeexact/${code.toUpperCase()}`, {
      order: 'clickcount',
      reverse: 'true',
      limit: String(limit),
    });
  },

  /** Search by name, country, and tag in parallel like the original */
  async search(query: string): Promise<Station[]> {
    const q = query.trim().slice(0, 128);
    if (!q) return [];
    const [byName, byCountry, byTag] = await Promise.all([
      get('/json/stations/search', { name: q, order: 'clickcount', reverse: 'true', limit: '40' }).catch(() => [] as Station[]),
      get('/json/stations/search', { country: q, order: 'clickcount', reverse: 'true', limit: '40' }).catch(() => [] as Station[]),
      get('/json/stations/search', { tag: q, order: 'clickcount', reverse: 'true', limit: '40' }).catch(() => [] as Station[]),
    ]);
    const seen = new Set<string>();
    return [...byName, ...byCountry, ...byTag].filter(s => {
      if (seen.has(s.uuid)) return false;
      seen.add(s.uuid);
      return true;
    }).slice(0, 120);
  },

  /** Random stations, excluding recently played */
  random(exclude: string[] = []): Promise<Station[]> {
    return get('/json/stations/search', {
      order: 'random',
      limit: '60',
    }).then(stations => {
      const excluded = new Set(exclude);
      const fresh = stations.filter(s => !excluded.has(s.uuid));
      const pool = fresh.length > 0 ? fresh : stations;
      // Shuffle and take up to 10
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, 10);
    });
  },

  /** Tell Radio Browser this station was played (click count) */
  click(uuid: string): void {
    fetch(`${API_BASE}/json/url/${uuid}`, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
    }).catch(() => {});
  },
};

/** Popular country codes for quick browsing (from original plugin usage) */
export const POPULAR_COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'JP', name: 'Japan' },
  { code: 'BR', name: 'Brazil' },
  { code: 'IN', name: 'India' },
];
