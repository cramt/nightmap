import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { MapView, type Selection } from "./MapView";
import { useProject } from "./store";
import type { Tool } from "./types";
import { AnnotationsPanel, ExportPanel, HighlightsPanel, ProjectPanel, SearchBox, StylePanel } from "./panels";

const TOOLS: { tool: Tool; icon: string; name: string; hint: string }[] = [
  { tool: "select", icon: "⇱", name: "Select", hint: "Click to select, drag pins/labels to move" },
  { tool: "pin", icon: "📍", name: "Pin", hint: "Click to drop a pin" },
  { tool: "text", icon: "T", name: "Label", hint: "Click to place a label" },
  { tool: "path", icon: "〰", name: "Path", hint: "Click to add points · double-click/Enter finishes · Backspace undoes a point · Esc cancels" },
  { tool: "area", icon: "⬠", name: "Area", hint: "Click to outline a domain · double-click/Enter closes it · Esc cancels" },
  { tool: "freehand", icon: "✎", name: "Draw", hint: "Drag to draw freehand" },
];

const INKS = ["#e03c3c", "#f0a030", "#e8d34a", "#4ac06a", "#3ca0e0", "#a060e0", "#f0f0f0", "#202020"];

const SECTIONS = ["Highlights", "Style", "Annotations", "Export", "Project"] as const;
type Section = (typeof SECTIONS)[number];

export function App() {
  const { project, dispatch, canUndo, canRedo } = useProject();
  const [tool, setTool] = useState<Tool>("select");
  const [ink, setInk] = useState(INKS[0]!);
  const [selection, setSelection] = useState<Selection>(null);
  const [section, setSection] = useState<Section>("Highlights");
  const [map, setMap] = useState<MlMap | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const onSelect = useCallback((s: Selection) => {
    setSelection(s);
    if (s?.kind === "annotation") setSection("Annotations");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if ((e.key === "Delete" || (e.key === "Backspace" && toolRef.current === "select")) && selection?.kind === "annotation") {
        const id = selection.id;
        dispatch({ type: "commit", fn: (p) => ({ ...p, annotations: p.annotations.filter((a) => a.id !== id) }) });
        setSelection(null);
      } else if (!mod && !e.altKey) {
        const idx = Number(e.key) - 1;
        const t = TOOLS[idx];
        if (t) setTool(t.tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, selection]);

  const activeTool = TOOLS.find((t) => t.tool === tool)!;

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>nightmap</h1>
          <span className="sub">{project.name}</span>
        </header>
        <SearchBox map={map} />
        <nav className="tabs">
          {SECTIONS.map((s) => (
            <button key={s} className={s === section ? "on" : ""} onClick={() => setSection(s)}>
              {s}
            </button>
          ))}
        </nav>
        <div className="panel">
          {section === "Highlights" && <HighlightsPanel project={project} dispatch={dispatch} map={map} selection={selection} onSelect={setSelection} />}
          {section === "Style" && <StylePanel project={project} dispatch={dispatch} />}
          {section === "Annotations" && <AnnotationsPanel project={project} dispatch={dispatch} map={map} selection={selection} onSelect={setSelection} />}
          {section === "Export" && <ExportPanel project={project} map={map} onDeselect={() => setSelection(null)} />}
          {section === "Project" && <ProjectPanel project={project} dispatch={dispatch} onReset={() => setSelection(null)} />}
        </div>
      </aside>
      <main className="stage">
        <MapView
          project={project}
          selection={selection}
          tool={tool}
          ink={ink}
          dispatch={dispatch}
          onSelect={onSelect}
          onToolDone={() => setTool("select")}
          onMap={setMap}
        />
        <div className="toolbar">
          {TOOLS.map((t, i) => (
            <button key={t.tool} className={t.tool === tool ? "on" : ""} onClick={() => setTool(t.tool)} title={`${t.name} (${i + 1})`}>
              <span className="icon">{t.icon}</span>
              <span className="name">{t.name}</span>
            </button>
          ))}
          <span className="sep" />
          {INKS.map((c) => (
            <button key={c} className={`swatch ${c === ink ? "on" : ""}`} style={{ background: c }} onClick={() => setInk(c)} title={`Ink ${c}`} />
          ))}
          <input type="color" value={ink} onChange={(e) => setInk(e.target.value)} title="Custom ink" />
          <span className="sep" />
          <button disabled={!canUndo} onClick={() => dispatch({ type: "undo" })} title="Undo (Ctrl+Z)">↶</button>
          <button disabled={!canRedo} onClick={() => dispatch({ type: "redo" })} title="Redo (Ctrl+Shift+Z)">↷</button>
        </div>
        <div className="hint">{activeTool.hint}</div>
        <div className="vignette" style={{ opacity: project.theme.vignette }} />
      </main>
    </div>
  );
}
