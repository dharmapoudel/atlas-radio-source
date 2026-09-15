# Atlas Radio

## 0.5.0

- Map tab: the knob now zooms the map by default. Once you tap a station dot
  and it starts playing, the knob controls the volume instead; tapping the map
  switches it back to zoom.
- Map tab: zooming in reveals more station dots, up to 500 worldwide.
- Fixed: leaving the Map tab (e.g. tapping a country) and coming back no
  longer shrinks the station pool, so the extra dots from zooming stay.
- Fixed: the map no longer jumps back to its default position when you return
  to the Map tab; panning now persists across tab switches like zoom does.
- Fixed: closing and reopening the app while a station plays now restores the
  now-playing station. The companion's stream provider drops the play context,
  so the phone reports no context uri; the app now matches the playing track's
  uri against the saved station's stream url instead (foreign streams are
  still never claimed). A restored session keeps the knob on its default
  (zoom); volume mode is entered by tapping a station dot.
- Added: starting a station now zooms the map onto that station's country with
  the station at the center (zoom fits the country, 1x-4x). Stations without
  coordinates fall back to the country view from the bundled map geometry,
  so playing from any country's list still focuses the map when its tab is
  opened. A relaunch restore deliberately leaves the saved map view alone.
- UI: decluttered the help texts. The map hint is now a single contextual line
  (the signal count moved out — the top bar already shows it), and the aside
  shortcuts are four short lines: tabs/random/favorite, play/pause, exit,
  knob state. No more duplicated knob info between the two.
- Fixed: the now-playing button row moved further down (mt-12) so the favorite
  button clears the Car Thing's physical knob overhang.
- Help texts shrank to eyebrow size so "1-5 tabs · R random · F favorite" fits
  on one row.
- Map dots are smaller (r 2.5) and muted slate instead of shiny white; the
  playing dot keeps its accent fill, pulse, and halo ring.
- Opening the map tab (or launching the app) with a station playing now
  centers the map on its halo dot; the playing dot is also pinned into the
  dot pool so it never disappears at low zoom.
- Play/pause button uses proper SVG icons instead of text glyphs.
- Animations slimmed down for the weak device CPU: rows and country cards no
  longer stagger one-by-one, all map dots share a single fade, and the
  playing halo pulses via CSS instead of SMIL.
- Recent tab has a "Clear recent history" row at the end of the list.
- Glow-up: gradient app background, gradient primary buttons with a soft glow,
  filled pill tabs, softer inputs, hover states on rows/cards, brighter map
  countries and dots, a halo ring on the playing dot, a live status dot next
  to the wordmark (pulses while playing), styled scrollbars, and Inter for UI
  chrome (mono reserved for metadata). No new functionality.

## 0.4.7

- Bolder icon: the radio body outline is thicker (same Sonos sky blue).

## 0.4.6

- Polished the icon: the radio artwork is larger in the frame and the blue
  now matches the Sonos app's sky blue.
- Refreshed the store screenshots from the current build.

## 0.4.5

- New icon: the radio keeps its look, but the speaker grille is now a small
  earth globe instead of dots, the radio waves are gone, and the antenna is
  shorter.
- Fixed the phone-switching-audio confusion: if you start a podcast or other
  audio on the phone while a station was showing, the app no longer keeps the
  old station marked as playing and no longer shows the podcast title as the
  station's live title. The now-playing panel instead shows "On your phone"
  with the track title, and the knob can't pause or resume audio the app
  didn't start. Tapping any station takes over again as before.

## 0.4.4

- Map zoom now persists when switching tabs; it no longer resets to 1x.
- The knob controls volume by default everywhere. On the Map tab it zooms
  only after you explicitly tap the map, and tapping anywhere outside the
  map hands the knob back to volume. The footer hint always shows the
  current mode.
- The play/pause knob action now has an explicit ownership check: it never
  sends play/pause to the phone unless this app started (or verified) the
  current stream, so it can't hijack other audio like Spotify.
- Map no longer shows an empty ocean while loading: a "Tuning in…" overlay
  appears when there are no cached dots yet, and a real error with a Retry
  button replaces the silent "0 signals" if the load fails.
- Animation polish: tabs fade in, station rows and country buttons enter
  with a short stagger, map signals fade in, now-playing transitions are
  animated, and buttons have press-scale feedback.

## 0.4.3

- Station names are cleaned up: directory entries carrying URL and legal junk
  (e.g. "Hot Tejano (Austin) - Online - www.hotfejano.com - hottejano.com LLC")
  now show as "Hot Tejano (Austin) - Austin, Texas". Now-playing titles also
  strip bare URLs. Old favorites, history, and caches heal automatically.
- Back/Esc no longer stops playback: the stream keeps playing on the phone
  when you exit to the launcher, and reopening the app restores the session
  so pause/stop keep working. The ■ button is still the explicit stop.
- Map is now the first tab (keys 1-5 cover all five tabs).
- Countries grid is fixed to exactly four rows so it never scrolls.
- World tab shuffles its station list on every app open.

## 0.4.2

- Removed the on-screen volume slider; volume is knob-only now, with a hint
  in the footer ("Knob turn: volume (map: zoom)").
- Countries tab: "United Kingdom" is now "UK" so the grid fits without
  scrolling, and Spain was replaced with Nepal.
- Now-playing title no longer shows raw stream metadata: the app strips the
  `key="value"` junk from ICY titles, so e.g.
  `Rihanna - text="Only Girl" song_spot="M" ...` shows as "Rihanna - Only Girl".
- Station lists are cached on the device and refreshed in the background, so
  tabs open instantly after the first load instead of fetching every time.
- Fixed "Failed to fetch" on every restart: the first load now retries once
  after a short delay (the phone gateway proxy is often not up yet at launch),
  and shows a plain-language error only when there is nothing cached.

## 0.4.1

- Volume fix: the knob, slider, and mute button now use the phone's relative
  volume commands (`volumeUp`/`volumeDown`/`muteToggle`), which the Car Thing
  routes to the phone as volume key presses. The old absolute `setVolume`
  commands were silently rejected by the companion on iOS, so the knob and
  slider did nothing.
- Knob press now toggles play/pause (was unhandled), and duplicate presses
  within 0.7s are ignored so a single press can't pause-then-instantly-resume.
- New icon: blue radio receiver on black, in the style of the Sonos app icon.

## 0.4.0

- Audio now plays through the phone: station streams are handed to the
  companion's native stream provider (`client.player`) instead of an HTML
  audio element on the speakerless Car Thing. Volume, mute, and the slider
  now control the phone's output where the stream actually plays.
- The small button below the knob (Escape/Back) now exits the app back to
  the launcher, even while the search field has focus. Footer hint updated:
  "Back exits."
- Player errors now say what went wrong: no phone gateway connected,
  companion too old to play streams, or the stream itself failed.

## 0.3.3

- Map tab: drag to pan around the map (pointer drag, clamped to the map
  bounds). Drags no longer trigger station/country taps by mistake.
- Icon refined again: fully square, dark gradient tile with a brighter cyan
  broadcast mark and subtle glow.

## 0.3.2

- Map tab: the rotary knob now zooms the map (1×–4×) instead of changing
  volume while the map is open; zoom resets when switching tabs. Verified in
  headless Chromium.
- New modern icon: dark gradient tile with a cyan broadcast mark.

## 0.3.1

- Removed the custom on-screen keyboard: the Car Thing system already provides
  a keyboard, so search is now a normal input field.
- Fixed a crash on the Map tab (`isPaused={paused}` referenced a nonexistent
  variable; the state is named `isPaused`), found by reproducing in headless
  Chromium.
- New icon: transparent background with a gold broadcast-tower glyph so it
  blends into the dark launcher.

## 0.3.0

Added an on-screen QWERTY keyboard. The Car Thing has no text keyboard, so
tapping the search field now opens a large touch keyboard (digits, letters,
space, backspace, clear) with a live query display and Search button. Escape
or ✕ dismisses it.

Publishing-ready: app id is now a uuidv7 (never change it), `public/icon.png`
is wired as the store icon, the MIT license from the original project is
included, and `PUBLISHING.md` documents the catalog release flow.

## 0.2.0

Added a simplified world map view, bringing back the "atlas" from the original
Omarchy plugin. The map renders simplified Natural Earth country geometry
(public domain) with live station signals plotted by coordinates: tap a dot to
play that station (the playing signal pulses), tap a country to browse its
stations. Reached via the new Map tab or Preset 2.

## 0.1.0

Initial Bridgething port of the Omarchy Radio Atlas plugin.

Explore live world radio on your Car Thing. Search stations by name, country,
or genre, browse by country, tune randomly, and save favorites. Playback uses
the device speaker with volume control on the rotary wheel.

Ported from https://github.com/AksharP5/omarchy-radio-atlas which used a
rotatable globe on the Linux desktop. The globe is replaced with a
driver-friendly list UI for the 800x480 Car Thing screen. Station data comes
from the community-run Radio Browser (https://www.radio-browser.info/).
