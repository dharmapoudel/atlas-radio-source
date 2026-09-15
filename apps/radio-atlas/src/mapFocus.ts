// Shared map math: equirectangular projection plus "focus" views used when
// playback starts (zoom onto the playing station's country, station centered).
import world from './world.json';

interface CountryGeom {
  c: string;
  n: string;
  p: number[][][];
}

const COUNTRIES = world as CountryGeom[];

// matches the WorldMap svg viewBox
export const MAP_VIEW = { w: 800, h: 400 } as const;

export function project(lon: number, lat: number): [number, number] {
  return [((lon + 180) / 360) * MAP_VIEW.w, ((90 - lat) / 180) * MAP_VIEW.h];
}

export interface MapFocus {
  x: number;
  y: number;
  zoom: number;
}

// Focus view for an ISO2 country code: center of the country's largest ring
// (largest by bbox area, so overseas territories don't stretch the view)
// with a zoom that fits it, clamped to the app's 1..4 zoom range.
// Returns null when the code isn't in the bundled geometry.
export function countryFocus(code: string | null | undefined): MapFocus | null {
  if (!code) return null;
  const entry = COUNTRIES.find(c => c.c.toUpperCase() === code.toUpperCase());
  if (!entry) return null;
  let cx0 = 0, cy0 = 0, cx1 = 0, cy1 = 0, best = 0;
  for (const ring of entry.p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [lon, lat] of ring) {
      const [x, y] = project(lon, lat);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const area = (x1 - x0) * (y1 - y0);
    if (area > best) {
      best = area;
      cx0 = x0; cy0 = y0; cx1 = x1; cy1 = y1;
    }
  }
  if (best <= 0) return null;
  const w = Math.max(cx1 - cx0, 1);
  const h = Math.max(cy1 - cy0, 1);
  const zoom = Math.min(4, Math.max(1, Math.min(MAP_VIEW.w / w, MAP_VIEW.h / h) * 0.85));
  return { x: (cx0 + cx1) / 2, y: (cy0 + cy1) / 2, zoom: Math.round(zoom * 4) / 4 };
}
