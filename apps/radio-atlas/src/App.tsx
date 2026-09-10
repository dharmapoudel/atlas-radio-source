import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POPULAR_COUNTRIES, radioApi } from './radioApi';
import { store } from './store';
import type { Station, TabMode } from './types';
import WorldMap from './WorldMap';

function stationMeta(s: Station): string {
  const parts: string[] = [];
  if (s.country) parts.push(s.country);
  if (s.tags) parts.push(s.tags.split(',').slice(0, 2).join(', '));
  if (s.bitrate > 0) parts.push(`${s.bitrate}k`);
  return parts.join(' · ');
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [tab, setTab] = useState<TabMode>('world');
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mapZoom, setMapZoom] = useState(1);
  const [country, setCountry] = useState<{ code: string; name: string } | null>(null);

  const [playing, setPlaying] = useState<Station | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const [favorites, setFavorites] = useState<Station[]>(() => store.getFavorites());
  const [recent, setRecent] = useState<Station[]>(() => store.getRecent());
  const [volume, setVolume] = useState(() => store.getVolume());
  const [muted, setMuted] = useState(false);

  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  // ---- data loading ----

  const loadWorld = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCountry(null);
    try {
      const data = await radioApi.world(100);
      setStations(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load stations');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCountry = useCallback(async (code: string, name: string) => {
    setLoading(true);
    setError(null);
    setTab('country');
    setCountry({ code, name });
    try {
      const data = await radioApi.byCountry(code, 50);
      setStations(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load stations');
    } finally {
      setLoading(false);
    }
  }, []);

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
    loadWorld();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- playback ----

  const playStation = useCallback((station: Station) => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioError(null);
    setAudioLoading(true);
    setIsPaused(false);
    setPlaying(station);
    setSelectedUuid(station.uuid);
    audio.src = station.url;
    audio.play().catch(() => {
      setAudioLoading(false);
      setAudioError('Could not play this station. Try another.');
    });
    radioApi.click(station.uuid);
    setRecent(store.recordPlayed(station));
  }, []);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !playing) return;
    if (audio.paused) {
      audio.play().catch(() => setAudioError('Could not resume playback'));
      setIsPaused(false);
    } else {
      audio.pause();
      setIsPaused(true);
    }
  }, [playing]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    setPlaying(null);
    setIsPaused(false);
    setAudioLoading(false);
    setAudioError(null);
  }, []);

  const toggleFavorite = useCallback((station: Station) => {
    setFavorites(store.toggleFavorite(station));
  }, []);

  // audio element events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlaying = () => { setAudioLoading(false); setAudioError(null); setIsPaused(false); };
    const onPause = () => { if (!audio.ended) setIsPaused(true); };
    const onError = () => { setAudioLoading(false); setAudioError('Stream failed. Try another station.'); };
    const onWaiting = () => setAudioLoading(true);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    return () => {
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
    };
  }, []);

  // volume
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume / 100;
    store.setVolume(volume);
  }, [volume, muted]);

  // keyboard shortcuts (from original: space, r, f, +/-)
  // note: "m" is the Mode button on Car Thing, so mute is on-screen only
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') { target.blur(); }
        return;
      }
      if (e.key === ' ') { e.preventDefault(); togglePlayPause(); }
      else if (e.key === 'r' || e.key === 'R') tuneRandom();
      else if (e.key === '+' || e.key === '=') setVolume(v => Math.min(100, v + 5));
      else if (e.key === '-' || e.key === '_') setVolume(v => Math.max(0, v - 5));
      else if (e.key === '1') switchTab('world');
      else if (e.key === '2') switchTab('map');
      else if (e.key === '3') switchTab('country');
      else if (e.key === '4') switchTab('favorites');
      else if (e.key === 'Escape' && playing) stop();
      else if ((e.key === 'f' || e.key === 'F') && selectedUuid) {
        const s = stations.find(x => x.uuid === selectedUuid);
        if (s) toggleFavorite(s);
      }
    };
    // rotary wheel: horizontal deltaX adjusts volume (Car Thing wheel);
    // on the map tab it zooms the map instead
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const dir = e.deltaX > 0 ? 1 : -1;
        if (tab === 'map') {
          setMapZoom(z => Math.max(1, Math.min(4, z + dir * 0.25)));
        } else {
          setVolume(v => Math.max(0, Math.min(100, v + dir * 5)));
          setMuted(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
    };
  }, [togglePlayPause, tuneRandom, selectedUuid, stations, toggleFavorite, playing, stop, tab]);

  const visibleStations = useMemo(() => {
    if (tab === 'favorites') return favorites;
    if (tab === 'recent') return recent;
    return stations;
  }, [tab, favorites, recent, stations]);

  const favUuids = useMemo(() => new Set(favorites.map(f => f.uuid)), [favorites]);

  const switchTab = (t: TabMode) => {
    setTab(t);
    setError(null);
    if (t === 'map') setMapZoom(1);
    if (t === 'world' || t === 'map') loadWorld();
    if (t === 'country') { setCountry(null); setStations([]); }
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-bg text-off-white">
      <audio ref={audioRef} preload="none" />

      {/* header */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-rule px-4">
        <div className="font-display text-xl font-bold tracking-display">RADIO ATLAS</div>
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={e => { e.preventDefault(); runSearch(query); }}
        >
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search station, country, genre…"
            maxLength={128}
            className="h-10 flex-1 rounded border border-edge bg-screen px-3 text-body text-near placeholder:text-dim focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="h-10 rounded border border-edge px-4 font-mono text-body text-near active:bg-neutral-soft"
          >
            Search
          </button>
        </form>
        <button
          onClick={tuneRandom}
          title="Tune randomly (R)"
          className="h-10 rounded border border-accent bg-accent px-4 font-mono text-body text-screen active:opacity-80"
        >
          Random
        </button>
      </header>

      {/* tabs */}
      <nav className="flex h-11 shrink-0 items-center gap-1 border-b border-rule px-4">
        {(['world', 'map', 'country', 'favorites', 'recent'] as TabMode[]).map(t => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`rounded px-4 py-1.5 font-mono text-body capitalize ${
              tab === t ? 'bg-accent-soft text-accent' : 'text-dim active:bg-neutral-soft'
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
        <main className="min-w-0 flex-1 overflow-y-auto">
          {tab === 'map' ? (
            <WorldMap
              stations={stations}
              playingUuid={playing?.uuid ?? null}
              isPaused={isPaused}
              zoom={mapZoom}
              onPlayStation={playStation}
              onBrowseCountry={(code, name) => loadCountry(code, name)}
            />
          ) : tab === 'country' && !country ? (
            <div className="grid grid-cols-3 gap-3 p-4">
              {POPULAR_COUNTRIES.map(c => (
                <button
                  key={c.code}
                  onClick={() => loadCountry(c.code, c.name)}
                  className="rounded border border-edge bg-screen p-4 text-left active:bg-neutral-soft"
                >
                  <div className="font-display text-title font-medium">{c.name}</div>
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
                  className="mt-4 rounded border border-edge px-4 py-2 font-mono text-body text-near active:bg-neutral-soft"
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
            <ul className="divide-y divide-rule">
              {visibleStations.map(s => {
                const isPlaying = playing?.uuid === s.uuid;
                const isFav = favUuids.has(s.uuid);
                return (
                  <li key={s.uuid}>
                    <div
                      className={`flex items-center gap-3 px-4 py-2.5 ${isPlaying ? 'bg-accent-soft' : ''} ${selectedUuid === s.uuid ? 'bg-neutral-soft' : ''}`}
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
          )}
        </main>

        {/* now playing */}
        <aside className="flex w-64 shrink-0 flex-col border-l border-rule bg-screen p-4">
          <div className="font-mono text-eyebrow uppercase tracking-[0.2em] text-dim">Now playing</div>
          {playing ? (
            <>
              <div className="mt-2 font-display text-hero font-medium leading-tight">
                {audioLoading ? 'Tuning…' : playing.name}
              </div>
              <div className="mt-1 font-mono text-hint text-dim">{stationMeta(playing)}</div>
              {audioError && (
                <div className="mt-2 font-mono text-hint text-warn">{audioError}</div>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={togglePlayPause}
                  className="flex-1 rounded border border-accent bg-accent px-3 py-2.5 font-mono text-row text-screen active:opacity-80"
                >
                  {audioLoading ? '…' : isPaused ? '▶ Play' : '❚❚ Pause'}
                </button>
                <button
                  onClick={stop}
                  className="rounded border border-edge px-3 py-2.5 font-mono text-row text-near active:bg-neutral-soft"
                >
                  ■
                </button>
                <button
                  onClick={() => toggleFavorite(playing)}
                  className={`rounded border border-edge px-3 py-2.5 font-mono text-row active:bg-neutral-soft ${favUuids.has(playing.uuid) ? 'text-accent' : 'text-dim'}`}
                >
                  {favUuids.has(playing.uuid) ? '★' : '☆'}
                </button>
              </div>
            </>
          ) : (
            <div className="mt-2 font-body text-body text-dim">
              Pick a station to start listening.
            </div>
          )}

          {/* volume */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div className="font-mono text-eyebrow uppercase tracking-[0.2em] text-dim">Volume</div>
              <button
                onClick={() => setMuted(m => !m)}
                className="font-mono text-hint text-dim"
                title="Mute (M)"
              >
                {muted ? 'Muted' : `${volume}%`}
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={e => { setVolume(Number(e.target.value)); setMuted(false); }}
              className="mt-2 w-full accent-[#00a8e8]"
            />
            <div className="mt-1 flex justify-between">
              <button onClick={() => setVolume(v => Math.max(0, v - 5))} className="rounded border border-edge px-3 py-1 font-mono text-body text-dim active:bg-neutral-soft">−</button>
              <button onClick={() => setVolume(v => Math.min(100, v + 5))} className="rounded border border-edge px-3 py-1 font-mono text-body text-dim active:bg-neutral-soft">+</button>
            </div>
          </div>

          <div className="mt-auto pt-4 font-mono text-hint leading-relaxed text-dim">
            1-4 tabs · Space play/pause<br />
            R random · F favorite · wheel volume
          </div>
        </aside>
      </div>

    </div>
  );
}
