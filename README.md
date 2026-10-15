# nightmap

**Live: https://cramt.github.io/nightmap/**

Real-city battle maps for World of Darkness chronicles. Find a city, restyle it, light up the places
that matter to your story, draw on it, export a PNG for Foundry (or wherever).

Frontend only. Map tiles come from [OpenFreeMap](https://openfreemap.org), place search from
Nominatim, and highlights from Overpass, all live OpenStreetMap data.

```sh
pnpm install
pnpm dev
```

## What's in it

- **Search** any city and fly to its centre.
- **Highlights**: transit, hospitals, blood banks, police, cemeteries, nightclubs and more, each with
  its own glyph, colour and name toggle. Every category is a list of Overpass tag filters
  (`["amenity"="nightclub"]`), so you can add your own. Fetches cover the current view and accumulate
  as you pan. Click a place to hide it.
- **Style**: five themes (Noir, Camarilla, Sabbat, Parchment, Blueprint), every colour editable, and
  base layers (buildings, side streets, labels, …) toggleable.
- **Draw**: pins, labels, paths, domains (filled areas) and freehand strokes. Select to edit, drag
  pins and labels around, Del to delete. Undo/redo with Ctrl+Z / Ctrl+Shift+Z. Tool hotkeys 1–6.
- **Export** the current view as PNG at 1–4×, with vignette and an OSM credit. The panel shows the
  Foundry grid size and grid distance that make in-game measurement match real metres.
- **Projects** autosave to localStorage and save/load as `.nightmap.json`.

## How it hangs together

The map is a pure function of the project: `buildStyle(project)` produces a whole MapLibre style
and `setStyle(…, { diff: true })` applies the difference. Only the in-progress drawing bypasses this,
so mouse moves don't go through the style diff.

## Deploy

Every push to `main` builds and deploys to GitHub Pages (`.github/workflows/pages.yml`). Pull
requests only build. `VITE_BASE` sets the subpath Pages serves from.
