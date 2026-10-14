import type { Category, LngLat, Poi } from "./types";

type Op = "=" | "!=" | "~" | "!~" | "exists";
type Clause = { key: string; op: Op; value: string };

/**
 * Parses the subset of Overpass tag filters we support: `["k"]`, `["k"="v"]`,
 * `["k"!="v"]`, `["k"~"re"]`, `["k"!~"re"]`. We need them client-side too,
 * because one batched query can't tell us which category an element matched.
 */
export function parseSelector(src: string): Clause[] | string {
  const re = /\["([^"]+)"(?:(!=|=|!~|~)"([^"]*)")?\]/gy;
  const clauses: Clause[] = [];
  const trimmed = src.trim();
  let pos = 0;
  while (pos < trimmed.length) {
    re.lastIndex = pos;
    const m = re.exec(trimmed);
    if (!m) return `can't parse near "${trimmed.slice(pos, pos + 20)}"`;
    clauses.push({ key: m[1]!, op: (m[2] as Op | undefined) ?? "exists", value: m[3] ?? "" });
    pos = re.lastIndex;
  }
  if (clauses.length === 0) return "needs at least one [\"key\"…] filter";
  return clauses;
}

function matches(tags: Record<string, string>, clauses: Clause[]) {
  return clauses.every(({ key, op, value }) => {
    const v = tags[key];
    switch (op) {
      case "exists":
        return v !== undefined;
      case "=":
        return v === value;
      case "!=":
        return v !== value;
      case "~":
        return v !== undefined && new RegExp(value).test(v);
      case "!~":
        return v === undefined || !new RegExp(value).test(v);
    }
  });
}

type Element = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type Bounds = { south: number; west: number; north: number; east: number };

const ENDPOINT = "https://overpass-api.de/api/interpreter";

export async function fetchPois(categories: Category[], b: Bounds, signal?: AbortSignal) {
  const parsed = categories.map((c) => ({
    cat: c,
    selectors: c.selectors.map(parseSelector).filter((s): s is Clause[] => typeof s !== "string"),
  }));
  const bbox = `(${b.south},${b.west},${b.north},${b.east})`;
  const statements = categories.flatMap((c) => c.selectors.map((s) => `nwr${s.trim()}${bbox};`));
  const query = `[out:json][timeout:30];(${statements.join("")});out center tags;`;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    body: new URLSearchParams({ data: query }),
    signal,
  });
  if (!res.ok) throw new Error(`Overpass said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { elements: Element[] };

  const out: Record<string, Poi[]> = Object.fromEntries(categories.map((c) => [c.id, []]));
  for (const el of json.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const tags = el.tags ?? {};
    const at: LngLat = [lon, lat];
    const poi: Poi = { osmId: `${el.type}/${el.id}`, at, name: tags.name ?? null };
    for (const { cat, selectors } of parsed) {
      if (selectors.some((s) => matches(tags, s))) out[cat.id]!.push(poi);
    }
  }
  return out;
}
