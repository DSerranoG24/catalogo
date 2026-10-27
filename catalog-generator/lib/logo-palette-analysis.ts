import { isCatalogThemeCompatible } from "./catalog-theme-choice";
import type { StoredCatalogTemplate } from "./catalogTemplates";

type RGB = readonly [number, number, number];
type Swatch = { id: string; colors: readonly string[] };

// Conservative initial thresholds; calibrated on synthetic fixtures, not brand research.
export const logoColorThresholds = {
  alpha: 240, saturation: 0.2, minimumLightness: 0.06, maximumLightness: 0.94,
  chromaticFraction: 0.02, minimumCoverage: 0.01, minimumPixels: 3, clusterDistance: 70, maximumDistance: 180,
} as const;

export function redmean(a: RGB, b: RGB): number {
  const mean = (a[0] + b[0]) / 2;
  return Math.sqrt((2 + mean / 256) * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + (2 + (255 - mean) / 256) * (a[2] - b[2]) ** 2);
}

export function dominantLogoColor(pixels: Uint8ClampedArray): RGB | null {
  const bins = new Map<number, { count: number; sum: [number, number, number] }>();
  let visible = 0, chromatic = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < logoColorThresholds.alpha) continue;
    visible++;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const lightness = (max + min) / 2;
    const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
    if (saturation < logoColorThresholds.saturation || lightness < logoColorThresholds.minimumLightness || lightness > logoColorThresholds.maximumLightness) continue;
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
    const bin = bins.get(key) ?? { count: 0, sum: [0, 0, 0] };
    bin.count++; bin.sum[0] += r; bin.sum[1] += g; bin.sum[2] += b;
    bins.set(key, bin); chromatic++;
  }
  if (chromatic < logoColorThresholds.minimumPixels || chromatic / Math.max(visible, 1) < logoColorThresholds.chromaticFraction || chromatic / Math.max(pixels.length / 4, 1) < logoColorThresholds.minimumCoverage) return null;
  const sorted = [...bins.entries()].sort((a, b) => b[1].count - a[1].count || a[0] - b[0]);
  const clusters: { count: number; sum: [number, number, number]; center: RGB; key: number }[] = [];
  for (const [key, bin] of sorted) {
    const center: RGB = [bin.sum[0] / bin.count, bin.sum[1] / bin.count, bin.sum[2] / bin.count];
    const nearest = clusters.map(cluster => ({ cluster, distance: redmean(center, cluster.center) })).sort((a, b) => a.distance - b.distance || a.cluster.key - b.cluster.key)[0];
    if (nearest && nearest.distance <= logoColorThresholds.clusterDistance) {
      nearest.cluster.count += bin.count;
      for (const channel of [0, 1, 2] as const) nearest.cluster.sum[channel] += bin.sum[channel];
    } else clusters.push({ count: bin.count, sum: [...bin.sum], center, key });
  }
  clusters.sort((a, b) => b.count - a.count || a.key - b.key);
  const winner = clusters[0];
  return winner ? [winner.sum[0] / winner.count, winner.sum[1] / winner.count, winner.sum[2] / winner.count] : null;
}

export function suggestLogoPalette(pixels: Uint8ClampedArray, template: StoredCatalogTemplate, swatches: readonly Swatch[]): string | null {
  const color = dominantLogoColor(pixels);
  if (!color) return null;
  const ranked = swatches.filter(item => isCatalogThemeCompatible(template, item.id)).flatMap(item => {
    const primary = item.colors[2];
    if (!/^#[0-9a-f]{6}$/i.test(primary ?? "")) return [];
    const rgb: RGB = [parseInt(primary.slice(1, 3), 16), parseInt(primary.slice(3, 5), 16), parseInt(primary.slice(5, 7), 16)];
    return [{ id: item.id, distance: redmean(color, rgb) }];
  }).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  return ranked[0] && ranked[0].distance <= logoColorThresholds.maximumDistance ? ranked[0].id : null;
}

export function logoSampleSize(width: number, height: number) {
  const scale = Math.min(1, 100 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function readLogoPixels(source: File | string, signal: AbortSignal): Promise<Uint8ClampedArray | null> {
  let bitmap: ImageBitmap | undefined;
  let canvas: HTMLCanvasElement | undefined;
  try {
    let blob: Blob = source instanceof File ? source : new Blob();
    if (typeof source === "string") {
      const url = new URL(source);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
      const response = await fetch(url, { mode: "cors", credentials: "omit", signal, redirect: "error" });
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length"));
      if (declared > 5 * 1024 * 1024) return null;
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 5 * 1024 * 1024) { await reader.cancel(); return null; }
          chunks.push(new Uint8Array(chunk.value));
        }
      } finally { reader.releaseLock(); }
      blob = new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
    }
    if (signal.aborted || !blob.size || blob.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(blob.type.split(";")[0])) return null;
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    if (signal.aborted || !bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) return null;
    canvas = document.createElement("canvas");
    Object.assign(canvas, logoSampleSize(bitmap.width, bitmap.height));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch { return null; }
  finally { bitmap?.close(); if (canvas) { canvas.width = 0; canvas.height = 0; } }
}
