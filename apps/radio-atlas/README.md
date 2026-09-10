# Atlas Radio

Internet radio for the Spotify Car Thing, powered by [Bridgething](https://github.com/JoeyEamigh/bridgething).

Explore live world radio on your Car Thing's 800×480 display. Search stations by name, country, or genre, browse by country, tune randomly, and save favorites — all from a driver-friendly interface built for the rotary knob and preset buttons. Station data comes from the community-run [Radio Browser](https://www.radio-browser.info/).

Ported from the [Omarchy Radio Atlas plugin](https://github.com/AksharP5/omarchy-radio-atlas) (MIT), which used a rotatable globe on the Linux desktop. The globe is reimagined here as a simplified world map with tappable station signals.

## Features

- **World tab** — search stations by name, country, or genre; tune randomly; browse trending
- **Map tab** — simplified world map (Natural Earth geometry) with live station signals plotted by coordinates; tap a dot to play, tap a country to browse its stations; **turn the knob to zoom, drag to pan**
- **Countries tab** — browse stations by country
- **Favorites tab** — your saved stations, persisted on-device
- **Recent history** — quick access to recently played stations
- **System keyboard** — the search field uses the Car Thing's built-in keyboard

## Controls

| Input | Action |
|---|---|
| Preset 1–4 | Switch tabs (World, Map, Countries, Favorites) |
| Wheel | Volume (on World/Countries/Favorites tabs) |
| Wheel | Zoom the map (on the Map tab, 1×–4×) |
| Space | Play / pause |
| R | Tune a random station |
| F | Favorite the selected station |
| Esc | Stop playback |
| Tap station / map dot | Play |
| Tap country shape | Browse that country's stations |
| Drag on the map | Pan the map |

## Screenshots

Real device photos from a Car Thing install:

| World tab | Map tab | Countries tab (playing) |
|---|---|---|
| ![World tab](screenshots/world-tab.jpg) | ![Map tab](screenshots/map-tab.jpg) | ![Countries tab](screenshots/countries-tab.jpg) |

## Known limitation: audio output

The Car Thing has **no speaker** — Spotify's own specs list Bluetooth SPP only (no audio profiles), and the on-device Chromium kiosk can't forward web audio to the phone. The app currently plays through an HTML `<audio>` element, which is silent on the device.

The fix requires a Bridgething platform feature: a companion-side provider that claims `http`/`https` stream URLs and plays them with the phone's native media stack (AVPlayer / ExoPlayer), so `player.play({ uri: station.url })` produces sound through the phone → car speakers. This is tracked as a proposed upstream PR — see the research notes below.

## Develop

```sh
bun install
bun run dev          # dev server with device bridge
bun run typecheck    # tsc --noEmit
bun run build        # production build → dist/
```

## Install on a connected Car Thing

```sh
bun run push         # build and install onto the device
```

Built zips (installable) are attached to releases: `atlas-radio-<version>-install.zip`
is the contents of `dist/` with `manifest.json` at the zip root.

## Publishing to a catalog

See [`PUBLISHING.md`](PUBLISHING.md) for the full Bridgething catalog workflow
(source repo layout, GitHub Pages, `bun run bump`, screenshots via `bun run shot`).

Important: the app id in `public/manifest.json` is a permanent uuidv7 — it must
never change after publication, or the catalog will treat it as a different app.

## Project structure

```
public/manifest.json   # app identity (uuidv7 id, version, permissions, icon)
public/icon.png        # launcher + store icon (256×256, < 64 KiB)
src/App.tsx            # main UI: tabs, presets, wheel, keyboard shortcuts
src/WorldMap.tsx       # simplified world map with zoom + tappable signals
src/world.json         # simplified Natural Earth country geometry (public domain)
src/radioApi.ts        # Radio Browser client (ported from radio-fetch)
src/store.ts           # favorites / recents / volume (ported from radio-state)
src/types.ts           # Station types (ported from RadioModel.js)
src/daemon.ts          # device bridge (generated from @bridgething/webapp-shared)
scripts/               # push.ts / share.ts device helpers
PUBLISHING.md           # catalog publishing guide
CHANGELOG.md           # release notes
LICENSE                # MIT (Akshar Patel, from the original project)
```

## Upstream audio research

- Car Thing hardware: no speaker, Bluetooth 4.2 SPP-only (no A2DP/HFP) — per
  Spotify's technical specifications and the iFixit/EDN teardown.
- Bridgething today: `player.play` drops any URI whose scheme no provider
  claims (`crates/companion/src/dispatch/player.rs`); only `spotify:`,
  `applemusic:`, and `system:` are claimed.
- Proposed: a `stream` provider in the companion claiming `http`/`https`,
  backed by a new `StreamBackend` uniffi trait (`play`/`pause`/`resume`/`stop`)
  implemented with AVPlayer (iOS) and Media3/ExoPlayer (Android). No SDK
  surface change needed — webapps call the existing `client.player.play({ uri })`.
- Radio Atlas will switch from `<audio>` to `client.player.play` once the
  upstream feature lands.

## License

MIT — see [LICENSE](LICENSE). Country geometry in `src/world.json` is
simplified from Natural Earth (public domain).
