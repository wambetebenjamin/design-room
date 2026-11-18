// OCR pipeline: runs Tesseract.js inside the user's browser (worker, wasm and
// language data load from jsDelivr — nothing is sent to any server), then
// estimates per-line style from the original pixels.

import Tesseract from 'tesseract.js';
import type { Worker as OcrWorker, Block } from 'tesseract.js';
import { estimateInkStyle, guessFontFamily, fitFontSize, scaleBbox, clampBbox, type Rect } from './styleEst';
import { cssFont } from '../domain/textLayout';
import { nearestWeight } from '../domain/templates';

export interface TextRegion {
  id: string;
  text: string;
  /** Bounding box in ORIGINAL image pixels. */
  bbox: Rect;
  confidence: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  bgColor: string;
  density: number;
}

export interface OcrProgress {
  phase: 'engine' | 'scan';
  progress: number; // 0..1
  label: string;
}

export type OcrProgressFn = (p: OcrProgress) => void;

/** Images wider than this are downscaled for scanning (speed), then scaled back. */
export const OCR_MAX_DIM = 2200;
export const MIN_LINE_CONFIDENCE = 35;

let workerPromise: Promise<OcrWorker> | null = null;

/** Drop a broken worker so the next call starts fresh (used by Retry). */
export function resetOcrWorker(): void {
  workerPromise = null;
}

async function getWorker(onProgress: OcrProgressFn): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        const status = m.status ?? '';
        const progress = typeof m.progress === 'number' ? m.progress : 0;
        if (status.includes('recognizing')) {
          onProgress({ phase: 'scan', progress, label: 'Scanning text…' });
        } else if (status.includes('language')) {
          onProgress({ phase: 'engine', progress, label: 'Loading language data…' });
        } else if (status.includes('core') || status.includes('tesseract')) {
          onProgress({ phase: 'engine', progress, label: 'Loading OCR engine…' });
        } else if (status.includes('initializ')) {
          onProgress({ phase: 'engine', progress, label: 'Starting engine…' });
        } else {
          onProgress({ phase: 'engine', progress, label: 'Preparing…' });
        }
      },
      errorHandler: (err: unknown) => {
        console.error('OCR worker error', err);
      },
    });
    // Allow a failed load (offline / CDN blocked) to be retried cleanly.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

function collectLines(blocks: Block[] | null): { text: string; bbox: Rect; confidence: number }[] {
  if (!blocks) return [];
  const out: { text: string; bbox: Rect; confidence: number }[] = [];
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const text = (line.text ?? '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if ((line.confidence ?? 0) < MIN_LINE_CONFIDENCE) continue;
        out.push({ text, bbox: line.bbox, confidence: Math.round(line.confidence ?? 0) });
      }
    }
  }
  return out;
}

function drawScaled(img: HTMLImageElement, maxDim: number): { canvas: HTMLCanvasElement; scale: number } {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const factor = Math.min(1, maxDim / Math.max(nw, nh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(nw * factor));
  canvas.height = Math.max(1, Math.round(nh * factor));
  const ctx = canvas.getContext('2d')!;
  // Flatten transparency — OCR engines read alpha poorly.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, scale: nw / canvas.width };
}

/**
 * Scan an image for text and return positioned, style-estimated regions
 * in original-image coordinates.
 */
export async function extractTextRegions(img: HTMLImageElement, onProgress: OcrProgressFn): Promise<TextRegion[]> {
  const { canvas, scale } = drawScaled(img, OCR_MAX_DIM);
  const worker = await getWorker(onProgress);
  onProgress({ phase: 'scan', progress: 0, label: 'Scanning text…' });

  const result = await worker.recognize(canvas, {}, { blocks: true });
  const lines = collectLines(result.data.blocks);
  if (lines.length === 0) return [];

  // Sample original-resolution pixels for colour/weight estimation.
  const full = document.createElement('canvas');
  full.width = img.naturalWidth;
  full.height = img.naturalHeight;
  const fctx = full.getContext('2d', { willReadFrequently: true })!;
  fctx.drawImage(img, 0, 0);

  const measureCtx = document.createElement('canvas').getContext('2d')!;
  const regions: TextRegion[] = [];
  let idx = 0;

  for (const line of lines) {
    const bbox = clampBbox(scaleBbox(line.bbox, scale), img.naturalWidth, img.naturalHeight);
    const w = bbox.x1 - bbox.x0;
    const h = bbox.y1 - bbox.y0;
    if (w < 8 || h < 8) continue;

    // --- sample pixels ---
    let style = { color: '#111111', bgColor: '#ffffff', density: 0.2, dark: true };
    try {
      const px = fctx.getImageData(
        Math.floor(bbox.x0),
        Math.floor(bbox.y0),
        Math.max(1, Math.ceil(w)),
        Math.max(1, Math.ceil(h)),
      );
      style = estimateInkStyle(px.data, px.width, px.height);
    } catch {
      /* keep defaults on read failure */
    }

    const fontFamily = guessFontFamily(line.text, w, h, style.density);
    const rawWeight = style.density > 0.3 ? 700 : 400;
    const fontWeight = nearestWeight(fontFamily, rawWeight);

    // Fit size horizontally (width match is far more reliable than height).
    const probe = (size: number) => {
      measureCtx.font = cssFont({ fontFamily, fontSize: size, fontWeight });
      return measureCtx.measureText(line.text).width;
    };
    const fontSize = fitFontSize(probe, Math.max(8, w * 0.98), 6, Math.min(600, Math.max(24, h * 3)));

    regions.push({
      id: `ocr_${idx++}`,
      text: line.text,
      bbox,
      confidence: line.confidence,
      fontSize,
      fontFamily,
      fontWeight,
      color: style.color,
      bgColor: style.bgColor,
      density: style.density,
    });
  }

  onProgress({ phase: 'scan', progress: 1, label: 'Scan complete' });
  return regions;
}
