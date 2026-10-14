import { useEffect, useState, type ReactNode } from "react";
import { LngLatBounds, type Map as MlMap } from "maplibre-gl";
import { download, exportPng, metersPerCssPixel, slug } from "./export";
import { newId, type Selection } from "./MapView";
import { fetchPois, parseSelector } from "./overpass";
import { DEFAULT_BASE, DEFAULT_CATEGORIES, THEMES, defaultProject } from "./presets";
import { parseProject, type Action } from "./store";
import type { Annotation, BaseLayers, Category, LngLat, Poi, Project, Theme } from "./types";

type Dispatch = (a: Action) => void;

/** Re-render whenever the camera moves, for readouts that depend on it. */
function useMapTick(map: MlMap | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!map) return;
    const bump = () => setTick((t) => t + 1);
    map.on("move", bump);
    return () => void map.off("move", bump);
  }, [map]);
}

function Row({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="row">
      <span>{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------- search

type Place = { display_name: string; lat: string; lon: string };

export function SearchBox({ map }: { map: MlMap | null }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!q.trim()) return;
    setError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      setResults((await res.json()) as Place[]);
    } catch (e) {
      setError(String(e));
    }
  };

  const go = (p: Place) => {
    // Nominatim's bbox for a city is the whole metro area; the centre point is where the story is.
    map?.flyTo({ center: [Number(p.lon), Number(p.lat)], zoom: 14 });
    setResults(null);
  };

  return (
    <div className="search">
      <form onSubmit={(e) => (e.preventDefault(), void search())}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a city… (Chicago, Berlin, Prague)" />
      </form>
      {error && <div className="error">{error}</div>}
      {results && (
        <ul className="results">
          {results.length === 0 && <li className="muted">Nothing found</li>}
          {results.map((r) => (
            <li key={r.display_name} onClick={() => go(r)}>
              {r.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- highlights

const MIN_FETCH_ZOOM = 11;

type FetchState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; found: number };

function mergePois(existing: Poi[] | undefined, incoming: Poi[]) {
  const byId = new Map((existing ?? []).map((p) => [p.osmId, p]));
  for (const p of incoming) byId.set(p.osmId, p);
  return [...byId.values()];
}

export function HighlightsPanel(props: {
  project: Project;
  dispatch: Dispatch;
  map: MlMap | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { project, dispatch, map, selection } = props;
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [editing, setEditing] = useState<string | null>(null);
  useMapTick(map);

  const zoom = map?.getZoom() ?? 0;
  const enabled = project.categories.filter((c) => c.enabled);

  const fetchView = async () => {
    if (!map) return;
    const b = map.getBounds();
    setState({ kind: "loading" });
    try {
      const got = await fetchPois(enabled, { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      const found = Object.values(got).reduce((n, l) => n + l.length, 0);
      dispatch({
        type: "commit",
        fn: (p) => ({
          ...p,
          pois: { ...p.pois, ...Object.fromEntries(Object.entries(got).map(([id, list]) => [id, mergePois(p.pois[id], list)])) },
        }),
      });
      setState({ kind: "done", found });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const updateCat = (id: string, patch: Partial<Category>) =>
    dispatch({ type: "commit", fn: (p) => ({ ...p, categories: p.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }) });

  const addCat = () => {
    const id = newId();
    dispatch({
      type: "commit",
      fn: (p) => ({
        ...p,
        categories: [
          ...p.categories,
          { id, name: "New highlight", glyph: "★", color: "#e0c040", selectors: ['["amenity"="cafe"]'], enabled: true, labels: true },
        ],
      }),
    });
    setEditing(id);
  };

  return (
    <div className="stack">
      <p className="muted">
        Highlights come live from OpenStreetMap via Overpass. Pan to the area you want, then fetch. Fetches accumulate, so you can
        sweep a whole city.
      </p>
      <button className="primary" disabled={!map || zoom < MIN_FETCH_ZOOM || state.kind === "loading" || enabled.length === 0} onClick={() => void fetchView()}>
        {state.kind === "loading" ? "Asking Overpass…" : `Fetch ${enabled.length} highlight types in view`}
      </button>
      {zoom < MIN_FETCH_ZOOM && <div className="muted">Zoom in a bit (≥ {MIN_FETCH_ZOOM}) to fetch, Overpass chokes on whole regions.</div>}
      {state.kind === "error" && <div className="error">{state.message}</div>}
      {state.kind === "done" && <div className="muted">Got {state.found} places.</div>}

      {selection?.kind === "poi" && (
        <div className="card">
          <b>{selection.name}</b>
          <div className="muted">{selection.osmId}</div>
          <div className="buttons">
            <button
              onClick={() => {
                dispatch({ type: "commit", fn: (p) => ({ ...p, hiddenPois: [...p.hiddenPois, selection.osmId] }) });
                props.onSelect(null);
              }}
            >
              Hide this one
            </button>
            <a href={`https://www.openstreetmap.org/${selection.osmId}`} target="_blank" rel="noreferrer">
              view on OSM
            </a>
          </div>
        </div>
      )}

      <ul className="cats">
        {project.categories.map((c) => (
          <li key={c.id}>
            <div className="cat">
              <input type="checkbox" checked={c.enabled} onChange={(e) => updateCat(c.id, { enabled: e.target.checked })} />
              <input type="color" value={c.color} onChange={(e) => updateCat(c.id, { color: e.target.value })} />
              <input className="glyph" value={c.glyph} onChange={(e) => updateCat(c.id, { glyph: e.target.value })} />
              <span className="name">{c.name}</span>
              <span className="count">{project.pois[c.id]?.length ?? ""}</span>
              <button className={`mini ${c.labels ? "on" : ""}`} title="Show names" onClick={() => updateCat(c.id, { labels: !c.labels })}>
                Aa
              </button>
              <button className="mini" title="Edit" onClick={() => setEditing(editing === c.id ? null : c.id)}>
                ⚙
              </button>
            </div>
            {editing === c.id && (
              <CategoryEditor
                cat={c}
                onChange={(patch) => updateCat(c.id, patch)}
                onDelete={() => {
                  dispatch({ type: "commit", fn: (p) => ({ ...p, categories: p.categories.filter((x) => x.id !== c.id) }) });
                  setEditing(null);
                }}
              />
            )}
          </li>
        ))}
      </ul>
      <div className="buttons">
        <button onClick={addCat}>+ Custom highlight</button>
        <button
          onClick={() =>
            dispatch({ type: "commit", fn: (p) => ({ ...p, categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, selectors: [...c.selectors] })) }) })
          }
        >
          Reset to defaults
        </button>
      </div>
      <div className="buttons">
        <button onClick={() => dispatch({ type: "commit", fn: (p) => ({ ...p, pois: {} }) })}>Forget fetched places</button>
        {project.hiddenPois.length > 0 && (
          <button onClick={() => dispatch({ type: "commit", fn: (p) => ({ ...p, hiddenPois: [] }) })}>
            Unhide {project.hiddenPois.length}
          </button>
        )}
      </div>
    </div>
  );
}

function CategoryEditor({ cat, onChange, onDelete }: { cat: Category; onChange: (p: Partial<Category>) => void; onDelete: () => void }) {
  const [text, setText] = useState(cat.selectors.join("\n"));
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const errors = lines.flatMap((l) => {
    const r = parseSelector(l);
    return typeof r === "string" ? [[l, r] as const] : [];
  });

  return (
    <div className="editor">
      <Row label="Name">
        <input value={cat.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Row>
      <label className="col">
        <span>
          Overpass tag filters, one per line (any line matches).{" "}
          <a href="https://wiki.openstreetmap.org/wiki/Map_features" target="_blank" rel="noreferrer">
            tag reference
          </a>
        </span>
        <textarea rows={Math.max(2, lines.length + 1)} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </label>
      {errors.map(([l, msg]) => (
        <div key={l} className="error">
          {l}: {msg}
        </div>
      ))}
      <div className="buttons">
        <button disabled={errors.length > 0 || lines.length === 0} onClick={() => onChange({ selectors: lines })}>
          Apply filters
        </button>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      <div className="muted">After changing filters, fetch again.</div>
    </div>
  );
}

// ---------------------------------------------------------------- style

const THEME_COLORS: { key: keyof Theme; name: string }[] = [
  { key: "land", name: "Land" },
  { key: "water", name: "Water" },
  { key: "park", name: "Parks" },
  { key: "building", name: "Buildings" },
  { key: "roadMajor", name: "Main roads" },
  { key: "roadMinor", name: "Side streets" },
  { key: "rail", name: "Rail" },
  { key: "label", name: "Labels" },
  { key: "labelHalo", name: "Label halo" },
  { key: "district", name: "Districts" },
];

const BASE_NAMES: Record<keyof BaseLayers, string> = {
  parks: "Parks & green",
  buildings: "Building footprints",
  minorRoads: "Side streets",
  rail: "Rail lines",
  streetLabels: "Street names",
  districtLabels: "District names",
  placeLabels: "City names",
  waterLabels: "Water names",
};

export function StylePanel({ project, dispatch }: { project: Project; dispatch: Dispatch }) {
  const t = project.theme;
  const setTheme = (patch: Partial<Theme>) => dispatch({ type: "commit", fn: (p) => ({ ...p, theme: { ...p.theme, ...patch } }) });
  const setBase = (patch: Partial<BaseLayers>) => dispatch({ type: "commit", fn: (p) => ({ ...p, base: { ...p.base, ...patch } }) });

  return (
    <div className="stack">
      <h3>Theme</h3>
      <div className="themes">
        {THEMES.map((th) => (
          <button key={th.name} className={th.name === t.name ? "on" : ""} onClick={() => setTheme({ ...th })}>
            <span className="chips">
              {[th.land, th.roadMajor, th.water, th.district].map((c) => (
                <i key={c} style={{ background: c }} />
              ))}
            </span>
            {th.name}
          </button>
        ))}
      </div>
      <div className="grid2">
        {THEME_COLORS.map(({ key, name }) => (
          <Row key={key} label={name}>
            <input type="color" value={t[key] as string} onChange={(e) => setTheme({ [key]: e.target.value, name: "Custom" })} />
          </Row>
        ))}
      </div>
      <Row label={`Building opacity ${t.buildingOpacity.toFixed(2)}`}>
        <input type="range" min={0} max={1} step={0.05} value={t.buildingOpacity} onChange={(e) => setTheme({ buildingOpacity: Number(e.target.value) })} />
      </Row>
      <Row label={`Vignette ${t.vignette.toFixed(2)}`}>
        <input type="range" min={0} max={1} step={0.05} value={t.vignette} onChange={(e) => setTheme({ vignette: Number(e.target.value) })} />
      </Row>
      <h3>Base map</h3>
      {(Object.keys(DEFAULT_BASE) as (keyof BaseLayers)[]).map((k) => (
        <label key={k} className="check">
          <input type="checkbox" checked={project.base[k]} onChange={(e) => setBase({ [k]: e.target.checked })} />
          {BASE_NAMES[k]}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- annotations

const PIN_GLYPHS = ["☠", "🩸", "🦇", "🐺", "👁", "⚰", "🔥", "🏠", "⚔", "🕯", "🗝", "💰", "⛪", "❓", "★", "♛"];
const KIND_ICON: Record<Annotation["kind"], string> = { pin: "📍", text: "T", path: "〰", area: "⬠" };

function anchorOf(a: Annotation): LngLat {
  switch (a.kind) {
    case "pin":
    case "text":
      return a.at;
    case "path":
      return a.points[Math.floor(a.points.length / 2)]!;
    case "area": {
      const b = new LngLatBounds();
      a.ring.forEach((p) => b.extend([...p]));
      const c = b.getCenter();
      return [c.lng, c.lat];
    }
  }
}

export function AnnotationsPanel(props: {
  project: Project;
  dispatch: Dispatch;
  map: MlMap | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { project, dispatch, map, selection, onSelect } = props;
  const selected = selection?.kind === "annotation" ? project.annotations.find((a) => a.id === selection.id) : undefined;

  const patch = (id: string, fn: (a: Annotation) => Annotation) =>
    dispatch({ type: "commit", fn: (p) => ({ ...p, annotations: p.annotations.map((a) => (a.id === id ? fn(a) : a)) }) });

  return (
    <div className="stack">
      {selected ? (
        <AnnotationEditor
          key={selected.id}
          a={selected}
          onChange={(fn) => patch(selected.id, fn)}
          onDelete={() => {
            dispatch({ type: "commit", fn: (p) => ({ ...p, annotations: p.annotations.filter((a) => a.id !== selected.id) }) });
            onSelect(null);
          }}
        />
      ) : (
        <p className="muted">Pick a tool from the bar on the map (or press 1–6) and start drawing. Click something with Select to edit it.</p>
      )}
      <h3>All annotations ({project.annotations.length})</h3>
      <ul className="annlist">
        {project.annotations.map((a) => (
          <li
            key={a.id}
            className={a.id === selected?.id ? "on" : ""}
            onClick={() => {
              onSelect({ kind: "annotation", id: a.id });
              map?.easeTo({ center: [...anchorOf(a)] });
            }}
          >
            <i style={{ color: a.color }}>{a.kind === "pin" ? a.glyph : KIND_ICON[a.kind]}</i>
            {a.label || <span className="muted">unnamed {a.kind}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnnotationEditor({ a, onChange, onDelete }: { a: Annotation; onChange: (fn: (a: Annotation) => Annotation) => void; onDelete: () => void }) {
  // Typing is local and committed on blur, so a label is one undo step rather than one per keystroke.
  const [label, setLabel] = useState(a.label);
  const commitLabel = () => label !== a.label && onChange((x) => ({ ...x, label }));

  return (
    <div className="card editor">
      <h3>
        {KIND_ICON[a.kind]} {a.kind}
      </h3>
      <label className="col">
        <span>Label</span>
        <input
          // Pins, labels and domains are nearly always named straight away; freehand strokes rarely are,
          // and grabbing focus there would eat the 1–6 tool hotkeys mid-sketch.
          autoFocus={a.kind !== "path"}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
          placeholder="Elysium, Nosferatu warren, …"
        />
      </label>
      <Row label="Colour">
        <input type="color" value={a.color} onChange={(e) => onChange((x) => ({ ...x, color: e.target.value }))} />
      </Row>
      {a.kind === "pin" && (
        <div className="glyphs">
          {PIN_GLYPHS.map((g) => (
            <button key={g} className={g === a.glyph ? "on" : ""} onClick={() => onChange((x) => ({ ...x, glyph: g }) as Annotation)}>
              {g}
            </button>
          ))}
          <input className="glyph" value={a.glyph} onChange={(e) => onChange((x) => ({ ...x, glyph: e.target.value }) as Annotation)} />
        </div>
      )}
      {a.kind === "text" && (
        <Row label={`Size ${a.size}`}>
          <input type="range" min={10} max={48} value={a.size} onChange={(e) => onChange((x) => ({ ...x, size: Number(e.target.value) }) as Annotation)} />
        </Row>
      )}
      {a.kind === "path" && (
        <Row label={`Width ${a.width}`}>
          <input type="range" min={1} max={14} value={a.width} onChange={(e) => onChange((x) => ({ ...x, width: Number(e.target.value) }) as Annotation)} />
        </Row>
      )}
      {a.kind === "area" && (
        <Row label={`Fill ${a.fillOpacity.toFixed(2)}`}>
          <input type="range" min={0} max={0.8} step={0.05} value={a.fillOpacity} onChange={(e) => onChange((x) => ({ ...x, fillOpacity: Number(e.target.value) }) as Annotation)} />
        </Row>
      )}
      {(a.kind === "path" || a.kind === "area") && (
        <label className="check">
          <input type="checkbox" checked={a.dashed} onChange={(e) => onChange((x) => ({ ...x, dashed: e.target.checked }) as Annotation)} />
          Dashed
        </label>
      )}
      <div className="buttons">
        <button className="danger" onClick={onDelete}>
          Delete (Del)
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- export

export function ExportPanel({ project, map, onDeselect }: { project: Project; map: MlMap | null; onDeselect: () => void }) {
  const [scale, setScale] = useState(2);
  const [vignette, setVignette] = useState(project.theme.vignette);
  const [attribution, setAttribution] = useState(true);
  const [gridPx, setGridPx] = useState(100);
  const [busy, setBusy] = useState(false);
  useMapTick(map);

  if (!map) return null;
  const cssW = map.getCanvas().clientWidth;
  const cssH = map.getCanvas().clientHeight;
  const mPerPx = metersPerCssPixel(map) / scale;
  const gridMeters = gridPx * mPerPx;

  const run = async () => {
    setBusy(true);
    // The selection halo is drawn by the map itself, so it would end up in the image.
    onDeselect();
    await new Promise((r) => setTimeout(r, 50));
    try {
      download(await exportPng(map, { scale, vignette, attribution }), `${slug(project)}.png`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <p className="muted">Exports exactly what's in the map view, minus the UI. Frame it first.</p>
      <Row label="Resolution">
        <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
          {[1, 2, 3, 4].map((s) => (
            <option key={s} value={s}>
              {s}× · {cssW * s}×{cssH * s}
            </option>
          ))}
        </select>
      </Row>
      <Row label={`Vignette ${vignette.toFixed(2)}`}>
        <input type="range" min={0} max={1} step={0.05} value={vignette} onChange={(e) => setVignette(Number(e.target.value))} />
      </Row>
      <label className="check">
        <input type="checkbox" checked={attribution} onChange={(e) => setAttribution(e.target.checked)} />
        OSM credit in the corner
      </label>
      <button className="primary" disabled={busy} onClick={() => void run()}>
        {busy ? "Rendering…" : "Download PNG"}
      </button>
      <h3>Foundry scene setup</h3>
      <Row label="Grid size (px)">
        <input type="number" min={50} value={gridPx} onChange={(e) => setGridPx(Number(e.target.value) || 100)} />
      </Row>
      <div className="card">
        <div>
          Grid size <b>{gridPx}</b> · Grid distance <b>{gridMeters < 10 ? gridMeters.toFixed(1) : Math.round(gridMeters)}</b> · Units <b>m</b>
        </div>
        <div className="muted">Paste into the scene's Grid settings so measurements are real-world. Recalculates as you zoom and change resolution.</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- project

export function ProjectPanel({ project, dispatch, onReset }: { project: Project; dispatch: Dispatch; onReset: () => void }) {
  const [error, setError] = useState<string | null>(null);

  const load = async (file: File) => {
    try {
      dispatch({ type: "replace", project: parseProject(JSON.parse(await file.text())) });
      onReset();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="stack">
      <Row label="Chronicle">
        <input value={project.name} onChange={(e) => dispatch({ type: "silent", fn: (p) => ({ ...p, name: e.target.value }) })} />
      </Row>
      <p className="muted">Everything autosaves to this browser. Save a file to move it elsewhere or keep versions.</p>
      <div className="buttons">
        <button onClick={() => download(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), `${slug(project)}.nightmap.json`)}>
          Save .json
        </button>
        <label className="button">
          Load .json
          <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        </label>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="buttons">
        <button
          className="danger"
          onClick={() => {
            if (!confirm("Start over? Unsaved work in this browser is gone (undo still works).")) return;
            dispatch({ type: "replace", project: { ...defaultProject(), view: project.view } });
            onReset();
          }}
        >
          New chronicle
        </button>
      </div>
    </div>
  );
}
