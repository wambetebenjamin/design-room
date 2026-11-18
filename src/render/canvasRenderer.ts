// Canvas2D renderer for a page. Used for PNG/JPEG/ZIP export and must stay in
// parity with the DOM rendering in components/ElementView.tsx.

import type { Background, DesignDoc, DesignElement, Page } from '../domain/types';
import { isGradient } from '../domain/document';
import { cssFont, makeMeasure, wrapText, lineHeightPx } from '../domain/textLayout';
import { fitCropToFrame } from '../domain/crop';
import { getImageSync } from './imageCache';

export function applyBackground(ctx: CanvasRenderingContext2D, bg: Background, w: number, h: number): void {
  if (isGradient(bg)) {
    const rad = ((bg.angle - 90) * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;
    const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const x0 = cx - (Math.cos(rad) * len) / 2;
    const y0 = cy - (Math.sin(rad) * len) / 2;
    const x1 = cx + (Math.cos(rad) * len) / 2;
    const y1 = cy + (Math.sin(rad) * len) / 2;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = bg;
  }
  ctx.fillRect(0, 0, w, h);
}

function roundRectPath(ctx: CanvasRenderingContext2D, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(w - radius, 0);
  ctx.quadraticCurveTo(w, 0, w, radius);
  ctx.lineTo(w, h - radius);
  ctx.quadraticCurveTo(w, h, w - radius, h);
  ctx.lineTo(radius, h);
  ctx.quadraticCurveTo(0, h, 0, h - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
}

function drawShape(ctx: CanvasRenderingContext2D, el: DesignElement, style: { shape: string; fill: string; radius: number }): void {
  const { width: w, height: h } = el;
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.fill;
  switch (style.shape) {
    case 'rect':
      roundRectPath(ctx, w, h, style.radius);
      ctx.fill();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star': {
      const spikes = 5;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.45;
      const cx = w / 2;
      const cy = h / 2;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const ang = (Math.PI / spikes) * i - Math.PI / 2;
        const x = cx + Math.cos(ang) * r * (w / Math.min(w, h));
        const y = cy + Math.sin(ang) * r * (h / Math.min(w, h));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'line':
      ctx.lineWidth = Math.max(1, h);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      break;
  }
}

function drawText(ctx: CanvasRenderingContext2D, el: DesignElement): void {
  const content = el.content as { text: string };
  const style = el.style as {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    color: string;
    align: 'left' | 'center' | 'right';
    lineHeight: number;
    letterSpacing: number;
    italic: boolean;
  };
  const font = {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    italic: style.italic,
  };
  const measure = makeMeasure(font);
  const lines = wrapText(content.text, el.width, measure);
  const lh = lineHeightPx(style);
  ctx.fillStyle = style.color;
  ctx.font = cssFont(font);
  ctx.textBaseline = 'top';

  const tracking = style.letterSpacing || 0;
  lines.forEach((line, i) => {
    // Half-leading offset so canvas text sits where the DOM line box puts it.
    const y = i * lh + (lh - style.fontSize) / 2;
    let x = 0;
    const lineWidth = measure(line) + Math.max(0, line.length - 1) * tracking;
    if (style.align === 'center') x = (el.width - lineWidth) / 2;
    else if (style.align === 'right') x = el.width - lineWidth;
    if (tracking === 0) {
      ctx.fillText(line, x, y);
    } else {
      let cx = x;
      for (const ch of line) {
        ctx.fillText(ch, cx, y);
        cx += measure(ch) + tracking;
      }
    }
  });
}

function drawImageEl(ctx: CanvasRenderingContext2D, el: DesignElement): void {
  const content = el.content as { assetId: string; crop: { ox: number; oy: number; s: number } | null };
  const style = el.style as { radius: number };
  const img = getImageSync(content.assetId);
  if (!img) {
    // Missing asset placeholder (kept visually obvious, never silently blank).
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.fillStyle = '#718096';
    ctx.font = `500 ${Math.max(12, Math.round(el.height * 0.12))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Image unavailable', el.width / 2, el.height / 2);
    ctx.textAlign = 'left';
    return;
  }
  const crop = fitCropToFrame(
    content.crop,
    img.naturalWidth,
    img.naturalHeight,
    el.width,
    el.height,
  );
  const iw = img.naturalWidth * crop.s;
  const ih = img.naturalHeight * crop.s;

  ctx.save();
  if (style.radius > 0) {
    roundRectPath(ctx, el.width, el.height, style.radius);
    ctx.clip();
  }
  ctx.drawImage(img, crop.ox, crop.oy, iw, ih);
  ctx.restore();
}

/** Draw one element at its own transform (caller has already set up page scale). */
export function drawElement(ctx: CanvasRenderingContext2D, el: DesignElement): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity));
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  ctx.translate(cx, cy);
  if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.width / 2, -el.height / 2);

  if (el.type === 'text') drawText(ctx, el);
  else if (el.type === 'shape') drawShape(ctx, el, el.style as { shape: string; fill: string; radius: number });
  else drawImageEl(ctx, el);

  ctx.restore();
}

/**
 * Render a full page to a canvas at the given scale.
 * Exported dimensions are exactly page.width * scale × page.height * scale.
 */
export function renderPageToCanvas(
  doc: DesignDoc,
  page: Page,
  scale: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = Math.max(1, Math.round(doc.design.width * scale));
  const h = Math.max(1, Math.round(doc.design.height * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is not supported in this browser.');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  applyBackground(ctx, page.background, doc.design.width, doc.design.height);
  const els = doc.elements
    .filter((e) => e.pageId === page.id)
    .sort((a, b) => a.order - b.order);
  for (const el of els) drawElement(ctx, el);
  return canvas;
}

/** Ensure all fonts used by the document are loaded before rasterising. */
export async function ensureFontsLoaded(doc: DesignDoc): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const families = new Set<string>();
  for (const el of doc.elements) {
    if (el.type === 'text') families.add((el.style as { fontFamily: string }).fontFamily);
  }
  try {
    await Promise.all(
      [...families].flatMap((f) => [
        document.fonts.load(`400 40px "${f}"`),
        document.fonts.load(`700 40px "${f}"`),
      ]),
    );
    await document.fonts.ready;
  } catch {
    // Fall back to whatever is available rather than failing the export.
  }
}
