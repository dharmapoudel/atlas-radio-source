// Orthographic globe for the map tab, shown in portrait mode.
// Ported from the original Omarchy Radio Atlas plugin
// (https://github.com/AksharP5/omarchy-radio-atlas, MIT), which used a
// rotatable QML Canvas globe on the Linux desktop. Drag to rotate (with
// kinetic flick), knob to zoom, tap a station signal to play, tap a
// country to browse its stations. Landscape keeps the flat WorldMap.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import world from './world.json';
import type { CountryGeom } from './mapFocus';
import type { Station } from './types';

const COUNTRIES = world as CountryGeom[];

// theme: the original plugin's globe palette, with the app accent
const SPHERE = '#11151a';
const LAND = '#283039';
const GRID = '#7d8791';
const OUTLINE = '#9099a3';
const SIGNAL = '#d9dee3';
const ACCENT = '#f8c03d'; // --color-accent
const BG = '#060809'; // --color-screen

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
// radius = min(w, h) * GLOBE_FRACTION * zoom, like the original plugin
const GLOBE_FRACTION = 0.44;
const MAX_LAT = 78;
const LON_SENS = 0.22;
const LAT_SENS = 0.18;
const HIT_RADIUS = 12;
// kinetic flick, ported from the original's RadioModel.js
const MIN_SPEED = 120; // px/s launch floor
const MAX_SPEED = 2400; // px/s launch cap
const DECEL = 1800; // px/s^2

export interface GlobeRot { lat: number; lon: number; }

interface Props {
  stations: Station[];
  pinStation: Station | null;
  playingUuid: string | null;
  zoom: number; // 1..4, shared with the flat map's knob zoom
  rot: GlobeRot;
  onRotChange: (r: GlobeRot) => void;
  knobZoom: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPlayStation: (s: Station) => void;
  onBrowseCountry: (code: string, name: string) => void;
  onEmptyTap: () => void;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function wrapLon(v: number): number {
  const w = (v + 180) % 360;
  return (w < 0 ? w + 360 : w) - 180;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Qt.lighter(f) / Qt.darker(f) approximation: scale the channels
function shade(hex: string, f: number): string {
  const [r, g, b] = hexRgb(hex).map(c => clamp(Math.round(c * f), 0, 255));
  return `rgb(${r},${g},${b})`;
}

interface Ring { xyz: Float64Array; n: number; }
interface CountryPrep { c: string; n: string; rings: Ring[]; }

function lonLatToXyz(lon: number, lat: number): [number, number, number] {
  const phi = lat * DEG, lam = lon * DEG;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lam), cosPhi * Math.sin(lam), Math.sin(phi)];
}

function prepareCountries(): { countries: CountryPrep[]; maxPoints: number } {
  const countries: CountryPrep[] = [];
  let maxPoints = 0;
  for (const c of COUNTRIES) {
    const rings: Ring[] = [];
    for (const poly of c.p) {
      if (poly.length < 3) continue;
      const xyz = new Float64Array(poly.length * 3);
      for (let i = 0; i < poly.length; i++) {
        const [x, y, z] = lonLatToXyz(poly[i][0], poly[i][1]);
        xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = z;
      }
      rings.push({ xyz, n: poly.length });
      if (poly.length > maxPoints) maxPoints = poly.length;
    }
    if (rings.length > 0) countries.push({ c: c.c, n: c.n, rings });
  }
  return { countries, maxPoints };
}

function prepareGrid(): Ring[] {
  const lines: Ring[] = [];
  const push = (pts: [number, number][]) => {
    const xyz = new Float64Array(pts.length * 3);
    pts.forEach(([lon, lat], i) => {
      const [x, y, z] = lonLatToXyz(lon, lat);
      xyz[i * 3] = x; xyz[i * 3 + 1] = y; xyz[i * 3 + 2] = z;
    });
    lines.push({ xyz, n: pts.length });
  };
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 3) pts.push([lon, lat]);
    push(pts);
  }
  for (let lon = -150; lon <= 180; lon += 30) {
    const pts: [number, number][] = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push([lon, lat]);
    push(pts);
  }
  return lines;
}

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) &&
        lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

interface Dot { station: Station; x: number; y: number; z: number; }

export default function Globe({
  stations, pinStation, playingUuid, zoom, rot, onRotChange,
  knobZoom, loading, error, onRetry, onPlayStation, onBrowseCountry, onEmptyTap,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [highlighted, setHighlighted] = useState<Station | null>(null);

  // rotation is mutated directly during drag/kinetic for 60fps repaints
  // without react re-renders; committed to App state on release
  const rotRef = useRef<GlobeRot>(rot);
  const zoomRef = useRef(zoom);
  const playingRef = useRef(playingUuid);
  zoomRef.current = zoom;
  playingRef.current = playingUuid;
  const liveRef = useRef({ onPlayStation, onBrowseCountry, onEmptyTap, onRotChange });
  liveRef.current = { onPlayStation, onBrowseCountry, onEmptyTap, onRotChange };

  // same dot selection as the flat map: clickcount-ordered, more dots at
  // higher zoom; the playing station always renders so its ring never vanishes
  const dots = useMemo(() => {
    const geo = stations.filter(s => s.latitude != null && s.longitude != null);
    const sliced = geo.slice(0, Math.min(geo.length, Math.round(120 * zoom)));
    if (
      pinStation &&
      pinStation.latitude != null && pinStation.longitude != null &&
      !sliced.some(s => s.uuid === pinStation.uuid)
    ) {
      sliced.unshift(pinStation);
    }
    return sliced;
  }, [stations, zoom, pinStation]);

  const prepCountries = useMemo(prepareCountries, []);
  const prepGrid = useMemo(prepareGrid, []);
  const prepDots = useMemo<Dot[]>(() => dots.map(s => {
    const [x, y, z] = lonLatToXyz(s.longitude as number, s.latitude as number);
    return { station: s, x, y, z };
  }), [dots]);
  const prepDotsRef = useRef(prepDots);
  prepDotsRef.current = prepDots;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const scratch = useRef<{ x: Float64Array; y: Float64Array; d: Float64Array } | null>(null);
  // screen positions of the last painted dots, for tap hit-testing
  const screenDots = useRef<{ station: Station; x: number; y: number }[]>([]);

  const paintRaf = useRef(0);
  const paintQueued = useRef(false);
  const paintRef = useRef<() => void>(() => {});
  const schedulePaint = useCallback(() => {
    if (paintQueued.current) return;
    paintQueued.current = true;
    paintRaf.current = requestAnimationFrame(() => {
      paintQueued.current = false;
      paintRef.current();
    });
  }, []);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w <= 0 || size.h <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(size.w * dpr), ph = Math.round(size.h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw; canvas.height = ph;
    }
    const { w, h } = size;
    const R = Math.min(w, h) * GLOBE_FRACTION * zoomRef.current;
    const cx = w / 2, cy = h / 2;
    const clat = rotRef.current.lat * DEG, clon = rotRef.current.lon * DEG;
    const sinLat = Math.sin(clat), cosLat = Math.cos(clat);
    const sinLon = Math.sin(clon), cosLon = Math.cos(clon);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    if (!isFinite(R) || R <= 0) return;

    // sphere with the original's radial highlight
    const g = ctx.createRadialGradient(
      cx - R * 0.28, cy - R * 0.32, R * 0.04, cx, cy, R);
    g.addColorStop(0, shade(SPHERE, 1.7));
    g.addColorStop(0.62, SPHERE);
    g.addColorStop(1, shade(SPHERE, 1 / 1.8));
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, TAU);
    ctx.clip();

    // graticule, broken at the limb like the original's paintCurve
    ctx.strokeStyle = rgba(GRID, 0.18);
    ctx.lineWidth = Math.min(1.5, Math.max(0.7, R / 500));
    for (const line of prepGrid) {
      let drawing = false;
      ctx.beginPath();
      for (let i = 0; i < line.n; i++) {
        const x = line.xyz[i * 3], y = line.xyz[i * 3 + 1], z = line.xyz[i * 3 + 2];
        const horizontal = x * cosLon + y * sinLon;
        const xp = y * cosLon - x * sinLon;
        const yp = cosLat * z - sinLat * horizontal;
        const depth = sinLat * z + cosLat * horizontal;
        if (depth < 0) { drawing = false; continue; }
        const sx = cx + xp * R, sy = cy - yp * R;
        if (!drawing) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        drawing = true;
      }
      ctx.stroke();
    }

    // countries: fully visible rings fill+stroke; partially visible ones
    // stroke their visible arc and close along the limb (ported from
    // the original plugin's paintCountries)
    if (!scratch.current) {
      scratch.current = {
        x: new Float64Array(prepCountries.maxPoints),
        y: new Float64Array(prepCountries.maxPoints),
        d: new Float64Array(prepCountries.maxPoints),
      };
    }
    const sx = scratch.current.x, sy = scratch.current.y, sd = scratch.current.d;
    ctx.fillStyle = rgba(LAND, 0.9);
    ctx.strokeStyle = rgba(OUTLINE, 0.34);
    ctx.lineWidth = 0.7;
    for (const country of prepCountries.countries) {
      for (const ring of country.rings) {
        const n = ring.n;
        let hiddenIndex = -1;
        for (let i = 0; i < n; i++) {
          const x = ring.xyz[i * 3], y = ring.xyz[i * 3 + 1], z = ring.xyz[i * 3 + 2];
          const horizontal = x * cosLon + y * sinLon;
          sx[i] = y * cosLon - x * sinLon;
          sy[i] = cosLat * z - sinLat * horizontal;
          sd[i] = sinLat * z + cosLat * horizontal;
          if (sd[i] < 0 && hiddenIndex < 0) hiddenIndex = i;
        }
        if (hiddenIndex < 0) {
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const px = cx + sx[i] * R, py = cy - sy[i] * R;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          continue;
        }
        let prevX = sx[hiddenIndex], prevY = sy[hiddenIndex], prevD = sd[hiddenIndex];
        let drawing = false, startAngle = 0;
        for (let step = 1; step <= n; step++) {
          const idx = (hiddenIndex + step) % n;
          const curX = sx[idx], curY = sy[idx], curD = sd[idx];
          const prevVis = prevD >= 0, curVis = curD >= 0;
          if (!prevVis && curVis) {
            const t = prevD / (prevD - curD);
            let ex = prevX + (curX - prevX) * t, ey = prevY + (curY - prevY) * t;
            const len = Math.hypot(ex, ey) || 1; ex /= len; ey /= len;
            startAngle = Math.atan2(-ey, ex);
            ctx.beginPath();
            ctx.moveTo(cx + ex * R, cy - ey * R);
            ctx.lineTo(cx + curX * R, cy - curY * R);
            drawing = true;
          } else if (prevVis && curVis && drawing) {
            ctx.lineTo(cx + curX * R, cy - curY * R);
          } else if (prevVis && !curVis && drawing) {
            const t = prevD / (prevD - curD);
            let ex = prevX + (curX - prevX) * t, ey = prevY + (curY - prevY) * t;
            const len = Math.hypot(ex, ey) || 1; ex /= len; ey /= len;
            const endAngle = Math.atan2(-ey, ex);
            const arc = (startAngle - endAngle + TAU) % TAU;
            ctx.lineTo(cx + ex * R, cy - ey * R);
            ctx.stroke();
            ctx.arc(cx, cy, R, endAngle, startAngle, arc > Math.PI);
            ctx.closePath();
            ctx.fill();
            drawing = false;
          }
          prevX = curX; prevY = curY; prevD = curD;
        }
      }
    }

    // station signals, ported from the original's paintSignals
    const playing = playingRef.current;
    const hl = highlighted;
    screenDots.current = [];
    for (const dot of prepDots) {
      const horizontal = dot.x * cosLon + dot.y * sinLon;
      const xp = dot.y * cosLon - dot.x * sinLon;
      const yp = cosLat * dot.z - sinLat * horizontal;
      const depth = sinLat * dot.z + cosLat * horizontal;
      if (depth < 0) continue;
      const px = cx + xp * R, py = cy - yp * R;
      if (px < -HIT_RADIUS || px > w + HIT_RADIUS ||
          py < -HIT_RADIUS || py > h + HIT_RADIUS) continue;
      const isPlaying = playing === dot.station.uuid;
      const isHl = !!hl && hl.uuid === dot.station.uuid && !isPlaying;
      const r = isPlaying ? 4.2 : isHl ? 3.7 : 1.7 + depth * 1.25;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fillStyle = (isPlaying || isHl) ? ACCENT : SIGNAL;
      ctx.globalAlpha = (isPlaying || isHl) ? 1 : 0.42 + depth * 0.48;
      ctx.fill();
      if (isPlaying || isHl) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(px, py, isPlaying ? 8.5 : 7.5, 0, TAU);
        ctx.strokeStyle = rgba(ACCENT, isPlaying ? 0.72 : 0.92);
        ctx.lineWidth = isPlaying ? 1.2 : 1.4;
        ctx.stroke();
      }
      screenDots.current.push({ station: dot.station, x: px, y: py });
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // limb outline
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.strokeStyle = rgba(OUTLINE, 0.52);
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }, [size, prepCountries, prepGrid, prepDots, highlighted]);

  useEffect(() => {
    paintRef.current = paint;
    schedulePaint();
  });

  // an externally committed rotation (e.g. playback recentering the globe)
  // syncs into the drag-time ref
  useEffect(() => {
    rotRef.current = rot;
    schedulePaint();
  }, [rot, schedulePaint]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(paintRaf.current);
    cancelAnimationFrame(kineticRef.current);
  }, []);

  // drop the landing highlight if its station left the dot list
  useEffect(() => {
    if (highlighted && !prepDots.some(d => d.station.uuid === highlighted.uuid)) {
      setHighlighted(null);
    }
  }, [prepDots, highlighted]);

  const kineticRef = useRef(0);
  const stopKinetic = () => {
    if (kineticRef.current) {
      cancelAnimationFrame(kineticRef.current);
      kineticRef.current = 0;
    }
  };

  const finishKinetic = useCallback(() => {
    // landing highlight: nearest visible station to the globe centre,
    // like the original plugin
    const rot = rotRef.current;
    const clat = rot.lat * DEG, clon = rot.lon * DEG;
    const sinLat = Math.sin(clat), cosLat = Math.cos(clat);
    const sinLon = Math.sin(clon), cosLon = Math.cos(clon);
    const playing = playingRef.current;
    let best: Station | null = null, bestDepth = -Infinity;
    for (const dot of prepDotsRef.current) {
      if (dot.station.uuid === playing) continue;
      const horizontal = dot.x * cosLon + dot.y * sinLon;
      const depth = sinLat * dot.z + cosLat * horizontal;
      if (depth < 0) continue;
      if (depth > bestDepth) { bestDepth = depth; best = dot.station; }
    }
    setHighlighted(best);
    liveRef.current.onRotChange({ ...rotRef.current });
  }, []);

  const launchKinetic = useCallback((vx: number, vy: number) => {
    const speed = Math.hypot(vx, vy);
    if (speed < MIN_SPEED) return;
    const s = Math.min(speed, MAX_SPEED);
    let kvx = vx / speed * s, kvy = vy / speed * s;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const spd = Math.hypot(kvx, kvy);
      if (spd <= 0 || dt <= 0) { kineticRef.current = 0; finishKinetic(); return; }
      const activeTime = Math.min(dt, spd / DECEL);
      const nextSpd = Math.max(0, spd - DECEL * activeTime);
      const dist = (spd + nextSpd) * activeTime / 2;
      const dx = (kvx / spd) * dist, dy = (kvy / spd) * dist;
      const z = zoomRef.current;
      const rot = rotRef.current;
      const lat = clamp(rot.lat + dy * LAT_SENS / z, -MAX_LAT, MAX_LAT);
      const lon = wrapLon(rot.lon - dx * LON_SENS / z);
      kvx = (kvx / spd) * nextSpd;
      kvy = (kvy / spd) * nextSpd;
      if ((lat >= MAX_LAT && kvy > 0) || (lat <= -MAX_LAT && kvy < 0)) kvy = 0;
      rotRef.current = { lat, lon };
      schedulePaint();
      if (Math.hypot(kvx, kvy) > 1e-9) {
        kineticRef.current = requestAnimationFrame(step);
      } else {
        kineticRef.current = 0;
        finishKinetic();
      }
    };
    kineticRef.current = requestAnimationFrame(step);
  }, [finishKinetic, schedulePaint]);

  const dragRef = useRef<null | {
    startX: number; startY: number; lastX: number; lastY: number;
    moved: boolean;
    velX: number; velY: number; velT: number;
    sampleX: number; sampleY: number; sampleT: number;
  }>(null);

  const stationUnderPointer = (x: number, y: number): Station | null => {
    let best: Station | null = null;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    for (const d of screenDots.current) {
      const dx = d.x - x, dy = d.y - y;
      const dist = dx * dx + dy * dy;
      if (dist > bestD) continue;
      best = d.station;
      bestD = dist;
    }
    return best;
  };

  const unproject = (x: number, y: number): { lat: number; lon: number } | null => {
    const rho2 = x * x + y * y;
    if (rho2 > 1) return null;
    const z = Math.sqrt(Math.max(0, 1 - rho2));
    const rot = rotRef.current;
    const phi0 = rot.lat * DEG;
    const cosPhi0 = Math.cos(phi0), sinPhi0 = Math.sin(phi0);
    const lat = Math.asin(clamp(y * cosPhi0 + z * sinPhi0, -1, 1)) / DEG;
    const lon = wrapLon(rot.lon + Math.atan2(x, z * cosPhi0 - y * sinPhi0) / DEG);
    return { lat, lon };
  };

  const activateAt = (x: number, y: number) => {
    setHighlighted(null);
    const station = stationUnderPointer(x, y);
    if (station) {
      liveRef.current.onPlayStation(station);
      return;
    }
    // tapping empty ocean re-engages knob zoom, like tapping the flat map
    liveRef.current.onEmptyTap();
    const { w, h } = sizeRef.current;
    const R = Math.min(w, h) * GLOBE_FRACTION * zoomRef.current;
    if (!(R > 0)) return;
    const coord = unproject((x - w / 2) / R, -(y - h / 2) / R);
    if (!coord) return;
    for (const c of COUNTRIES) {
      if (!/^[A-Z]{2}$/.test(c.c)) continue;
      for (const ring of c.p) {
        if (pointInRing(coord.lon, coord.lat, ring)) {
          liveRef.current.onBrowseCountry(c.c.toUpperCase(), c.n);
          return;
        }
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    stopKinetic();
    setHighlighted(null);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const t = performance.now();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      moved: false,
      velX: 0, velY: 0, velT: 0,
      sampleX: e.clientX, sampleY: e.clientY, sampleT: t,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.lastX, dy = e.clientY - d.lastY;
    d.lastX = e.clientX; d.lastY = e.clientY;
    if (!d.moved &&
        Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 8) {
      d.moved = true;
    }
    if (!d.moved) return;
    const z = zoomRef.current;
    const rot = rotRef.current;
    rotRef.current = {
      lat: clamp(rot.lat + dy * LAT_SENS / z, -MAX_LAT, MAX_LAT),
      lon: wrapLon(rot.lon - dx * LON_SENS / z),
    };
    schedulePaint();
    // velocity sample for flick detection (samples older than 250ms are stale)
    const now = performance.now();
    const dt = now - d.sampleT;
    if (dt > 0 && dt <= 250) {
      const vx = (e.clientX - d.sampleX) * 1000 / dt;
      const vy = (e.clientY - d.sampleY) * 1000 / dt;
      if (isFinite(vx) && isFinite(vy)) {
        if (d.velT > 0) {
          d.velX = d.velX * 0.25 + vx * 0.75;
          d.velY = d.velY * 0.25 + vy * 0.75;
        } else {
          d.velX = vx; d.velY = vy;
        }
        d.velT = now;
      }
    }
    d.sampleX = e.clientX; d.sampleY = e.clientY; d.sampleT = now;
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      const rect = e.currentTarget.getBoundingClientRect();
      activateAt(e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    if (d.velT > 0 && performance.now() - d.velT <= 100) {
      launchKinetic(d.velX, d.velY);
    }
    liveRef.current.onRotChange({ ...rotRef.current });
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-screen">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        role="img"
        aria-label="Rotatable globe of stations"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />

      {loading && screenDots.current.length === 0 && (
        <div className="absolute inset-0 grid place-items-center bg-screen/60 animate-fade-in">
          <div className="font-mono text-body text-dim animate-pulse-dot">Tuning in&hellip;</div>
        </div>
      )}

      {error && screenDots.current.length === 0 && !loading && (
        <div className="absolute inset-0 grid place-items-center bg-screen/60 animate-fade-in">
          <div className="p-8 text-center">
            <div className="font-mono text-body text-warn">{error}</div>
            <button
              onClick={onRetry}
              className="mt-4 rounded border border-edge px-4 py-2 font-mono text-body text-near transition-transform active:scale-95 active:bg-neutral-soft"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-2 left-4 font-mono text-eyebrow text-dim">
        {knobZoom
          ? 'Drag to rotate · tap a dot to play · tap a country to browse'
          : 'Tap the globe for knob zoom · tap a dot to play'}
      </div>
    </div>
  );
}
