import { useEffect, useRef } from "react";
import { Map as MlMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { Feature } from "geojson";
import { buildStyle, drawPinImage, INTERACTIVE_LAYERS } from "./style";
import type { Action } from "./store";
import type { Annotation, LngLat, Project, Tool } from "./types";

export type Selection = { kind: "annotation"; id: string } | { kind: "poi"; osmId: string; name: string } | null;

type Props = {
  project: Project;
  selection: Selection;
  tool: Tool;
  ink: string;
  dispatch: (a: Action) => void;
  onSelect: (s: Selection) => void;
  onToolDone: () => void;
  onMap: (m: MlMap) => void;
};

// MapLibre 6 finds its worker relative to its own module, which Vite's bundling breaks in both dev and build.
setWorkerUrl(workerUrl);

const PIN_PIXEL_RATIO = 3;

export const newId = () => crypto.randomUUID().slice(0, 8);

const ll = (e: MapMouseEvent): LngLat => [e.lngLat.lng, e.lngLat.lat];

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  // Handlers are bound once; they read the latest props through this ref.
  const live = useRef(props);
  live.current = props;
  const draft = useRef<LngLat[]>([]);
  const hover = useRef<LngLat | null>(null);
  const drag = useRef<{ id: string } | null>(null);
  const freehand = useRef(false);
  const cancelShape = useRef<() => void>(() => {});
  const styleReady = useRef(false);

  const selectedAnnotationId = props.selection?.kind === "annotation" ? props.selection.id : null;

  useEffect(() => {
    const { project } = live.current;
    const map = new MlMap({
      container: container.current!,
      style: buildStyle(project, null),
      center: [...project.view.center],
      zoom: project.view.zoom,
      bearing: project.view.bearing,
      pitch: project.view.pitch,
      // Export reads the WebGL canvas back; without this it comes out blank.
      canvasContextAttributes: { preserveDrawingBuffer: true },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (import.meta.env.DEV) Object.assign(window, { map });
    map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    map.setMissingStyleImageResolver((id) => {
      const [kind, color, glyph] = id.split("|");
      if (kind !== "pin" || !color || glyph === undefined) return;
      map.addImage(id, drawPinImage(color, glyph, PIN_PIXEL_RATIO), { pixelRatio: PIN_PIXEL_RATIO });
    });

    // Diffing against a style that is still loading makes MapLibre throw it all away and start over,
    // so hold edits until the first load and then catch up once.
    map.once("load", () => {
      styleReady.current = true;
      const { project, selection } = live.current;
      map.setStyle(buildStyle(project, selection?.kind === "annotation" ? selection.id : null), { diff: true });
    });

    map.on("moveend", () => {
      const c = map.getCenter();
      live.current.dispatch({
        type: "silent",
        fn: (p) => ({
          ...p,
          view: { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() },
        }),
      });
    });

    const renderDraft = () => {
      const src = map.getSource<GeoJSONSource>("draft");
      if (!src) return;
      const { tool } = live.current;
      const pts = hover.current && !freehand.current ? [...draft.current, hover.current] : draft.current;
      const features: Feature[] = draft.current.map((p) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [...p] },
      }));
      if (pts.length >= 2) {
        features.push({
          type: "Feature",
          properties: {},
          geometry:
            tool === "area" && pts.length >= 3
              ? { type: "Polygon", coordinates: [[...pts, pts[0]!].map((p) => [...p])] }
              : { type: "LineString", coordinates: pts.map((p) => [...p]) },
        });
      }
      src.setData(freehand.current ? { type: "FeatureCollection", features: features.slice(-1) } : { type: "FeatureCollection", features });
    };

    const add = (a: Annotation) => {
      live.current.dispatch({ type: "commit", fn: (p) => ({ ...p, annotations: [...p.annotations, a] }) });
      live.current.onSelect({ kind: "annotation", id: a.id });
    };

    const finishShape = () => {
      const { tool, ink } = live.current;
      // A double-click lands two clicks on the same spot before the dblclick fires.
      const pts = draft.current.filter((p, i, arr) => {
        const prev = arr[i - 1];
        if (!prev) return true;
        const a = map.project([...p]);
        const b = map.project([...prev]);
        return Math.hypot(a.x - b.x, a.y - b.y) > 3;
      });
      draft.current = [];
      hover.current = null;
      renderDraft();
      if (tool === "path" && pts.length >= 2) {
        add({ id: newId(), kind: "path", label: "", color: ink, points: pts, width: 4, dashed: false });
      } else if (tool === "area" && pts.length >= 3) {
        add({ id: newId(), kind: "area", label: "New domain", color: ink, ring: pts, fillOpacity: 0.25, dashed: false });
      }
    };
    cancelShape.current = () => {
      draft.current = [];
      hover.current = null;
      freehand.current = false;
      renderDraft();
    };

    map.on("click", (e) => {
      const { tool, ink } = live.current;
      switch (tool) {
        case "select": {
          const hit = map.queryRenderedFeatures(e.point, { layers: [...INTERACTIVE_LAYERS] })[0];
          const props = hit?.properties as Record<string, string> | undefined;
          if (!hit || !props) return live.current.onSelect(null);
          if (hit.layer.id === "pois") {
            live.current.onSelect({ kind: "poi", osmId: props.osmId!, name: props.label || props.osmId! });
          } else {
            live.current.onSelect({ kind: "annotation", id: props.id! });
          }
          return;
        }
        case "pin":
          add({ id: newId(), kind: "pin", label: "", color: ink, at: ll(e), glyph: "☠" });
          return live.current.onToolDone();
        case "text":
          add({ id: newId(), kind: "text", label: "Label", color: ink, at: ll(e), size: 18 });
          return live.current.onToolDone();
        case "path":
        case "area":
          draft.current = [...draft.current, ll(e)];
          renderDraft();
          return;
        case "freehand":
          return;
      }
    });

    map.on("dblclick", (e) => {
      const { tool } = live.current;
      if (tool === "path" || tool === "area") {
        e.preventDefault();
        finishShape();
      }
    });

    map.on("mousedown", (e) => {
      const { tool } = live.current;
      if (tool === "freehand") {
        e.preventDefault();
        freehand.current = true;
        draft.current = [ll(e)];
        return;
      }
      if (tool !== "select") return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ["ann-pin", "ann-text"] })[0];
      const id = hit?.properties?.id as string | undefined;
      if (!id) return;
      // preventDefault alone doesn't stop MapLibre 6's dragPan from also grabbing the gesture.
      map.dragPan.disable();
      drag.current = { id };
      live.current.onSelect({ kind: "annotation", id });
      // An identity commit gives the drag its own undo step; the moves themselves are silent.
      live.current.dispatch({ type: "commit", fn: (p) => ({ ...p }) });
    });

    map.on("mousemove", (e) => {
      const { tool } = live.current;
      if (drag.current) {
        const { id } = drag.current;
        const at = ll(e);
        live.current.dispatch({
          type: "silent",
          fn: (p) => ({
            ...p,
            annotations: p.annotations.map((a) => (a.id === id && (a.kind === "pin" || a.kind === "text") ? { ...a, at } : a)),
          }),
        });
        return;
      }
      if (freehand.current) {
        const last = draft.current.at(-1)!;
        const a = map.project([...last]);
        if (Math.hypot(a.x - e.point.x, a.y - e.point.y) >= 4) {
          draft.current = [...draft.current, ll(e)];
          renderDraft();
        }
        return;
      }
      if ((tool === "path" || tool === "area") && draft.current.length > 0) {
        hover.current = ll(e);
        renderDraft();
      }
      if (tool === "select") {
        const hit = map.queryRenderedFeatures(e.point, { layers: [...INTERACTIVE_LAYERS] }).length > 0;
        map.getCanvas().style.cursor = hit ? "pointer" : "";
      }
    });

    map.on("mouseup", () => {
      if (drag.current) {
        drag.current = null;
        map.dragPan.enable();
      }
      if (freehand.current) {
        freehand.current = false;
        const pts = draft.current;
        draft.current = [];
        renderDraft();
        if (pts.length >= 2) {
          add({ id: newId(), kind: "path", label: "", color: live.current.ink, points: pts, width: 3, dashed: false });
        }
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Enter") finishShape();
      if (e.key === "Escape") {
        if (draft.current.length) cancelShape.current();
        else live.current.onSelect(null);
      }
      if (e.key === "Backspace" && draft.current.length) {
        draft.current = draft.current.slice(0, -1);
        renderDraft();
      }
    };
    window.addEventListener("keydown", onKey);

    live.current.onMap(map);

    return () => {
      styleReady.current = false;
      window.removeEventListener("keydown", onKey);
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (!styleReady.current) return;
    mapRef.current?.setStyle(buildStyle(props.project, selectedAnnotationId), { diff: true });
  }, [props.project, selectedAnnotationId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Switching tools mid-shape throws the shape away.
    cancelShape.current();
    const drawing = props.tool !== "select";
    map.getCanvas().style.cursor = drawing ? "crosshair" : "";
    if (props.tool === "path" || props.tool === "area") map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    if (props.tool === "freehand") map.dragPan.disable();
    else map.dragPan.enable();
  }, [props.tool]);

  return <div ref={container} className="map" />;
}
