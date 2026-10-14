export type LngLat = readonly [lng: number, lat: number];

export type Theme = {
  name: string;
  land: string;
  water: string;
  park: string;
  building: string;
  buildingOpacity: number;
  roadMajor: string;
  roadMinor: string;
  rail: string;
  label: string;
  labelHalo: string;
  district: string;
  vignette: number;
};

export type BaseLayers = {
  parks: boolean;
  buildings: boolean;
  minorRoads: boolean;
  rail: boolean;
  streetLabels: boolean;
  districtLabels: boolean;
  placeLabels: boolean;
  waterLabels: boolean;
};

/** One thing worth marking on the map, defined by Overpass tag filters. */
export type Category = {
  id: string;
  name: string;
  glyph: string;
  color: string;
  /** Overpass filter chains, OR'ed together, e.g. `["railway"="station"]["station"="subway"]`. */
  selectors: string[];
  enabled: boolean;
  labels: boolean;
};

export type Poi = { osmId: string; at: LngLat; name: string | null };

type AnnotationBase = { id: string; label: string; color: string };

export type Annotation =
  | (AnnotationBase & { kind: "pin"; at: LngLat; glyph: string })
  | (AnnotationBase & { kind: "text"; at: LngLat; size: number })
  | (AnnotationBase & { kind: "path"; points: LngLat[]; width: number; dashed: boolean })
  | (AnnotationBase & { kind: "area"; ring: LngLat[]; fillOpacity: number; dashed: boolean });

export type AnnotationKind = Annotation["kind"];

export type Tool = "select" | "pin" | "text" | "path" | "area" | "freehand";

export type View = { center: LngLat; zoom: number; bearing: number; pitch: number };

export type Project = {
  version: 1;
  name: string;
  view: View;
  theme: Theme;
  base: BaseLayers;
  categories: Category[];
  /** Fetched POIs per category id; merged across fetches so panning around accumulates. */
  pois: Record<string, Poi[]>;
  hiddenPois: string[];
  annotations: Annotation[];
};
