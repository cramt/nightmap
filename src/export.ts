import type { Map as MlMap } from "maplibre-gl";
import type { Project } from "./types";

/** Metres covered by one CSS pixel at the map's current centre and zoom (MapLibre uses 512px tiles). */
export function metersPerCssPixel(map: MlMap) {
  const lat = map.getCenter().lat;
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
}

export type ExportOptions = { scale: number; vignette: number; attribution: boolean };

export async function exportPng(map: MlMap, opts: ExportOptions): Promise<Blob> {
  const prevRatio = map.getPixelRatio();
  map.setPixelRatio(opts.scale);
  await new Promise<void>((resolve) => {
    map.once("idle", () => resolve());
    map.triggerRepaint();
  });
  try {
    const src = map.getCanvas();
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(src, 0, 0);

    if (opts.vignette > 0) {
      const { width: w, height: h } = out;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${opts.vignette})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    if (opts.attribution) {
      // ODbL wants the credit on the image itself, not just in the app.
      const fs = 11 * opts.scale;
      ctx.font = `${fs}px sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillText("© OpenStreetMap contributors · OpenFreeMap", out.width - fs * 0.6, out.height - fs * 0.4);
    }

    return await new Promise<Blob>((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas export failed"))), "image/png"),
    );
  } finally {
    map.setPixelRatio(prevRatio);
  }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(p: Project) {
  return p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nightmap";
}
