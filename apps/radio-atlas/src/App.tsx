import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { radioApi, type CountryInfo } from './radioApi';
import { store } from './store';
import { getClient } from './client';
import { TABS, type Station, type TabMode } from './types';
import { shuffled } from './utils';
import WorldMap from './WorldMap';
import { project, MAP_VIEW, countryFocus } from './mapFocus';


function stationMeta(s: Station): string {
  const parts: string[] = [];
  if (s.country) parts.push(s.country);
  if (s.tags) parts.push(s.tags.split(',').slice(0, 2).join(', '));
  if (s.bitrate > 0) parts.push(`${s.bitrate}k`);
  return parts.join(' · ');
}

// stream icy metadata often arrives as raw key="value" pairs, e.g.
// artist - text="title" song_spot="m" mediabaseid="123"; extract the human part
function cleanLiveTitle(raw: string | null | undefined, stationName: string): string | null {
  if (!raw) return null;
  let t = raw.trim();
  if (!t) return null;
  const textAttr = t.match(/text="([^"]+)"/i);
  if (textAttr) {
    const before = t.slice(0, textAttr.index).replace(/[-–—\s]+$/, '').trim();
    t = before ? `${before} - ${textAttr[1]}` : textAttr[1];
  } else {
    t = t.replace(/https?:\/\/\S+/gi, ' ');
    t = t.replace(/(^|[\s(])((www\.)?[\w-]+\.(com|net|org|fm|live|radio|stream|online|us|co|io|me|tv))\b/gi, '$1');
    t = t.replace(/(^|\s+)[A-Za-z_][\w-]*=(?:"[^"]*"|'[^']*'|[^\s]+)/g, '').trim();
    t = t.replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
  }
  if (!t || t.toLowerCase() === stationName.toLowerCase()) return null;
  return t.slice(0, 160);
}

// playback context tagging: our own streams carry "radio-atlas:station:<uuid>",
// while the companion tags phone system media (spotify, podcasts...) as
// "system:<package>:context". the knob never drives the phone otherwise.
const CONTEXT_PREFIX = 'radio-atlas:station:';
const SYSTEM_CONTEXT_PREFIX = 'system:';
const contextUriFor = (uuid: string) => `${CONTEXT_PREFIX}${uuid}`;

// the station directory is unreachable; shared by every list loader
const DIRECTORY_ERROR = 'Could not reach the station directory. Check your connection.';

// shared accent-button treatment (header Random + now-playing play/pause)
const ACCENT_BTN = 'rounded-lg bg-gradient-to-b from-[#facb54] to-[#eda92e] font-body font-semibold text-screen shadow-[0_2px_14px_rgba(248,192,61,0.35)] transition-all hover:brightness-110 active:scale-95';

// last-open-tab persistence: the app reopens on whatever tab was active
const TAB_STORAGE_KEY = 'atlas-radio:tab';

// max volume steps per second: each step is a serial app -> daemon ->
// bluetooth -> phone round trip, so faster bursts queue up and lag.
const VOLUME_THROTTLE_MS = 90;
function loadSavedTab(): TabMode {
  try {
    const t = localStorage.getItem(TAB_STORAGE_KEY);
    if (t && (TABS as string[]).includes(t)) return t as TabMode;
  } catch { /* storage unavailable */ }
  return 'map';
}

// portrait detection: in portrait the daemon pins the page to a 480x800
// layout box and rotates it onto the panel, but the layout viewport stays
// 800x480, so CSS orientation queries never fire. screen.orientation does
// report the rotated orientation, so detect it in JS and reflow with
// conditional classes below. landscape rendering is untouched.
function detectPortrait(): boolean {
  try {
    if (screen.orientation?.type.startsWith('portrait')) return true;
  } catch { /* older webview */ }
  try {
    if (window.matchMedia('(orientation: portrait)').matches) return true;
  } catch { /* no matchMedia */ }
  return false;
}

// Portrait panel split: the two landscape panels (main flex-1, aside w-64)
// stack top/bottom in portrait, each sized proportionally to its landscape
// width (aside = 256px of 800px -> 32%, main = the other 544px -> 68%).
const PORTRAIT_MAIN_FLEX = '68 0 0%';
const PORTRAIT_ASIDE_FLEX = '32 0 0%';

function BrandMark({ playing, isPaused }: { playing: Station | null; isPaused: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
          playing
            ? isPaused
              ? 'bg-accent'
              : 'bg-accent animate-pulse-dot shadow-[0_0_10px_var(--color-accent)]'
            : 'bg-white/15'
        }`}
      />
      <div className="font-display text-xl font-bold tracking-display">RADIO ATLAS</div>
    </div>
  );
}

function SearchForm({ query, setQuery, onSearch, className }: {
  query: string;
  setQuery: (q: string) => void;
  onSearch: (q: string) => void;
  className?: string;
}) {
  return (
    <form
      className={className ?? 'flex flex-1 items-center gap-2'}
      onSubmit={e => { e.preventDefault(); onSearch(query); }}
    >
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search station, country, genre…"
        maxLength={128}
        className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-body text-near placeholder:text-dim transition-colors focus:border-accent/60 focus:bg-white/[0.06] focus:outline-none"
      />
      <button
        type="submit"
        className="h-10 shrink-0 rounded-lg border border-white/10 bg-white/[0.05] px-4 font-body text-body font-medium text-near transition-all hover:bg-white/[0.1] active:scale-95"
      >
        Search
      </button>
    </form>
  );
}

function PlayPauseButton({ audioLoading, isPaused, onToggle, className }: {
  audioLoading: boolean;
  isPaused: boolean;
  onToggle: () => void;
  className: string;
}) {
  const icon = isPaused ? (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 2.3v11.4c0 .8.9 1.3 1.6.9l8.7-5.7c.6-.4.6-1.4 0-1.8L5.6 1.4c-.7-.4-1.6.1-1.6.9z" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="2" width="4" height="12" rx="1.2" />
      <rect x="9" y="2" width="4" height="12" rx="1.2" />
    </svg>
  );
  return (
    <button onClick={onToggle} className={className}>
      {audioLoading ? '…' : (
        <span className="flex items-center justify-center gap-2">
          {icon}
          {isPaused ? 'Play' : 'Pause'}
        </span>
      )}
    </button>
  );
}

export default function App() {
  const [tab, setTab] = useState<TabMode>(loadSavedTab);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [country, setCountry] = useState<{ code: string; name: string } | null>(null);

  const [playing, setPlaying] = useState<Station | null>(null);
  const playingRef = useRef<Station | null>(null);
  playingRef.current = playing;
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [liveTitle, setLiveTitle] = useState<string | null>(null);

  const [favorites, setFavorites] = useState<Station[]>(() => store.getFavorites());
  const [recent, setRecent] = useState<Station[]>(() => store.getRecent());
  // country tiles on the Countries tab; long-press a tile to swap it for
  // another country. persisted so custom tiles survive relaunch.
  const [tiles, setTiles] = useState<{ code: string; name: string }[]>(() => store.getCountryTiles());
  const [tilePickerIndex, setTilePickerIndex] = useState<number | null>(null);
  const [allCountries, setAllCountries] = useState<CountryInfo[] | null>(null);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [countriesError, setCountriesError] = useState<string | null>(null);
  const [pressingTile, setPressingTile] = useState<number | null>(null);
  const tilePressTimer = useRef<number | null>(null);
  const tilePressStart = useRef<{ x: number; y: number } | null>(null);
  const tileLongPressFired = useRef(false);
  const countriesFetched = useRef(false);
  // guards against a single knob press arriving as two key events, which
  // would pause then instantly resume
  const lastToggleAt = useRef(0);
  // on the map tab the knob zooms by default; tapping a station dot hands it
  // to volume while the stream plays, tapping the map takes it back
  const [mapKnobZoom, setMapKnobZoom] = useState(true);
  // after a station is selected the knob drives the phone volume for
  // 8s, then hands back to the list
  const knobVolumeUntil = useRef(0);
  // tap focus for the knob in list tabs: true while the last tap landed
  // inside the list content; a tap outside hands the knob to volume
  // until the list is tapped again
  const [listKnobFocus, setListKnobFocus] = useState(true);
  // set when a tab switch (tap or key) intentionally focuses the list,
  // so the click bubbling up to the root div afterwards does not
  // immediately undo it (the tab buttons live outside the list)
  const skipFocusSync = useRef(false);
  // portrait layout (480x800): the daemon rotates the page, so reflow to a
  // vertical stack with a compact now-playing bar. landscape is untouched.
  const [isPortrait, setIsPortrait] = useState<boolean>(detectPortrait);
  useEffect(() => {
    const update = () => setIsPortrait(detectPortrait());
    let orientation: ScreenOrientation | null = null;
    let mq: MediaQueryList | null = null;
    try {
      orientation = screen.orientation;
      orientation.addEventListener('change', update);
      mq = window.matchMedia('(orientation: portrait)');
      mq.addEventListener('change', update);
    } catch { /* listeners unavailable */ }
    return () => {
      try {
        orientation?.removeEventListener('change', update);
        mq?.removeEventListener('change', update);
      } catch { /* ignore */ }
    };
  }, []);
  // the map's own station pool, denser than the world list so zooming in
  // can reveal more dots
  const [mapStations, setMapStations] = useState<Station[]>([]);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const mapPoolFresh = useRef(false);
  // true only while this app owns the phone's current playback: set when the
  // user starts a station here, or when the phone confirms a restored session
  // is ours via the playback context uri. the knob never drives the phone
  // otherwise (e.g. phone playing spotify).
  const ownsPlayback = useRef(false);
  // the phone moved on to something else: drop our session and say so honestly
  const [externalTitle, setExternalTitle] = useState<string | null>(null);
  const noteExternalPlayback = useCallback((trackTitle: string | null | undefined, paused: boolean) => {
    setPlaying(null);
    setSelectedUuid(null);
    setLiveTitle(null);
    setAudioLoading(false);
    setAudioError(null);
    setIsPaused(paused);
    ownsPlayback.current = false;
    setMapKnobZoom(true);
    store.setNowPlaying(null);
    const t = (trackTitle ?? '').trim();
    setExternalTitle(t ? t : 'something');
    setMapZoom(1);
  }, []);
  // guards background refreshes from overwriting a newer tab's stations
  const loadSeq = useRef(0);

  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  // knob-driven highlight: index into the visible station list, or into the
  // country tile grid when the countries tab shows tiles
  const [highlight, setHighlight] = useState(0);
  const [tileHighlight, setTileHighlight] = useState(0);
  const listRef = useRef<HTMLElement | null>(null);

  // ---- data loading ----
  // station lists are cached in localstorage and refreshed in the background,
  // center the map on a station: its coordinates when known, otherwise the
  // country view. the map tab recenters on the playing station every time it
  // opens so the halo dot lands in the middle of the screen. the default
  // zoom is 1 at rest and 1.5 while a stream is playing.
  const focusStation = useCallback((station: Station) => {
    const { latitude: lat, longitude: lon } = station;
    const geo: [number, number] | null =
      lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)
        ? project(lon, lat)
        : null;
    const focus = countryFocus(station.countryCode);
    const target = geo ? { x: geo[0], y: geo[1] } : focus;
    if (!target) return;
    const z = 1.5;
    setMapZoom(z);
    setMapPan({ x: z * (MAP_VIEW.w / 2 - target.x), y: z * (MAP_VIEW.h / 2 - target.y) });
  }, []);

  const playStation = useCallback((station: Station) => {
    const client = getClient();
    setAudioError(null);
    setAudioLoading(true);
    setIsPaused(false);
    setLiveTitle(null);
    setPlaying(station);
    setSelectedUuid(station.uuid);
    setMapKnobZoom(false);
    focusStation(station);
    store.setNowPlaying(station);
    setExternalTitle(null);
    ownsPlayback.current = true;
    knobVolumeUntil.current = Date.now() + 8000;
    client.player.play({ uri: station.url, context: { contextUri: contextUriFor(station.uuid) } }).catch(() => {
      setAudioLoading(false);
      setAudioError('Could not reach the daemon. Is the device on?');
    });
    radioApi.click(station.uuid);
    setRecent(store.recordPlayed(station));
  }, [focusStation]);

  // so tabs open instantly after the first load. a failed fetch retries once
  // after a delay, since the phone gateway proxy is often not up yet at launch.

  const loadCached = useCallback(async (
    key: string,
    fetchFresh: () => Promise<Station[]>,
    emptyError: string,
    shuffle = false,
  ) => {
    const seq = ++loadSeq.current;
    setError(null);
    const apply = (data: Station[]) => setStations(shuffle ? shuffled(data) : data);
    const cached = store.getCachedStations(key);
    if (cached) {
      apply(cached.data);
      setLoading(false);
      fetchFresh().then(data => {
        if (loadSeq.current !== seq) return;
        store.setCachedStations(key, data);
        apply(data);
      }).catch(() => {});
      return;
    }
    setLoading(true);
    const attempt = async (): Promise<Station[]> => {
      try {
        return await fetchFresh();
      } catch {
        await new Promise(r => setTimeout(r, 2500));
        return fetchFresh();
      }
    };
    try {
      const data = await attempt();
      if (loadSeq.current !== seq) return;
      store.setCachedStations(key, data);
      apply(data);
    } catch (e) {
      if (loadSeq.current === seq) setError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : emptyError);
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, []);

  const loadWorld = useCallback(async (opts?: { shuffle?: boolean }) => {
    setCountry(null);
    await loadCached('world', () => radioApi.world(100), DIRECTORY_ERROR, opts?.shuffle ?? false);
  }, [loadCached]);

  // top 500 geo stations by clicks, clickcount order so zooming in reveals
  // progressively less popular dots. cached with a 500-entry cap so coming
  // back to the tab restores the full pool instead of a truncated one.
  const loadMapStations = useCallback(async () => {
    const cached = store.getCachedStations('world-map');
    if (cached) {
      setMapStations(cached.data);
      setMapLoading(false);
    } else {
      setMapLoading(true);
    }
    setMapError(null);
    if (mapPoolFresh.current) return;
    mapPoolFresh.current = true;
    try {
      const data = await radioApi.world(500);
      store.setCachedStations('world-map', data, 500);
      setMapStations(data);
    } catch (e) {
      if (!cached) setMapError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : DIRECTORY_ERROR);
    } finally {
      setMapLoading(false);
    }
  }, []);

  const switchTab = useCallback((t: TabMode) => {
    setTab(t);
    try { localStorage.setItem('atlas-radio:tab', t); } catch { /* storage unavailable */ }
    setError(null);
    setHighlight(0);
    setTileHighlight(0);
    skipFocusSync.current = true;
    setListKnobFocus(true);
    if (t === 'favorites' || t === 'recent') {
      // Local tabs: data comes from on-device storage, no network fetch.
      // Clear any in-flight loading state so the list renders immediately
      // instead of sitting on "Tuning in..." until a background fetch lands.
      setLoading(false);
      return;
    }
    setMapKnobZoom(true);
    if (t === 'map') {
      const p = playingRef.current;
      if (p) focusStation(p);
    }
    // the world listing is re-randomized every time the tab opens
    if (t === 'world') loadWorld({ shuffle: true });
    if (t === 'map') loadMapStations();
    if (t === 'country') { setCountry(null); setStations([]); }
  }, [loadWorld, loadMapStations, focusStation]);

  const loadCountry = useCallback(async (code: string, name: string) => {
    switchTab('country');
    setCountry({ code, name });
    await loadCached(`country:${code}`, () => radioApi.byCountry(code, 50), DIRECTORY_ERROR);
  }, [loadCached, switchTab]);

  const cancelTilePress = useCallback(() => {
    if (tilePressTimer.current) {
      clearTimeout(tilePressTimer.current);
      tilePressTimer.current = null;
    }
    tilePressStart.current = null;
    setPressingTile(null);
  }, []);

  // fetches the full stream-country list once; the result is cached for a week
  const fetchCountries = useCallback(() => {
    if (countriesFetched.current) return;
    countriesFetched.current = true;
    setCountriesLoading(true);
    setCountriesError(null);
    radioApi.countries()
      .then(list => {
        store.setCachedCountries(list);
        setAllCountries(list);
        setCountriesLoading(false);
      })
      .catch(() => {
        countriesFetched.current = false;
        setCountriesError('Could not load the country list. Check your connection.');
        setCountriesLoading(false);
      });
  }, []);

  const openTilePicker = useCallback((index: number) => {
    setTilePickerIndex(index);
    if (!allCountries) fetchCountries();
  }, [allCountries, fetchCountries]);

  const closeTilePicker = useCallback(() => setTilePickerIndex(null), []);

  const pickCountryTile = useCallback((index: number, c: CountryInfo) => {
    setTiles(prevTiles => {
      const next = prevTiles.map((t, i) => (i === index ? { code: c.code, name: c.name } : t));
      store.setCountryTiles(next);
      return next;
    });
    setTilePickerIndex(null);
  }, []);

  const retryCountries = useCallback(() => {
    // countriesFetched is false after a failure, so this refetches
    fetchCountries();
  }, [fetchCountries]);

  const onTilePointerDown = (index: number, e: React.PointerEvent) => {
    tileLongPressFired.current = false;
    tilePressStart.current = { x: e.clientX, y: e.clientY };
    setPressingTile(index);
    tilePressTimer.current = window.setTimeout(() => {
      tilePressTimer.current = null;
      tilePressStart.current = null;
      tileLongPressFired.current = true;
      setPressingTile(null);
      openTilePicker(index);
    }, 550);
  };

  const onTilePointerMove = (e: React.PointerEvent) => {
    const s = tilePressStart.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) cancelTilePress();
  };

  const onTileClick = (code: string, name: string) => {
    // a tap that ends a long-press must not also open the country
    if (tileLongPressFired.current) {
      tileLongPressFired.current = false;
      return;
    }
    loadCountry(code, name);
  };

  const runSearch = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text) {
      // empty search resets to the world tab, which re-randomizes on open
      switchTab('world');
      return;
    }
    setLoading(true);
    setError(null);
    setTab('search');
    setCountry(null);
    try {
      const data = await radioApi.search(text);
      setStations(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [switchTab]);

  const tuneRandom = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const exclude = recent.slice(0, 30).map(s => s.uuid);
      if (playing) exclude.push(playing.uuid);
      const data = await radioApi.random(exclude);
      setStations(data);
      skipFocusSync.current = true;
      setListKnobFocus(true);
      setTab('world');
      setCountry(null);
      if (data.length > 0) playStation(data[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not tune randomly');
    } finally {
      setLoading(false);
    }
  }, [recent, playing, playStation]);

  useEffect(() => {
    loadWorld({ shuffle: true });
    loadMapStations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // prefetch the stream-country list at startup so the tile picker opens
  // instantly; a fresh-enough localStorage copy is used with no fetch at all
  useEffect(() => {
    const cached = store.getCachedCountries();
    if (cached) {
      setAllCountries(cached);
      return;
    }
    fetchCountries();
  }, [fetchCountries]);

  // ---- playback via the phone ----
  // The Car Thing has no speaker, so streams play on the phone through the
  // companion's stream provider (claims http/https). Now-playing state and
  // errors arrive back over client.player events.

  const togglePlayPause = useCallback(() => {
    const now = Date.now();
    if (now - lastToggleAt.current < 700) return;
    lastToggleAt.current = now;
    // explicit check: never drive the phone's playback unless this app
    // started (or verified) the current stream
    if (!playing || !ownsPlayback.current) return;
    const client = getClient();
    if (isPaused) {
      client.player.resume().catch(() => setAudioError('Could not resume playback'));
    } else {
      client.player.pause().catch(() => {});
    }
  }, [playing, isPaused]);

  const stop = useCallback(() => {
    getClient().player.pause().catch(() => {});
    setPlaying(null);
    setIsPaused(false);
    setAudioLoading(false);
    setAudioError(null);
    setLiveTitle(null);
    setMapKnobZoom(true);
    setMapZoom(1);
    store.setNowPlaying(null);
    ownsPlayback.current = false;
  }, []);

  // phone now-playing snapshots and player errors
  useEffect(() => {
    const client = getClient();
    const offSnapshot = client.player.onSnapshot(reply => {
      const st = reply.state;
      const state = st.playback.state;
      const ctxUri = st.context?.uri ?? null;
      // external takeover: never show a foreign track as our live title,
      // and never keep claiming the station is playing
      if (ctxUri && ctxUri.startsWith(SYSTEM_CONTEXT_PREFIX)) {
        noteExternalPlayback(st.track?.title, state === 'paused');
        return;
      }
      setExternalTitle(null);
      setIsPaused(state === 'paused');
      if (state === 'playing') {
        setAudioLoading(false);
        setAudioError(null);
        const title = st.track?.title ?? null;
        setLiveTitle(t => cleanLiveTitle(title, playingRef.current?.name ?? '') ?? t);
      } else if (state === 'stopped') {
        setAudioLoading(false);
        setMapKnobZoom(true);
      }
    });
    const offError = client.player.onErrorReply(reply => {
      const err = reply.error;
      setAudioLoading(false);
      if (err.type === 'noGateway') {
        setAudioError('Connect your phone to hear audio.');
      } else if (err.type === 'schemeUnclaimed') {
        setAudioError('Update the companion app to play streams.');
      } else if (err.type === 'playFailed') {
        setAudioError('Stream failed. Try another station.');
      } else {
        setAudioError('Could not play this station. Try another.');
      }
    });
    const offStreamError = client.player.onErrorEvent(reply => {
      if (reply.error.type === 'playFailed') {
        setAudioLoading(false);
        setAudioError('Stream failed. Try another station.');
      }
    });
    // prime from the phone's current state in case it is already playing.
    // a previous session is only restored when the phone confirms the stream
    // is ours: via the playback context uri, or (the companion's stream
    // provider drops the play context) by matching the playing track's uri
    // against the persisted station's stream url. otherwise the knob must
    // not touch the phone's playback (e.g. spotify).
    client.player.stateGet().then(res => {
      if (!res.ok) return;
      const st = res.response.state;
      const ctxUri = st.context?.uri;
      // phone is on external media: show it honestly instead of "pick a station"
      if (ctxUri && ctxUri.startsWith(SYSTEM_CONTEXT_PREFIX)) {
        noteExternalPlayback(st.track?.title, st.playback.state === 'paused');
        return;
      }
      const active = st.playback.state === 'playing' || st.playback.state === 'paused';
      const np = store.getNowPlaying();
      // a restored session shows the station and centers the map on it, but
      // the knob stays on its default (zoom): volume mode is entered by
      // tapping a station dot.
      const restore = (station: Station) => {
        setPlaying(station);
        setSelectedUuid(station.uuid);
        setIsPaused(st.playback.state === 'paused');
        setAudioLoading(false);
        ownsPlayback.current = true;
        focusStation(station);
      };
      if (active && !!ctxUri && ctxUri.startsWith(CONTEXT_PREFIX)) {
        const uuid = ctxUri.slice(CONTEXT_PREFIX.length);
        if (np && np.uuid === uuid) restore(np);
      } else if (active && np && !!st.track?.uri && st.track.uri === np.url) {
        restore(np);
      } else if (!active) {
        store.setNowPlaying(null);
      }
    }).catch(() => {});
    return () => { offSnapshot(); offError(); offStreamError(); };
    // subscribes once: live-title cleaning reads the ref, so a new station
    // doesn't tear down and rebuild the phone listeners
  }, [noteExternalPlayback, focusStation]);

  const toggleFavorite = useCallback((station: Station) => {
    setFavorites(store.toggleFavorite(station));
  }, []);

  // phone volume is knob-only: relative steps route over iap2 hid and move the
  // phone's volume. absolute setvolume never reaches the phone on ios.
  // throttled: each detent is a full app -> daemon -> bluetooth -> phone round
  // trip, all serial, so an unthrottled burst queues up and the volume keeps
  // moving after the knob stops. leading edge sends immediately, then at most
  // one step per VOLUME_THROTTLE_MS, with a trailing flush for the burst tail.
  const lastVolumeSentAt = useRef(0);
  const pendingVolumeDir = useRef<0 | 1 | -1>(0);
  const volumeFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushVolume = useCallback(() => {
    volumeFlushTimer.current = null;
    const dir = pendingVolumeDir.current;
    pendingVolumeDir.current = 0;
    if (dir === 0) return;
    lastVolumeSentAt.current = Date.now();
    const client = getClient();
    if (dir > 0) client.audio.volumeUp().catch(() => {});
    else client.audio.volumeDown().catch(() => {});
  }, []);
  const nudgeVolume = useCallback((dir: 1 | -1) => {
    const now = Date.now();
    if (volumeFlushTimer.current === null && now - lastVolumeSentAt.current >= VOLUME_THROTTLE_MS) {
      lastVolumeSentAt.current = now;
      const client = getClient();
      if (dir > 0) client.audio.volumeUp().catch(() => {});
      else client.audio.volumeDown().catch(() => {});
      return;
    }
    pendingVolumeDir.current = dir;
    if (volumeFlushTimer.current === null) {
      const wait = Math.max(0, VOLUME_THROTTLE_MS - (now - lastVolumeSentAt.current));
      volumeFlushTimer.current = setTimeout(flushVolume, wait);
    }
  }, [flushVolume]);
  useEffect(() => () => {
    if (volumeFlushTimer.current !== null) clearTimeout(volumeFlushTimer.current);
  }, []);

  const visibleStations = useMemo(() => {
    if (tab === 'favorites') return favorites;
    if (tab === 'recent') return recent;
    return stations;
  }, [tab, favorites, recent, stations]);

  // knob highlight clamped to the current list length
  const clampedHl = visibleStations.length === 0 ? 0 : Math.min(highlight, visibleStations.length - 1);

  // knob press (space/enter on the Car Thing): in a station list it plays the
  // highlighted station, on the countries tile grid it opens the highlighted
  // tile, on the map it toggles play/pause. guarded against a single press
  // arriving as two key events.
  const lastPressAt = useRef(0);
  const knobPress = useCallback(() => {
    const now = Date.now();
    if (now - lastPressAt.current < 700) return;
    lastPressAt.current = now;
    if (tab === 'country' && !country) {
      const t = tiles[Math.min(tileHighlight, tiles.length - 1)];
      if (t) onTileClick(t.code, t.name);
      return;
    }
    if (tab === 'map') { togglePlayPause(); return; }
    const s = visibleStations[clampedHl];
    if (s) { setSelectedUuid(s.uuid); playStation(s); }
  }, [tab, country, tiles, tileHighlight, togglePlayPause, visibleStations, clampedHl, playStation]);

  // keyboard shortcuts (from original: space, r, f, +/-)
  // note: "m" is the Mode button on Car Thing, so mute is on-screen only.
  // the M button handles back/exit at the firmware level now, so the app no
  // longer binds Escape to anything.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); knobPress(); }
      else if (e.key === 'r' || e.key === 'R') tuneRandom();
      else if (e.key === '+' || e.key === '=') nudgeVolume(1);
      else if (e.key === '-' || e.key === '_') nudgeVolume(-1);
      else if (e.key === '1') switchTab('map');
      else if (e.key === '2') switchTab('world');
      else if (e.key === '3') switchTab('country');
      else if (e.key === '4') switchTab('favorites');
      else if (e.key === '5') switchTab('recent');
      else if ((e.key === 'f' || e.key === 'F') && selectedUuid) {
        const s = stations.find(x => x.uuid === selectedUuid);
        if (s) toggleFavorite(s);
      }
    };
    // rotary knob: horizontal deltaX (Car Thing wheel). on the map tab it
    // zooms while the knob is in zoom mode, or nudges the phone volume once a
    // station dot hands it to volume; in a list tab it moves the highlight
    // through the list, except for 8s after a station is selected or when
    // knob focus is outside the list, when it nudges the phone volume.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const dir = e.deltaX > 0 ? 1 : -1;
        if (tab === 'map') {
          if (mapKnobZoom) {
            setMapZoom(z => Math.max(1, Math.min(4, z + dir * 0.25)));
          } else {
            nudgeVolume(dir);
          }
        } else if (tab === 'country' && !country) {
          // 5s volume window after selecting, or knob focus outside the
          // list: drive the phone volume instead of moving the highlight
          if (Date.now() < knobVolumeUntil.current || !listKnobFocus) nudgeVolume(dir);
          else setTileHighlight(h => Math.max(0, Math.min(tiles.length - 1, h + dir)));
        } else {
          if (Date.now() < knobVolumeUntil.current || !listKnobFocus) nudgeVolume(dir);
          else setHighlight(h => Math.max(0, Math.min(visibleStations.length - 1, h + dir)));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }, [knobPress, tuneRandom, selectedUuid, stations, toggleFavorite, tab, mapKnobZoom, nudgeVolume, tiles, visibleStations, country, listKnobFocus, switchTab]);

  const favUuids = useMemo(() => new Set(favorites.map(f => f.uuid)), [favorites]);

  // keep the knob highlight visible while turning the knob through a list
  useEffect(() => {
    if (tab === 'country' && !country) return;
    listRef.current?.querySelector('[data-knob-hl="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [highlight, tab, country, visibleStations]);


  return (
    <div
      className="relative flex h-full w-full flex-col text-off-white"
      // any deliberate tap outside the map area hands the knob to volume;
      // in a list tab a tap outside the list content moves knob focus out,
      // so rotation drives the phone volume until the list is tapped again
      onClick={(e) => {
        if (tab === 'map') { setMapKnobZoom(false); return; }
        if (skipFocusSync.current) {
          // the tap that switched tabs just bubbled here; the switch
          // already focused the list, so leave it alone
          skipFocusSync.current = false;
          return;
        }
        setListKnobFocus(listRef.current?.contains(e.target as Node) ?? false);
      }}
    >

      {/* header: portrait stacks the search under the brand row so the
          input gets full width in the 480px layout */}
      {isPortrait ? (
        <header className="shrink-0 border-b border-rule bg-white/[0.02] px-4 pb-3 pt-3">
          <div className="flex items-center justify-between gap-3">
            <BrandMark playing={playing} isPaused={isPaused} />
            <button
              onClick={tuneRandom}
              title="Tune randomly (R)"
              className={`h-10 shrink-0 px-4 text-body ${ACCENT_BTN}`}
            >
              Random
            </button>
          </div>
          <SearchForm query={query} setQuery={setQuery} onSearch={runSearch} className="mt-2.5 flex items-center gap-2" />
        </header>
      ) : (
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-rule bg-white/[0.02] px-4">
          <BrandMark playing={playing} isPaused={isPaused} />
          <SearchForm query={query} setQuery={setQuery} onSearch={runSearch} />
          <button
            onClick={tuneRandom}
            title="Tune randomly (R)"
            className={`h-10 px-4 text-body ${ACCENT_BTN}`}
          >
            Random
          </button>
        </header>
      )}

      {/* tabs */}
      <nav className={`flex h-11 shrink-0 items-center gap-1 border-b border-rule px-4${isPortrait ? ' overflow-x-auto' : ''}`}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`rounded-full px-4 py-1.5 font-body text-body font-medium capitalize transition-all active:scale-95${isPortrait ? ' shrink-0' : ''} ${
              tab === t
                ? 'bg-accent text-screen shadow-[0_2px_10px_rgba(248,192,61,0.35)]'
                : 'text-dim hover:bg-white/[0.06] hover:text-near'
            }`}
          >
            {t === 'country' ? 'Countries' : t}
            {t === 'favorites' && favorites.length > 0 && (
              <span className="ml-1 text-hint">({favorites.length})</span>
            )}
          </button>
        ))}
        {!isPortrait && (
          <div className="ml-auto font-mono text-hint text-dim">
            {country ? `${country.name}` : visibleStations.length > 0 ? `${visibleStations.length} stations` : ''}
          </div>
        )}
      </nav>

      {/* body */}
      <div className={`flex min-h-0 flex-1${isPortrait ? ' flex-col' : ''}`}>
        {/* station list / country grid / map */}
        <main key={tab} ref={listRef} className="min-w-0 flex-1 overflow-y-auto animate-fade-in" style={isPortrait ? { flex: PORTRAIT_MAIN_FLEX } : undefined}>
          {tab === 'map' ? (
            <div className="h-full w-full">
              <WorldMap
                stations={mapStations}
                pinStation={playing}
                playingUuid={playing?.uuid ?? null}
                isPaused={isPaused}
                zoom={mapZoom}
                pan={mapPan}
                onPanChange={setMapPan}
                knobZoom={mapKnobZoom}
                loading={mapLoading}
                error={mapError}
                onMapClick={() => setMapKnobZoom(true)}
                onRetry={loadMapStations}
                onPlayStation={playStation}
                onBrowseCountry={(code, name) => loadCountry(code, name)}
              />
            </div>
          ) : tab === 'country' && !country ? (
            <div className={isPortrait
              ? 'grid h-full auto-rows-fr grid-cols-2 gap-2 p-3 animate-fade-up'
              : 'grid h-full grid-cols-3 grid-rows-4 gap-2 p-3 animate-fade-up'}>
              {tiles.map((c, i) => (
                <button
                  key={c.code}
                  onClick={() => onTileClick(c.code, c.name)}
                  onPointerDown={(e) => onTilePointerDown(i, e)}
                  onPointerUp={cancelTilePress}
                  onPointerCancel={cancelTilePress}
                  onPointerLeave={cancelTilePress}
                  onPointerMove={onTilePointerMove}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`rounded-lg border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.01] p-3 text-left transition-all hover:border-accent/40 active:bg-neutral-soft ${pressingTile === i ? 'scale-95 border-accent/60' : ''} ${i === tileHighlight ? 'bg-white/[0.05]' : ''}`}
                >
                  <div className="truncate font-display text-row font-medium">{c.name}</div>
                  <div className="font-mono text-hint text-dim">{c.code}</div>
                </button>
              ))}
            </div>
          ) : loading ? (
            <div className="grid h-full place-items-center font-mono text-body text-dim">
              Tuning in…
            </div>
          ) : error ? (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <div className="font-mono text-body text-warn">{error}</div>
                <button
                  onClick={() => (tab === 'country' && country ? loadCountry(country.code, country.name) : loadWorld({ shuffle: true }))}
                  className="mt-4 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 font-body text-body font-medium text-near transition-all hover:bg-white/[0.1] active:scale-95"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : visibleStations.length === 0 ? (
            <div className="grid h-full place-items-center p-8 text-center font-mono text-body text-dim">
              {tab === 'favorites'
                ? 'No favorites yet. Tap ★ on a station to save it.'
                : tab === 'recent'
                  ? 'No listening history yet.'
                  : 'No stations found.'}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-rule">
              {visibleStations.map((s, i) => {
                const isPlaying = playing?.uuid === s.uuid;
                const isFav = favUuids.has(s.uuid);
                const isHl = i === clampedHl;
                return (
                  <li key={s.uuid}>
                    <div
                      data-knob-hl={isHl ? 'true' : undefined}
                      className={`flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03] ${isPlaying ? 'bg-accent-soft shadow-[inset_2px_0_0_0_var(--color-accent)]' : ''} ${selectedUuid === s.uuid ? 'bg-neutral-soft' : ''} ${isHl ? 'bg-white/[0.06]' : ''}`}
                    >
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => { setSelectedUuid(s.uuid); playStation(s); }}
                      >
                        <div className="truncate font-body text-row font-medium text-near">
                          {isPlaying && !isPaused ? '▶ ' : ''}{s.name}
                        </div>
                        <div className="truncate font-mono text-hint text-dim">{stationMeta(s)}</div>
                      </button>
                      <button
                        onClick={() => toggleFavorite(s)}
                        title={isFav ? 'Remove favorite' : 'Add favorite (F)'}
                        className={`shrink-0 rounded px-2 py-1 font-mono text-row ${isFav ? 'text-accent' : 'text-dim'}`}
                      >
                        {isFav ? '★' : '☆'}
                      </button>
                    </div>
                  </li>
                );
              })}
              </ul>
              {tab === 'recent' && visibleStations.length > 0 && (
                <button
                  onClick={() => setRecent(store.clearRecent())}
                  className="block w-full border-t border-rule px-4 py-3 text-center font-mono text-hint text-dim transition-colors hover:text-err active:bg-neutral-soft"
                >
                  Clear recent history
                </button>
              )}
              {tab === 'favorites' && visibleStations.length > 0 && (
                <button
                  onClick={() => setFavorites(store.clearFavorites())}
                  className="block w-full border-t border-rule px-4 py-3 text-center font-mono text-hint text-dim transition-colors hover:text-err active:bg-neutral-soft"
                >
                  Clear all favorites
                </button>
              )}
            </>
          )}
        </main>

        {/* now playing: portrait stacks the two landscape panels top/bottom,
            the aside taking 32% below the list (proportional to its w-64
            landscape width) with its full content intact */}
        <aside
          className={isPortrait
            ? 'flex shrink-0 flex-col overflow-y-auto border-t border-rule bg-screen px-3 py-4'
            : 'flex w-64 shrink-0 flex-col border-l border-rule bg-screen px-3 py-4'}
          style={isPortrait ? { flex: PORTRAIT_ASIDE_FLEX } : undefined}
        >
          <div className="font-mono text-eyebrow uppercase tracking-[0.2em] text-dim">Now playing</div>
          {playing ? (
            <>
              <div key={playing.uuid} className="mt-2 font-display text-hero font-medium leading-tight animate-fade-up">
                {audioLoading ? <span className="animate-pulse-dot">Tuning…</span> : playing.name}
              </div>
              <div className="mt-1 font-mono text-hint text-dim">{stationMeta(playing)}</div>
              {liveTitle && !audioLoading && (
                <div key={liveTitle} className="mt-1 font-body text-body text-accent animate-fade-in">♪ {liveTitle}</div>
              )}
              {audioError && (
                <div className="mt-2 font-mono text-hint text-warn">{audioError}</div>
              )}
              <div className={isPortrait ? 'mt-4 flex gap-2' : 'mt-12 flex gap-2'}>
                <PlayPauseButton
                  audioLoading={audioLoading}
                  isPaused={isPaused}
                  onToggle={togglePlayPause}
                  className={`flex-1 px-3 py-2.5 text-row ${ACCENT_BTN}`}
                />
                <button
                  onClick={stop}
                  className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2.5 font-body text-row text-near transition-all hover:bg-white/[0.1] active:scale-95"
                >
                  ■
                </button>
                <button
                  onClick={() => toggleFavorite(playing)}
                  className={`rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2.5 font-body text-row transition-all hover:bg-white/[0.1] active:scale-95 ${favUuids.has(playing.uuid) ? 'text-accent' : 'text-dim'}`}
                >
                  {favUuids.has(playing.uuid) ? '★' : '☆'}
                </button>
              </div>
            </>
          ) : externalTitle ? (
            <>
              <div className="mt-2 font-display text-hero font-medium leading-tight animate-fade-up">On your phone</div>
              <div className="mt-1 truncate font-body text-body text-accent">♪ {externalTitle}</div>
              <div className="mt-4 font-mono text-hint text-dim">Pick a station to take over.</div>
            </>
          ) : (
            <div className="mt-2 font-body text-body text-dim">
              Pick a station to start listening.
            </div>
          )}

          {!isPortrait && (
          <div className="mt-auto pt-4 font-mono text-[10px] leading-relaxed text-dim">
            1-5 tabs · R random · F favorite<br />
            {tab === 'map' ? (
              <>{'Knob press: play/pause'}<br />{mapKnobZoom ? 'Knob turn: zoom map' : 'Knob turn: volume'}</>
            ) : (
              <>{'Knob turn: scroll list · press: play'}<br />{'volume 8s after play · tap outside list for volume'}</>
            )}
          </div>
          )}
        </aside>
      </div>

      {/* country tile picker: long-press a Countries tile to swap it */}
      {tilePickerIndex != null && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-6 animate-fade-in"
          onClick={closeTilePicker}
        >
          <div
            className="flex max-h-full w-full max-w-sm flex-col overflow-hidden rounded-xl border border-white/10 bg-[#14161b] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <div className="font-display text-row font-medium text-near">Pick a country</div>
              <button
                onClick={closeTilePicker}
                className="rounded px-2 py-1 font-mono text-body text-dim transition-colors hover:text-near"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {countriesLoading ? (
                <div className="grid place-items-center p-8 font-mono text-body text-dim">
                  Loading countries…
                </div>
              ) : countriesError ? (
                <div className="p-8 text-center">
                  <div className="font-mono text-body text-warn">{countriesError}</div>
                  <button
                    onClick={retryCountries}
                    className="mt-4 rounded-lg border border-white/10 bg-white/[0.05] px-4 py-2 font-body text-body font-medium text-near transition-all hover:bg-white/[0.1] active:scale-95"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-rule">
                  {(allCountries ?? []).map((c) => {
                    const alreadyTiled = tiles.some(t => t.code === c.code);
                    return (
                      <li key={c.code}>
                        <button
                          disabled={alreadyTiled}
                          onClick={() => pickCountryTile(tilePickerIndex, c)}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${alreadyTiled ? 'opacity-35' : 'hover:bg-white/[0.04] active:bg-neutral-soft'}`}
                        >
                          <span className="truncate font-body text-row text-near">{c.name}</span>
                          <span className="shrink-0 font-mono text-hint text-dim">
                            {c.stationCount.toLocaleString()} ▸
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
