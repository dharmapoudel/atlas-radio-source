// Simplified world map view - the "atlas" in Radio Atlas.
// Equirectangular projection of simplified Natural Earth country geometry
// (derived from the Omarchy plugin's assets/countries.json, public domain).
// Station dots are tappable; tapping a country browses its stations.

import { useMemo, useRef } from 'react';
import world from './world.json';
import { project, MAP_VIEW } from './mapFocus';
import type { Station } from './types';

interface CountryGeom {
  c: string;
  n: string;
  p: number[][][];
}

const COUNTRIES = world as CountryGeom[];

const W = MAP_VIEW.w;
const H = MAP_VIEW.h;

function countryPath(polys: number[][][]): string {
  return polys
    .map(ring => ring.map(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join('') + 'Z')
    .join('');
}

interface Props {
  stations: Station[];
  pinStation: Station | null;
  playingUuid: string | null;
  isPaused: boolean;
  zoom: number;
  pan: { x: number; y: number };
  onPanChange: (p: { x: number; y: number }) => void;
  knobZoom: boolean;
  loading: boolean;
  error: string | null;
  onMapClick: () => void;
  onRetry: () => void;
  onPlayStation: (s: Station) => void;
  onBrowseCountry: (code: string, name: string) => void;
}

export default function WorldMap({ stations, pinStation, playingUuid, isPaused, zoom, pan, onPanChange, knobZoom, loading, error, onMapClick, onRetry, onPlayStation, onBrowseCountry }: Props) {
  const paths = useMemo(
    () => COUNTRIES.map(c => ({ c: c.c, n: c.n, d: countryPath(c.p) })),
    []
  );

  // stations arrive clickcount-ordered; higher zoom reveals more of them.
  // the pinned (playing) station always renders so its halo never vanishes.
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

  // drag-to-pan (pointer events on the svg); pan lives in App so it survives tab switches
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const dragged = useRef(false);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    dragged.current = false;
    drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 8) dragged.current = true;
    const limX = (W / 2) * zoom;
    const limY = (H / 2) * zoom;
    onPanChange({
      x: Math.max(-limX, Math.min(limX, d.px + dx)),
      y: Math.max(-limY, Math.min(limY, d.py + dy)),
    });
  };
  const endDrag = () => { drag.current = null; };

  // taps that end a drag must not trigger station/country clicks
  const tapGuard = () => {
    if (dragged.current) { dragged.current = false; return true; }
    return false;
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-screen">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        role="img"
        aria-label="World map of stations"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => { if (tapGuard()) return; onMapClick(); }}
      >
        <g transform={`translate(${W / 2 + pan.x} ${H / 2 + pan.y}) scale(${zoom}) translate(${-W / 2} ${-H / 2})`}>
        {/* graticule */}
        {Array.from({ length: 11 }, (_, i) => (i + 1) * 30 - 180).map(lon => {
          const [x] = project(lon, 0);
          return <line key={`lon${lon}`} x1={x} y1={0} x2={x} y2={H} stroke="currentColor" className="text-rule" strokeWidth={0.5} />;
        })}
        {Array.from({ length: 5 }, (_, i) => (i + 1) * 30 - 90).map(lat => {
          const [, y] = project(0, lat);
          return <line key={`lat${lat}`} x1={0} y1={y} x2={W} y2={y} stroke="currentColor" className="text-rule" strokeWidth={0.5} />;
        })}

        {/* countries */}
        {paths.map(({ c, n, d }) => (
          <path
            key={c || n}
            d={d}
            className="fill-[#2a3648] stroke-[#93a3b8]"
            strokeWidth={0.6}
            onClick={() => { if (tapGuard()) return; if (/^[A-Z]{2}$/.test(c)) onBrowseCountry(c, n); }}
            style={{ cursor: /^[A-Z]{2}$/.test(c) ? 'pointer' : 'default' }}
          />
        ))}

        {/* station signals: one shared fade instead of hundreds of staggered
            ones, which stuttered on the device */}
        <g className="animate-fade-in">
        {dots.map((s) => {
          const [x, y] = project(s.longitude as number, s.latitude as number);
          const isPlaying = playingUuid === s.uuid;
          return (
            <g
              key={s.uuid}
              onClick={(e) => { e.stopPropagation(); if (tapGuard()) return; onPlayStation(s); }}
              style={{ cursor: 'pointer' }}
              className="station-dot"
              >
              <circle cx={x} cy={y} r={10} fill="transparent" />
              {isPlaying && (
                <circle
                  cx={x}
                  cy={y}
                  r={11}
                  fill="none"
                  className="stroke-accent animate-halo-pulse"
                  strokeWidth={1.5}
                  style={{ animationPlayState: isPaused ? 'paused' : 'running' }}
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={isPlaying ? 6 : 2.5}
                className={isPlaying ? 'fill-accent' : 'fill-[#8494a7]'}
                opacity={isPlaying ? 1 : 0.8}
              />
            </g>
          );
        })}
        </g>
        </g>
      </svg>

      {loading && dots.length === 0 && (
        <div className="absolute inset-0 grid place-items-center bg-screen/60 animate-fade-in">
          <div className="font-mono text-body text-dim animate-pulse-dot">Tuning in…</div>
        </div>
      )}

      {error && dots.length === 0 && !loading && (
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
          ? 'Drag to pan · tap a dot to play · tap a country to browse'
          : 'Tap the map for knob zoom · tap a dot to play'}
      </div>
    </div>
  );
}
