# Publishing Atlas Radio to the Bridgething store

A Bridgething "source" is a repo that builds your app, hosts the bundles on
GitHub Pages, and serves a `catalog.v1.json` that the companion app reads.
This guide maps every part of the store listing to the file it comes from,
so your listing looks like the reference screenshot (icon, author, version
badge, description, permissions, version history, source links).

## What the store listing shows — field by field

| Store listing | Comes from |
|---|---|
| App icon | `apps/atlas-radio/public/icon.png` (wired via manifest `"icon"`) |
| Name ("Radio Atlas") | `public/manifest.json` → `name` |
| Author ("Dharma Poudel") | `apps/atlas-radio/catalog.json` → `author` |
| Version badge ("INSTALLED V0.3.3") | The published version in the catalog (automatic) |
| Description paragraph | `public/manifest.json` → `description` |
| WHAT THIS APP CAN DO ("use the internet / data fetched via your phone") | `public/manifest.json` → `permissions` (`net.proxy` renders as internet access) |
| VERSIONS (version, release notes, date, "needs firmware X", size) | Each published version; release notes come from `CHANGELOG.md`, firmware floor from `catalog.json` → `min_libbridgething_version` |
| WHERE THIS CAME FROM → source | Your catalog URL, e.g. `https://dharmapoudel.github.io/atlas-radio-source/catalog.v1.json` (automatic once subscribed) |
| WHERE THIS CAME FROM → homepage | `apps/atlas-radio/catalog.json` → `homepage` |
| WHERE THIS CAME FROM → source code | `apps/atlas-radio/catalog.json` → `source` |
| Screenshots (first one shown on the listing) | `apps/atlas-radio/catalog.json` → `screenshots` (800×480 landscape PNGs) |

## 1. The `catalog.json` your app needs

Every app in a source repo carries an `apps/<slug>/catalog.json` next to
`public/manifest.json`. Create `apps/atlas-radio/catalog.json`:

```json
{
  "author": "Dharma Poudel",
  "homepage": "https://github.com/dharmapoudel/atlas-radio",
  "source": "https://github.com/dharmapoudel/atlas-radio",
  "icon": null,
  "screenshots": [],
  "min_libbridgething_version": "0.12.1"
}
```

Notes:

- `icon: null` means "use the bundle icon" (`public/icon.png`). Only set a
  URL here if you want the store to show something different.
- `screenshots` is a list of image URLs (or paths served from the source
  repo). The store shows the first one on the listing. They must be **800×480
  landscape**. Omit the list rather than shipping an empty one.
- `min_libbridgething_version` sets the "needs firmware X" line. Match it to
  the SDK you built against (see `template-versions.json` in
  `create-bridgething`, currently `0.12.1`).
- The app `id` in `public/manifest.json` is a permanent uuidv7
  (`01a08604-de6f-7a9f-a11e-1b4233458b2a`). **Never change it** — it drives
  upgrades and the on-device KV namespace. Changing it makes the store treat
  the app as a different app.

## 2. Screenshots

Capture what is actually on the Car Thing screen at 800×480:

```sh
bun run shot atlas-radio            # grabs what is on the screen
bun run shot atlas-radio --replace  # overwrite
```

This fills `catalog.json` → `screenshots` for you. Good candidates: the Map
tab with station signals, the World tab list, and a playing state.

## 3. Scaffold the source repo

```sh
bunx create-bridgething atlas-radio-source
cd atlas-radio-source
mkdir -p apps/atlas-radio
# copy everything from the atlas-radio repo into apps/atlas-radio/
# (package.json, vite.config.ts, tsconfig.json, public/, src/, index.html, ...)
# then add apps/atlas-radio/catalog.json from section 1
```

Sanity-check inside the source:

```sh
bun install
bun run check        # validates the catalog schema
bun run build        # builds the app bundle
```

## 4. Push to GitHub and enable Pages

1. Create the repo `dharmapoudel/atlas-radio-source` on GitHub and push `main`.
2. In **Settings → Pages**, set source to **Deploy from a branch**,
   branch `gh-pages`, folder `/ (root)`.
3. Your catalog will live at
   `https://dharmapoudel.github.io/atlas-radio-source/catalog.v1.json`.

GitHub Pages serves the required `Access-Control-Allow-Origin: *` headers.

## 5. Ship a version

```sh
bun run bump atlas-radio minor -m "Map pan and zoom"
git commit -am "atlas-radio: map pan and zoom" && git push
```

Pushing to `main` triggers the `publish` workflow: it builds every
unpublished version, uploads the bundles, and regenerates `catalog.v1.json`
(including each bundle's `sha256` and icon URLs). The store picks up new
versions from the catalog automatically.

Write the `-m` message well: it becomes the release notes shown under
VERSIONS in the store listing.

## 6. Submit the source

Add your catalog URL
(`https://dharmapoudel.github.io/atlas-radio-source/catalog.v1.json`) at
[bridgething.com/apps](https://bridgething.com/apps) so others can subscribe
to your source.

## Rules to respect

- **Never change the bytes behind a published version.** Bump the version
  instead; the catalog lists versions newest-first by `released_at`.
- **Never change the app id.**
- Installed apps only take updates from the source they came from.
- Keep `CHANGELOG.md` current — it feeds the release notes.

## Useful commands

| Command | Purpose |
|---|---|
| `bun run dev` | develop against a connected device |
| `bun run push` | build and install to the device |
| `bun run check` | validate the catalog |
| `bun run catalog` | regenerate `catalog.v1.json` locally |
| `bun run share` | share a dev build |
| `bun run shot` | capture 800×480 store screenshots |

Reference: https://bridgething.com/docs/publishing-apps
