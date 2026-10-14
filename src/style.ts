import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import type { Annotation, Project } from "./types";

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_ITALIC = ["Noto Sans Italic"];

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]];

const visible = (on: boolean) => (on ? "visible" : "none") as "visible" | "none";

const lineClass = (...classes: string[]): FilterSpecification => [
  "all",
  ["match", ["get", "class"], classes, true, false],
  ["!=", ["get", "brunnel"], "tunnel"],
];

export function pinImageId(color: string, glyph: string) {
  return `pin|${color}|${glyph}`;
}

const pinImageExpr: ExpressionSpecification = [
  "concat",
  "pin|",
  ["get", "color"],
  "|",
  ["get", "glyph"],
];

export function annotationsToGeoJSON(annotations: Annotation[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: annotations.map((a): Feature => {
      const props = { ...a } as Record<string, unknown>;
      delete props.at;
      delete props.points;
      delete props.ring;
      switch (a.kind) {
        case "pin":
        case "text":
          return { type: "Feature", properties: props, geometry: { type: "Point", coordinates: [...a.at] } };
        case "path":
          return {
            type: "Feature",
            properties: props,
            geometry: { type: "LineString", coordinates: a.points.map((p) => [...p]) },
          };
        case "area":
          return {
            type: "Feature",
            properties: props,
            geometry: { type: "Polygon", coordinates: [[...a.ring, a.ring[0]!].map((p) => [...p])] },
          };
      }
    }),
  };
}

export function poisToGeoJSON(project: Project): FeatureCollection {
  const hidden = new Set(project.hiddenPois);
  const features: Feature[] = [];
  for (const cat of project.categories) {
    if (!cat.enabled) continue;
    for (const poi of project.pois[cat.id] ?? []) {
      if (hidden.has(poi.osmId)) continue;
      features.push({
        type: "Feature",
        properties: {
          osmId: poi.osmId,
          category: cat.id,
          color: cat.color,
          glyph: cat.glyph,
          label: cat.labels ? (poi.name ?? "") : "",
        },
        geometry: { type: "Point", coordinates: [...poi.at] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

export const INTERACTIVE_LAYERS = [
  "ann-pin",
  "ann-text",
  "ann-path",
  "ann-path-dashed",
  "ann-area-fill",
  "pois",
] as const;

/**
 * The whole map is a pure function of the project. App feeds this to
 * `map.setStyle(style, { diff: true })`, and MapLibre works out the minimal update.
 */
export function buildStyle(project: Project, selectedId: string | null): StyleSpecification {
  const { theme: t, base } = project;
  const selectedFilter: FilterSpecification = ["==", ["get", "id"], selectedId ?? "__none__"];

  const layers: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": t.land } },
    {
      id: "park",
      type: "fill",
      source: "omt",
      "source-layer": "park",
      layout: { visibility: visible(base.parks) },
      paint: { "fill-color": t.park },
    },
    {
      id: "landcover-green",
      type: "fill",
      source: "omt",
      "source-layer": "landcover",
      filter: ["match", ["get", "class"], ["wood", "grass"], true, false],
      layout: { visibility: visible(base.parks) },
      paint: { "fill-color": t.park, "fill-opacity": 0.8 },
    },
    {
      id: "landuse-cemetery",
      type: "fill",
      source: "omt",
      "source-layer": "landuse",
      filter: ["==", ["get", "class"], "cemetery"],
      layout: { visibility: visible(base.parks) },
      paint: { "fill-color": t.park, "fill-opacity": 0.8 },
    },
    {
      id: "water",
      type: "fill",
      source: "omt",
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": t.water },
    },
    {
      id: "waterway",
      type: "line",
      source: "omt",
      "source-layer": "waterway",
      paint: { "line-color": t.water, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 16, 4] },
    },
    {
      id: "building",
      type: "fill",
      source: "omt",
      "source-layer": "building",
      minzoom: 13,
      layout: { visibility: visible(base.buildings) },
      paint: {
        "fill-color": t.building,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, t.buildingOpacity],
        "fill-outline-color": t.roadMinor,
      },
    },
    {
      id: "road-minor",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: lineClass("minor", "service", "path", "track"),
      minzoom: 12,
      layout: { visibility: visible(base.minorRoads), "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": t.roadMinor,
        "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.5, 18, 10],
      },
    },
    {
      id: "road-major",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: lineClass("motorway", "trunk", "primary", "secondary", "tertiary"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": t.roadMajor,
        "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 8, 0.5, 18, 22],
      },
    },
    {
      id: "rail",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      filter: lineClass("rail", "transit"),
      layout: { visibility: visible(base.rail) },
      paint: {
        "line-color": t.rail,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 18, 3],
        "line-dasharray": [3, 2],
      },
    },

    // --- annotations, under the labels so streets stay readable through districts ---
    {
      id: "ann-area-fill",
      type: "fill",
      source: "ann",
      filter: ["==", ["get", "kind"], "area"],
      paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fillOpacity"] },
    },
    {
      id: "ann-area-line",
      type: "line",
      source: "ann",
      filter: ["all", ["==", ["get", "kind"], "area"], ["!", ["get", "dashed"]]],
      paint: { "line-color": ["get", "color"], "line-width": 2.5 },
    },
    {
      id: "ann-area-line-dashed",
      type: "line",
      source: "ann",
      filter: ["all", ["==", ["get", "kind"], "area"], ["get", "dashed"]],
      paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [3, 2] },
    },

    // --- base labels ---
    {
      id: "water-label",
      type: "symbol",
      source: "omt",
      "source-layer": "water_name",
      layout: { visibility: visible(base.waterLabels), "text-field": NAME, "text-font": FONT_ITALIC, "text-size": 12 },
      paint: { "text-color": t.water === t.land ? t.label : mix(t.label, t.water), "text-halo-color": t.labelHalo, "text-halo-width": 1 },
    },
    {
      id: "street-label",
      type: "symbol",
      source: "omt",
      "source-layer": "transportation_name",
      minzoom: 13,
      layout: {
        visibility: visible(base.streetLabels),
        "symbol-placement": "line",
        "text-field": NAME,
        "text-font": FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 9, 18, 14],
      },
      paint: { "text-color": t.label, "text-halo-color": t.labelHalo, "text-halo-width": 1.2 },
    },
    {
      id: "district-label",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      filter: ["match", ["get", "class"], ["suburb", "quarter", "neighbourhood"], true, false],
      layout: {
        visibility: visible(base.districtLabels),
        "text-field": ["upcase", NAME],
        "text-font": FONT_BOLD,
        "text-size": ["match", ["get", "class"], "suburb", 14, 11],
        "text-letter-spacing": 0.25,
        "text-max-width": 8,
      },
      paint: { "text-color": t.district, "text-halo-color": t.labelHalo, "text-halo-width": 1.5 },
    },
    {
      id: "place-label",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      filter: ["match", ["get", "class"], ["city", "town", "village"], true, false],
      layout: {
        visibility: visible(base.placeLabels),
        "text-field": NAME,
        "text-font": FONT_BOLD,
        "text-size": ["match", ["get", "class"], "city", 22, 16],
      },
      paint: { "text-color": t.label, "text-halo-color": t.labelHalo, "text-halo-width": 2 },
    },

    // --- highlights from Overpass ---
    {
      id: "pois",
      type: "symbol",
      source: "pois",
      layout: {
        "icon-image": pinImageExpr,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 1],
        "icon-allow-overlap": true,
        "text-field": ["get", "label"],
        "text-font": FONT,
        "text-size": 11,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": t.label, "text-halo-color": t.labelHalo, "text-halo-width": 1.5 },
    },

    // --- annotations on top ---
    {
      id: "ann-selected-line",
      type: "line",
      source: "ann",
      filter: ["all", selectedFilter, ["!=", ["get", "kind"], "pin"], ["!=", ["get", "kind"], "text"]],
      paint: { "line-color": "#ffffff", "line-width": ["+", ["coalesce", ["get", "width"], 2.5], 6], "line-opacity": 0.35 },
    },
    {
      id: "ann-path",
      type: "line",
      source: "ann",
      filter: ["all", ["==", ["get", "kind"], "path"], ["!", ["get", "dashed"]]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["get", "width"] },
    },
    {
      id: "ann-path-dashed",
      type: "line",
      source: "ann",
      filter: ["all", ["==", ["get", "kind"], "path"], ["get", "dashed"]],
      layout: { "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-dasharray": [2, 1.5] },
    },
    {
      id: "ann-path-label",
      type: "symbol",
      source: "ann",
      filter: ["==", ["get", "kind"], "path"],
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "label"],
        "text-font": FONT_BOLD,
        "text-size": 13,
        "text-offset": [0, -1],
      },
      paint: { "text-color": ["get", "color"], "text-halo-color": t.labelHalo, "text-halo-width": 2 },
    },
    {
      id: "ann-area-label",
      type: "symbol",
      source: "ann",
      filter: ["==", ["get", "kind"], "area"],
      layout: {
        "text-field": ["upcase", ["get", "label"]],
        "text-font": FONT_BOLD,
        "text-size": 16,
        "text-letter-spacing": 0.3,
        "text-max-width": 10,
        "text-allow-overlap": true,
      },
      paint: { "text-color": ["get", "color"], "text-halo-color": t.labelHalo, "text-halo-width": 2 },
    },
    {
      id: "ann-selected-point",
      type: "circle",
      source: "ann",
      filter: ["all", selectedFilter, ["match", ["get", "kind"], ["pin", "text"], true, false]],
      paint: { "circle-radius": 22, "circle-color": "#ffffff", "circle-opacity": 0.18, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 },
    },
    {
      id: "ann-pin",
      type: "symbol",
      source: "ann",
      filter: ["==", ["get", "kind"], "pin"],
      layout: {
        "icon-image": pinImageExpr,
        "icon-allow-overlap": true,
        "text-field": ["get", "label"],
        "text-font": FONT_BOLD,
        "text-size": 13,
        "text-offset": [0, 1.5],
        "text-anchor": "top",
        "text-allow-overlap": true,
      },
      paint: { "text-color": ["get", "color"], "text-halo-color": t.labelHalo, "text-halo-width": 2 },
    },
    {
      id: "ann-text",
      type: "symbol",
      source: "ann",
      filter: ["==", ["get", "kind"], "text"],
      layout: {
        "text-field": ["get", "label"],
        "text-font": FONT_BOLD,
        "text-size": ["get", "size"],
        "text-allow-overlap": true,
        "text-max-width": 14,
      },
      paint: { "text-color": ["get", "color"], "text-halo-color": t.labelHalo, "text-halo-width": 2 },
    },

    // --- in-progress drawing; fed imperatively so mouse moves don't go through the style diff ---
    {
      id: "draft-fill",
      type: "fill",
      source: "draft",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#ffffff", "fill-opacity": 0.12 },
    },
    {
      id: "draft-line",
      type: "line",
      source: "draft",
      filter: ["!=", ["geometry-type"], "Point"],
      paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 2] },
    },
    {
      id: "draft-vertex",
      type: "circle",
      source: "draft",
      filter: ["==", ["geometry-type"], "Point"],
      paint: { "circle-radius": 4, "circle-color": "#ffffff" },
    },
  ];

  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      omt: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution: '© <a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      pois: { type: "geojson", data: poisToGeoJSON(project) },
      ann: { type: "geojson", data: annotationsToGeoJSON(project.annotations) },
      draft: { type: "geojson", data: EMPTY_FC },
    },
    layers,
  };
}

/** Halfway blend of two #rrggbb colours, so water labels read as "watery" in any theme. */
function mix(a: string, b: string): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round((((pa >> shift) & 255) + ((pb >> shift) & 255)) / 2);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Rasterises a round marker with an emoji/glyph on it; registered lazily via `styleimagemissing`. */
export function drawPinImage(color: string, glyph: string, pixelRatio: number): ImageData {
  const size = 30 * pixelRatio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = size / 2 - 2 * pixelRatio;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 3 * pixelRatio;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5 * pixelRatio;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = `${15 * pixelRatio}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, size / 2, size / 2 + pixelRatio);
  return ctx.getImageData(0, 0, size, size);
}
