# Atlas Radio

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
