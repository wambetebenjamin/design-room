// Photo-region detection: finds large textured areas (photos / detailed
// graphics) inside a poster so they can become replaceable image slots.
// Pure pixel maths — no DOM — so it is unit-testable.

import type { Rect } from './styleEst';

export interface DetectOptions {
  /** Minimum region area as a fraction of the whole image (default 2%). */
  minAreaFraction?: number;
  /** Minimum region side in pixels (default 48). */
  minSide?: number;
}

interface TileStats {
  photo: boolean;
}

function rectsOverlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Classify grid tiles as photo vs flat, excluding tiles dominated by text,
 * then merge photo tiles into bounding rectangles.
 */
export function detectPhotoRegions(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  textBoxes: Rect[] = [],
  opts: DetectOptions = {},
): Rect[] {
  const minAreaFraction = opts.minAreaFraction ?? 0.02;
  const minSide = opts.minSide ?? 48;
  if (width < minSide * 2 || height < minSide * 2) return [];

  const tile = Math.max(8, Math.min(48, Math.round(Math.min(width, height) / 34)));
  const cols = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);

  const stats: TileStats[] = new Array(cols * rows);

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = tx * tile;
      const y0 = ty * tile;
      const x1 = Math.min(width, x0 + tile);
      const y1 = Math.min(height, y0 + tile);
      const tw = x1 - x0;
      const th = y1 - y0;
      const tRect: Rect = { x0, y0, x1, y1 };
      const tileArea = tw * th;

      // Text overlap: if most of the tile sits inside OCR boxes, skip it —
      // text glyphs would otherwise masquerade as texture.
      let textArea = 0;
      for (const box of textBoxes) textArea += rectsOverlapArea(tRect, box);
      if (textArea >= tileArea * 0.4) {
        stats[ty * cols + tx] = { photo: false };
        continue;
      }

      // Sample the tile (strided, capped) for luminance spread and
      // quantised colour variety — flat fills score low on both.
      const stride = Math.max(1, Math.floor(Math.sqrt((tw * th) / 360)));
      let n = 0;
      let sum = 0;
      let sumSq = 0;
      const colors = new Set<number>();
      for (let y = y0; y < y1; y += stride) {
        for (let x = x0; x < x1; x += stride) {
          const o = (y * width + x) * 4;
          const r = pixels[o];
          const g = pixels[o + 1];
          const b = pixels[o + 2];
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          sum += luma;
          sumSq += luma * luma;
          colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
          n++;
        }
      }
      const mean = n > 0 ? sum / n : 0;
      const variance = n > 0 ? Math.max(0, sumSq / n - mean * mean) : 0;
      const std = Math.sqrt(variance);
      const unique = colors.size;

      const photo = (std >= 14 && unique >= 12) || unique >= 28 || std >= 26;
      stats[ty * cols + tx] = { photo };
    }
  }

  // Connected components (4-neighbourhood) over photo tiles.
  const seen = new Array(cols * rows).fill(false);
  const regions: Rect[] = [];
  const minTileArea = Math.max(4, Math.ceil((minAreaFraction * width * height) / (tile * tile)));

  for (let i = 0; i < stats.length; i++) {
    if (seen[i] || !stats[i]?.photo) continue;
    const queue = [i];
    seen[i] = true;
    let minX = cols;
    let minY = rows;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    while (queue.length > 0) {
      const cur = queue.pop()!;
      const cx = cur % cols;
      const cy = Math.floor(cur / cols);
      count++;
      minX = Math.min(minX, cx);
      minY = Math.min(minY, cy);
      maxX = Math.max(maxX, cx);
      maxY = Math.max(maxY, cy);
      const neighbours = [
        cx > 0 ? cur - 1 : -1,
        cx < cols - 1 ? cur + 1 : -1,
        cy > 0 ? cur - cols : -1,
        cy < rows - 1 ? cur + cols : -1,
      ];
      for (const nb of neighbours) {
        if (nb >= 0 && !seen[nb] && stats[nb]?.photo) {
          seen[nb] = true;
          queue.push(nb);
        }
      }
    }
    if (count < minTileArea) continue;

    const rect: Rect = {
      x0: minX * tile,
      y0: minY * tile,
      x1: Math.min(width, (maxX + 1) * tile),
      y1: Math.min(height, (maxY + 1) * tile),
    };
    if (rect.x1 - rect.x0 < minSide || rect.y1 - rect.y0 < minSide) continue;
    regions.push(rect);
  }

  regions.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
  return regions;
}
