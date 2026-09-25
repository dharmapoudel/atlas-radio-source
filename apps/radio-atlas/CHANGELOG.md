# Atlas Radio

## 0.6.8

- Portrait map tab: the original omarchy plugin's rotatable globe with
  station signals, ported from AksharP5/omarchy-radio-atlas. Drag to rotate
  (with kinetic flick), knob to zoom, tap a signal to play, tap a country to
  browse its stations. Landscape keeps the flat world map.

## 0.6.7

- Knob volume is throttled: each detent is a serial app -> daemon ->
  bluetooth -> phone round trip, so fast spins queued up and the volume kept
  moving after the knob stopped. The first detent still responds instantly,
  then at most one step per 90ms with a trailing flush.

## 0.6.6

- Portrait layout: the two landscape panels stack top/bottom, sized
  proportionally to their landscape widths (station list 68% on top,
  Now Playing 32% below). Header stacks the search under the brand row,
  tabs scroll horizontally, country tiles use two columns.
- Landscape (800x480) is unchanged.

## 0.6.5

- New icon: a charcoal retro radio with an antenna.
- Remembers the last open tab when the app reopens.
- World tab: the station listing is re-randomized on every visit; map
  defaults to zoom 1, zooming to 1.5 while a station plays.
- Knob: scrolls lists with single-press select in World, Countries,
  Favorites and Recents; on the Map tab a press toggles play/pause, and
  turning it zooms. After selecting a station the knob drives volume for
  8s, then hands back to the list; tapping outside the list hands the
  knob to volume until the list is tapped again.
- Added Noto Sans Devanagari and Arabic subsets so station names no
  longer render as tofu boxes.
- Removed the ESC key handler (the M button is the way out).
- Favorites and Recents tabs load instantly from local data; yellow
  accent (#f8c03d) applied across the app.
