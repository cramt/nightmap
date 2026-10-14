import { useEffect, useReducer } from "react";
import { defaultProject } from "./presets";
import type { Project } from "./types";

type History = { past: Project[]; present: Project; future: Project[] };

export type Action =
  /** An edit worth undoing. */
  | { type: "commit"; fn: (p: Project) => Project }
  /** Camera moves and the like: persisted, but not an undo step. */
  | { type: "silent"; fn: (p: Project) => Project }
  | { type: "replace"; project: Project }
  | { type: "undo" }
  | { type: "redo" };

const LIMIT = 200;
const KEY = "nightmap.project";

function reducer(h: History, a: Action): History {
  switch (a.type) {
    case "commit": {
      const next = a.fn(h.present);
      if (next === h.present) return h;
      return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] };
    }
    case "silent":
      return { ...h, present: a.fn(h.present) };
    case "replace":
      return { past: [...h.past, h.present].slice(-LIMIT), present: a.project, future: [] };
    case "undo": {
      const prev = h.past.at(-1);
      if (!prev) return h;
      // Keep the current camera: undoing a drawing shouldn't yank the view around.
      return { past: h.past.slice(0, -1), present: { ...prev, view: h.present.view }, future: [h.present, ...h.future] };
    }
    case "redo": {
      const [next, ...rest] = h.future;
      if (!next) return h;
      return { past: [...h.past, h.present], present: { ...next, view: h.present.view }, future: rest };
    }
  }
}

function load(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseProject(JSON.parse(raw));
  } catch (e) {
    console.warn("ignoring unreadable saved project", e);
  }
  return defaultProject();
}

/** Fills gaps from defaults so older/hand-edited files still load. */
export function parseProject(raw: unknown): Project {
  if (typeof raw !== "object" || raw === null || (raw as { version?: unknown }).version !== 1) {
    throw new Error("not a nightmap v1 project");
  }
  const d = defaultProject();
  const p = raw as Partial<Project>;
  return {
    ...d,
    ...p,
    view: { ...d.view, ...p.view },
    theme: { ...d.theme, ...p.theme },
    base: { ...d.base, ...p.base },
    categories: p.categories ?? d.categories,
    pois: p.pois ?? {},
    hiddenPois: p.hiddenPois ?? [],
    annotations: p.annotations ?? [],
  };
}

export function useProject() {
  const [h, dispatch] = useReducer(reducer, undefined, () => ({ past: [], present: load(), future: [] }));

  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(KEY, JSON.stringify(h.present)), 300);
    return () => clearTimeout(t);
  }, [h.present]);

  return { project: h.present, dispatch, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
