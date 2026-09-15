import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POPULAR_COUNTRIES, radioApi } from './radioApi';
import { store } from './store';
import { getClient } from './client';
import type { Station, TabMode } from './types';
import WorldMap from './WorldMap';
import { project, MAP_VIEW, countryFocus } from './mapFocus';

// Built-in launcher (hub) webapp id. The client SDK cannot list the launcher,
// so exiting goes through this well-known builtin id.
const HUB_WEBAPP_ID = '019693c0-5c6a-71f0-a89d-7e2a4d9c0a01';

function stationMeta(s: Station): string {
  const parts: string[] = [];
  if (s.country) parts.push(s.country);
  if (s.tags) parts.push(s.tags.split(',').slice(0, 2).join(', '));
  if (s.bitrate > 0) parts.push(`${s.bitrate}k`);
  return parts.join(' · ');
}

// stream icy metadata often arrives as raw key="value" pairs, e.g.
// artist - text="title" song_spot="m" mediabaseid="123"; extract the human part
export function cleanLiveTitle(raw: string | null | undefined, stationName: string): string | null {
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

// fisher-yates shuffle; returns a new array
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function App() {
  const [tab, setTab] = useState<TabMode>('map');
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
  // guards against a single knob press arriving as two key events, which
  // would pause then instantly resume
  const lastToggleAt = useRef(0);
  // on the map tab the knob zooms by default; tapping a station dot hands it
  // to volume while the stream plays, tapping the map takes it back
  const [mapKnobZoom, setMapKnobZoom] = useState(true);
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
  const CONTEXT_PREFIX = 'radio-atlas:station:';
  // the companion tags phone system media (spotify, podcasts…) with a
  // "system:<package>:context" uri; our own streams never carry one.
  const SYSTEM_CONTEXT_PREFIX = 'system:';
  const contextUriFor = (uuid: string) => `${CONTEXT_PREFIX}${uuid}`;
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
  }, []);
  // guards background refreshes from overwriting a newer tab's stations
  const loadSeq = useRef(0);

  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  // ---- data loading ----
  // station lists are cached in localstorage and refreshed in the background,
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
    await loadCached('world', () => radioApi.world(100),
      'Could not reach the station directory. Check your connection.',
      opts?.shuffle ?? false);
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
      if (!cached) setMapError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'Could not reach the station directory. Check your connection.');
    } finally {
      setMapLoading(false);
    }
  }, []);

  const loadCountry = useCallback(async (code: string, name: string) => {
    setTab('country');
    setCountry({ code, name });
    await loadCached(`country:${code}`, () => radioApi.byCountry(code, 50),
      'Could not reach the station directory. Check your connection.');
  }, [loadCached]);

  const runSearch = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text) {
      setTab('world');
      await loadWorld();
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
  }, [loadWorld]);

  const tuneRandom = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const exclude = recent.slice(0, 30).map(s => s.uuid);
      if (playing) exclude.push(playing.uuid);
      const data = await radioApi.random(exclude);
      setStations(data);
      setTab('world');
      setCountry(null);
      if (data.length > 0) playStation(data[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not tune randomly');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, playing]);

  useEffect(() => {
    loadWorld({ shuffle: true });
    loadMapStations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- playback via the phone ----
  // The Car Thing has no speaker, so streams play on the phone through the
  // companion's stream provider (claims http/https). Now-playing state and
  // errors arrive back over client.player events.

  // center the map on a station: its coordinates when known, otherwise the
  // country view. the map tab recenters on the playing station every time it
  // opens so the halo dot lands in the middle of the screen.
  const focusStation = useCallback((station: Station) => {
    const { latitude: lat, longitude: lon } = station;
    const geo: [number, number] | null =
      lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)
        ? project(lon, lat)
        : null;
    const focus = countryFocus(station.countryCode);
    const target = geo
      ? { x: geo[0], y: geo[1], zoom: focus ? focus.zoom : 3 }
      : focus;
    if (!target) return;
    const z = target.zoom;
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
    client.player.play({ uri: station.url, context: { contextUri: contextUriFor(station.uuid) } }).catch(() => {
      setAudioLoading(false);
      setAudioError('Could not reach the daemon. Is the device on?');
    });
    radioApi.click(station.uuid);
    setRecent(store.recordPlayed(station));
  }, [focusStation]);

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
    store.setNowPlaying(null);
    ownsPlayback.current = false;
  }, []);

  // exiting leaves the stream playing on the phone; the app is a remote, not
  // the player. the stop button above is the explicit way to silence it.
  const exitApp = useCallback(() => {
    getClient().webapp.activate({ id: HUB_WEBAPP_ID }).then(res => {
      if (!res.ok) console.warn('exit to launcher failed', res.kind, res.error);
    }).catch(() => {});
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
        setLiveTitle(t => cleanLiveTitle(title, playing?.name ?? '') ?? t);
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
  }, [playing?.name]);

  const toggleFavorite = useCallback((station: Station) => {
    setFavorites(store.toggleFavorite(station));
  }, []);

  // phone volume is knob-only: relative steps route over iap2 hid and move the
  // phone's volume. absolute setvolume never reaches the phone on ios.
  const nudgeVolume = useCallback((dir: 1 | -1) => {
    const client = getClient();
    if (dir > 0) client.audio.volumeUp().catch(() => {});
    else client.audio.volumeDown().catch(() => {});
  }, []);

  // keyboard shortcuts (from original: space, r, f, +/-)
  // note: "m" is the Mode button on Car Thing, so mute is on-screen only
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') { target.blur(); exitApp(); }
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togglePlayPause(); }
      else if (e.key === 'r' || e.key === 'R') tuneRandom();
      else if (e.key === '+' || e.key === '=') nudgeVolume(1);
      else if (e.key === '-' || e.key === '_') nudgeVolume(-1);
      else if (e.key === '1') switchTab('map');
      else if (e.key === '2') switchTab('world');
      else if (e.key === '3') switchTab('country');
      else if (e.key === '4') switchTab('favorites');
      else if (e.key === '5') switchTab('recent');
      else if (e.key === 'Escape') exitApp();
      else if ((e.key === 'f' || e.key === 'F') && selectedUuid) {
        const s = stations.find(x => x.uuid === selectedUuid);
        if (s) toggleFavorite(s);
      }
    };
    // rotary wheel: horizontal deltaX adjusts volume (Car Thing wheel);
    // on the map tab it zooms while the knob is in zoom mode, which is the
    // default until a station dot hands it to volume
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const dir = e.deltaX > 0 ? 1 : -1;
        if (tab === 'map' && mapKnobZoom) {
          setMapZoom(z => Math.max(1, Math.min(4, z + dir * 0.25)));
        } else {
          nudgeVolume(dir);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }, [togglePlayPause, tuneRandom, selectedUuid, stations, toggleFavorite, exitApp, tab, mapKnobZoom, nudgeVolume]);

  const visibleStations = useMemo(() => {
    if (tab === 'favorites') return favorites;
    if (tab === 'recent') return recent;
    return stations;
  }, [tab, favorites, recent, stations]);

  const favUuids = useMemo(() => new Set(favorites.map(f => f.uuid)), [favorites]);

  const switchTab = (t: TabMode) => {
    setTab(t);
    setError(null);
    setMapKnobZoom(true);
    if (t === 'map') {
      const p = playingRef.current;
      if (p) focusStation(p);
    }
    if (t === 'world') loadWorld();
    if (t === 'map') loadMapStations();
    if (t === 'country') { setCountry(null); setStations([]); }
  };

  return (
    <div className="relative flex h-full w-full flex-col text-off-white">

      {/* header */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-rule bg-white/[0.02] px-4">
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
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={e => { e.preventDefault(); runSearch(query); }}
        >
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search station, country, genre…"
            maxLength={128}
            className="h-10 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-body text-near placeholder:text-dim transition-colors focus:border-accent/60 focus:bg-white/[0.06] focus:outline-none"
          />
          <button
            type="submit"
            className="h-10 rounded-lg border border-white/10 bg-white/[0.05] px-4 font-body text-body font-medium text-near transition-all hover:bg-white/[0.1] active:scale-95"
          >
            Search
          </button>
        </form>
        <button
          onClick={tuneRandom}
          title="Tune randomly (R)"
          className="h-10 rounded-lg bg-gradient-to-b from-[#2fb9f2] to-[#0090d6] px-4 font-body text-body font-semibold text-screen shadow-[0_2px_14px_rgba(0,168,232,0.35)] transition-all hover:brightness-110 active:scale-95"
        >
          Random
        </button>
      </header>

      {/* tabs */}
      <nav className="flex h-11 shrink-0 items-center gap-1 border-b border-rule px-4">
        {(['map', 'world', 'country', 'favorites', 'recent'] as TabMode[]).map(t => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`rounded-full px-4 py-1.5 font-body text-body font-medium capitalize transition-all active:scale-95 ${
              tab === t
                ? 'bg-accent text-screen shadow-[0_2px_10px_rgba(0,168,232,0.35)]'
                : 'text-dim hover:bg-white/[0.06] hover:text-near'
            }`}
          >
            {t === 'country' ? 'Countries' : t}
            {t === 'favorites' && favorites.length > 0 && (
              <span className="ml-1 text-hint">({favorites.length})</span>
            )}
          </button>
        ))}
        <div className="ml-auto font-mono text-hint text-dim">
          {country ? `${country.name}` : visibleStations.length > 0 ? `${visibleStations.length} stations` : ''}
        </div>
      </nav>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        {/* station list / country grid / map */}
        <main key={tab} className="min-w-0 flex-1 overflow-y-auto animate-fade-in">
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
            <div className="grid h-full grid-cols-3 grid-rows-4 gap-2 p-3 animate-fade-up">
              {POPULAR_COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  onClick={() => loadCountry(c.code, c.name)}
                  className="rounded-lg border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.01] p-3 text-left transition-colors hover:border-accent/40 active:bg-neutral-soft"
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
                  onClick={() => (tab === 'country' && country ? loadCountry(country.code, country.name) : loadWorld())}
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
              {visibleStations.map((s) => {
                const isPlaying = playing?.uuid === s.uuid;
                const isFav = favUuids.has(s.uuid);
                return (
                  <li key={s.uuid}>
                    <div
                      className={`flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03] ${isPlaying ? 'bg-accent-soft shadow-[inset_2px_0_0_0_var(--color-accent)]' : ''} ${selectedUuid === s.uuid ? 'bg-neutral-soft' : ''}`}
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
            </>
          )}
        </main>

        {/* now playing */}
        <aside className="flex w-64 shrink-0 flex-col border-l border-rule bg-screen px-3 py-4">
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
              <div className="mt-12 flex gap-2">
                <button
                  onClick={togglePlayPause}
                  className="flex-1 rounded-lg bg-gradient-to-b from-[#2fb9f2] to-[#0090d6] px-3 py-2.5 font-body text-row font-semibold text-screen shadow-[0_2px_14px_rgba(0,168,232,0.35)] transition-all hover:brightness-110 active:scale-95"
                >
                  {audioLoading ? '…' : isPaused ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M4 2.3v11.4c0 .8.9 1.3 1.6.9l8.7-5.7c.6-.4.6-1.4 0-1.8L5.6 1.4c-.7-.4-1.6.1-1.6.9z" />
                      </svg>
                      Play
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <rect x="3" y="2" width="4" height="12" rx="1.2" />
                        <rect x="9" y="2" width="4" height="12" rx="1.2" />
                      </svg>
                      Pause
                    </span>
                  )}
                </button>
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

          <div className="mt-auto pt-4 font-mono text-[10px] leading-relaxed text-dim">
            1-5 tabs · R random · F favorite<br />
            Space / knob press: play/pause<br />
            Back: exits (keeps playing)<br />
            {tab === 'map' ? (mapKnobZoom ? 'Knob: zoom map' : 'Knob: volume') : 'Knob: volume'}
          </div>
        </aside>
      </div>

    </div>
  );
}
