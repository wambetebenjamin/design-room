// Apply an OCR review to the document: build positioned text elements that
// overlay the original text, and optionally paint the original text out of
// the base image (per-row gradient from the surrounding pixels).

import type { DesignElement } from '../domain/types';
import { uid } from '../domain/document';
import type { TextRegion } from './extractText';
import type { Rect } from './styleEst';

/** A detected photo area ready to become a replaceable image slot. */
export interface PhotoSlot {
  rect: Rect;
  include: boolean;
}

/** A slot with coordinates resolved for the current base-image transform. */
export interface SlotGeometry {
  /** Region in source-image pixels (basis for the crop). */
  sourceRect: Rect;
  /** Same region mapped onto the canvas (basis for x/y/width/height). */
  canvasRect: Rect;
  include: boolean;
}

/**
 * Build image elements that sit exactly over detected photo areas.
 * The crop shows the same source pixels as beneath, so the design looks
 * untouched until the user swaps in their own picture.
 * `scale` is the base image element's crop scale (natural→frame).
 */
export function buildImageSlots(
  slots: SlotGeometry[],
  assetId: string,
  pageId: string,
  startOrder: number,
  scale = 1,
): DesignElement[] {
  const out: DesignElement[] = [];
  let order = startOrder;
  for (const slot of slots) {
    if (!slot.include) continue;
    const x = Math.round(slot.canvasRect.x0);
    const y = Math.round(slot.canvasRect.y0);
    const w = Math.max(8, Math.round(slot.canvasRect.x1) - x);
    const h = Math.max(8, Math.round(slot.canvasRect.y1) - y);
    if (w < 8 || h < 8) continue;
    const sx = slot.sourceRect.x0;
    const sy = slot.sourceRect.y0;
    out.push({
      id: uid('el'),
      pageId,
      type: 'image',
      x,
      y,
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      order: order++,
      // Frame pixel (0,0) shows source pixel (sx, sy) at the base scale.
      content: { assetId, crop: { ox: -sx * scale, oy: -sy * scale, s: scale } },
      style: { radius: 0 },
    });
  }
  return out;
}

/** One reviewed line ready to become an editable text element. */
export interface ReviewLine {
  region: TextRegion;
  include: boolean;
  text: string;
  fontFamily: string;
}

/**
 * Build text elements that sit exactly on top of the original text.
 * Width includes slack so the fitted size never wraps to a second line.
 */
export function buildTextElements(lines: ReviewLine[], pageId: string, startOrder: number): DesignElement[] {
  const out: DesignElement[] = [];
  let order = startOrder;
  for (const line of lines) {
    if (!line.include) continue;
    const text = line.text.trim();
    if (!text) continue;
    const r = line.region;
    const w = Math.max(12, Math.round(r.bbox.x1 - r.bbox.x0) + 8);
    const h = Math.max(10, Math.round(r.bbox.y1 - r.bbox.y0));
    const fontSize = r.fontSize;
    const lineHeight = Math.min(3, Math.max(0.8, h / fontSize));
    out.push({
      id: uid('el'),
      pageId,
      type: 'text',
      x: Math.round(r.bbox.x0) - 2,
      y: Math.round(r.bbox.y0),
      width: w,
      height: Math.round(fontSize * lineHeight),
      rotation: 0,
      opacity: 1,
      order: order++,
      content: { text },
      style: {
        fontFamily: line.fontFamily,
        fontSize,
        fontWeight: r.fontWeight,
        color: r.color,
        align: 'left',
        lineHeight: Math.round(lineHeight * 1000) / 1000,
        letterSpacing: 0,
        italic: false,
      },
    });
  }
  return out;
}

export interface PaintedBlob {
  blob: Blob;
  mimeType: string;
}

/**
 * Paint the original text regions out of the image using a per-row gradient
 * sampled from just outside each region — keeps flat and gradient
 * backgrounds looking continuous.
 */
export async function paintOutRegions(
  img: HTMLImageElement,
  regions: { bbox: { x0: number; y0: number; x1: number; y1: number }; bgColor: string }[],
  sourceMime: string,
): Promise<PaintedBlob> {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  const MARGIN = 8;
  const pad = 3;

  const sample = (x: number, y: number): [number, number, number] => {
    const cx = Math.max(0, Math.min(nw - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(nh - 1, Math.round(y)));
    const d = ctx.getImageData(cx, cy, 1, 1).data;
    return [d[0], d[1], d[2]];
  };

  // Largest regions first so overlapping fixes stack sensibly.
  const area = (b: { bbox: { x0: number; y0: number; x1: number; y1: number } }) =>
    Math.max(0, b.bbox.x1 - b.bbox.x0) * Math.max(0, b.bbox.y1 - b.bbox.y0);
  const sorted = [...regions].sort((a, b) => area(b) - area(a));

  for (const region of sorted) {
    const x0 = Math.max(0, Math.floor(region.bbox.x0) - pad);
    const y0 = Math.max(0, Math.floor(region.bbox.y0) - pad);
    const x1 = Math.min(nw, Math.ceil(region.bbox.x1) + pad);
    const y1 = Math.min(nh, Math.ceil(region.bbox.y1) + pad);
    if (x1 <= x0 || y1 <= y0) continue;

    const hasLeft = x0 - MARGIN >= 0;
    const hasRight = x1 + MARGIN < nw;
    const fallback = hexToRgb(region.bgColor);

    for (let y = y0; y < y1; y++) {
      let left: [number, number, number];
      let right: [number, number, number];
      if (hasLeft) left = sample(x0 - MARGIN, y);
      else left = fallback;
      if (hasRight) right = sample(x1 + MARGIN, y);
      else right = hasLeft ? left : fallback;

      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, `rgb(${left[0]},${left[1]},${left[2]})`);
      g.addColorStop(1, `rgb(${right[0]},${right[1]},${right[2]})`);
      ctx.fillStyle = g;
      ctx.fillRect(x0, y, x1 - x0, 1);
    }
  }

  const wantsJpeg = sourceMime === 'image/jpeg' || sourceMime === 'image/webp';
  const mimeType = wantsJpeg ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not render the cleaned image.'))),
      mimeType,
      0.92,
    );
  });
  return { blob, mimeType };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
