// Precompute the editable extraction for the bundled example banner
// (Keemsy Consulting roll-up, 656×1568), so the app can open it in the canvas
// as editable text layers + photo slots with zero runtime scanning.
//
// Pipeline:
//   1. OCR the original JPEG (tesseract.js in Node; local traineddata from
//      @tesseract.js-data/eng) — plus a targeted second pass over the huge
//      headline band that the full-page pass misses.
//   2. Cluster words into single-line runs and split them at column gaps
//      (the banner has a 3-column block + split footer).
//   3. Curate: drop top-edge junk, the stylised logo band, photo-interior
//      text, divider glyphs; fix known low-confidence strings by hand.
//   4. Style each run: ink/background colours from real pixels; font family +
//      weight + size chosen by metric matching (fit width, then compare
//      rendered cap-height to the OCR box) across our bundled font list.
//   5. Detect photo regions (same heuristics as the in-app detector).
//   6. Paint the kept text out of the base image (per-row horizontal gradient
//      sampled just outside each box — same algorithm as applyExtraction).
//   7. Emit: public/samples/keemsy-banner.jpeg (original, for undo),
//      public/samples/keemsy-banner-clean.jpeg (erased base),
//      src/samples/keemsyBannerData.ts (text lines + photo rects).
//
// Run: npx esbuild scripts/precomputeKeemsy.ts --bundle --platform=node \
//        --format=cjs --packages=external --outfile=/tmp/precompute.cjs \
//     && node /tmp/precompute.cjs

import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import opentype from 'opentype.js';
import Tesseract from 'tesseract.js';

import { estimateInkStyle, guessFontFamily, fitFontSize, type Rect } from '../src/ocr/styleEst';
import { FONTS, nearestWeight } from '../src/domain/templates';
import type { TextRegion } from '../src/ocr/extractText';

const ROOT = process.cwd();
const OUT_SAMPLES = path.join(ROOT, 'public', 'samples');
// The original lives in the repo (committed); the script (re)writes the clean
// copy beside it, so re-runs are idempotent.
const SRC_JPEG = path.join(OUT_SAMPLES, 'keemsy-banner.jpeg');
const OUT_DATA = path.join(ROOT, 'src', 'samples', 'keemsyBannerData.ts');

const W = 656;
const H = 1568;

// Headline band the full-page pass misses (BUSINESS / HARD TO MISS).
const HEAD_BAND = { y0: 700, y1: 935, scale: 1.6 };

interface Word {
  t: string;
  c: number;
  b: Rect;
}

interface Run {
  text: string;
  conf: number;
  box: Rect;
  words: Word[];
}

/** Text overrides for known low-confidence runs (curated against the image). */
const TEXT_OVERRIDES: { test: (t: string) => boolean; replace: string }[] = [
  { test: (t) => /^3?\s*MAKE\s*GOOD$/i.test(t), replace: 'MAKE GOOD' },
  { test: (t) => /^LET[’'`]?\s*'?SBUILD$/.test(t.replace(/\s+/g, '')) || /LET.*BUILD/.test(t), replace: 'LET’S BUILD' },
  { test: (t) => /www\s*keemsy\s*consult\s*com/i.test(t.replace(/[.\s]/g, 'x')), replace: 'www.keemsyconsult.com' },
  { test: (t) => /rotccrconsitcam|info.*keemsy/i.test(t), replace: 'info@keemsyconsult.com' },
];

/** Runs allowed to survive despite low OCR confidence (curated). */
const LOW_CONF_ALLOW = new Set(['www.keemsyconsult.com', 'info@keemsyconsult.com', 'LET’S BUILD']);

/** Candidate fonts for this poster (sans + display only — no serif/handwriting here). */
const CANDIDATES: { family: string; weights: number[] }[] = FONTS.filter((f) =>
  ['Sans', 'Display'].includes(f.category),
).map((f) => ({ family: f.family, weights: f.weights }));

const fontCache = new Map<string, opentype.Font | null>();

function fontFile(family: string, weight: number): string {
  const slug = family.toLowerCase().replace(/\s+/g, '-');
  const dir = path.join(ROOT, 'node_modules', '@fontsource', slug, 'files');
  const re = new RegExp(`^${slug}-latin-(\\d+)-normal\\.woff$`);
  const weights = fs.readdirSync(dir)
    .map((m) => re.exec(m))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => parseInt(m[1], 10));
  if (weights.length === 0) throw new Error(`No latin woff files for ${family}`);
  const picked = weights.reduce((best, w) =>
    Math.abs(w - weight) < Math.abs(best - weight) ? w : best, weights[0]);
  return path.join(dir, `${slug}-latin-${picked}-normal.woff`);
}

function loadFont(family: string, weight: number): opentype.Font | null {
  const key = `${family}@${weight}`;
  if (fontCache.has(key)) return fontCache.get(key) ?? null;
  let font: opentype.Font | null = null;
  try {
    // opentype.js v1.3: loadSync is deprecated; parse the buffer directly.
    font = opentype.parse(fs.readFileSync(fontFile(family, weight)) as unknown as ArrayBuffer) as opentype.Font;
  } catch {
    font = null;
  }
  fontCache.set(key, font);
  return font;
}

/**
 * Advance width without OpenType shaping: sum raw glyph advances.
 * (getAdvanceWidth()/getPath() run GSUB ccmp, which throws on some
 * fontsource subsets — cmap+advance is plenty for width fitting.)
 */
function advanceWidth(font: opentype.Font, text: string, size: number): number {
  let total = 0;
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    total += g.advanceWidth ?? Math.round(font.unitsPerEm * 0.55);
  }
  return (total * size) / font.unitsPerEm;
}

/** Cap-height ratio: OS/2 sCapHeight when present, else measured from 'H'. */
const capCache = new Map<string, number>();
function capRatio(font: opentype.Font): number {
  const key = `${font.names.fontFamily?.en}@${font.unitsPerEm}`;
  if (capCache.has(key)) return capCache.get(key)!;
  let ratio = 0;
  const os2 = (font as unknown as { tables: { os2?: { sCapHeight?: number } } }).tables.os2;
  if (os2?.sCapHeight && os2.sCapHeight > 0) {
    ratio = os2.sCapHeight / font.unitsPerEm;
  } else {
    const bb = font.charToGlyph('H').getPath(0, 100, 100).getBoundingBox();
    const measured = (100 - bb.y1) / 100;
    // y-down canvas space: measured is ~0.5..0.9; if the sign came out wrong
    // the value falls outside and we fall back to a sane default.
    ratio = measured >= 0.45 && measured <= 0.95 ? measured : 0.7;
  }
  const clamped = Math.max(0.5, Math.min(0.85, ratio));
  capCache.set(key, clamped);
  return clamped;
}

function clusterRuns(words: Word[]): Run[] {
  // Icon fragments read as 1–2 character low-confidence tokens ("RQ" for the
  // phone glyph, "|" dividers) drag a whole real line below the confidence
  // floor — drop them before runs are formed.
  const cleaned = words.filter((w) => !(w.c < 40 && w.t.replace(/[^A-Za-z0-9]/g, '').length <= 2));
  const sorted = [...cleaned].sort((a, b) => a.b.y0 - b.b.y0 || a.b.x0 - b.b.x0);
  const rows: Word[][] = [];
  for (const w of sorted) {
    const row = rows.find((r) => Math.abs(r[0].b.y0 - w.b.y0) <= 8);
    if (row) row.push(w);
    else rows.push([w]);
  }
  const runs: Run[] = [];
  for (const row of rows) {
    const inRow = [...row].sort((a, b) => a.b.x0 - b.b.x0);
    let cur: Word[] = [];
    for (const w of inRow) {
      if (cur.length === 0) { cur = [w]; continue; }
      const gap = w.b.x0 - Math.max(...cur.map((c) => c.b.x1));
      if (gap > 30) {
        runs.push(mkRun(cur));
        cur = [w];
      } else cur.push(w);
    }
    if (cur.length) runs.push(mkRun(cur));
  }
  return runs;
}

function mkRun(words: Word[]): Run {
  const box: Rect = {
    x0: Math.min(...words.map((w) => w.b.x0)),
    y0: Math.min(...words.map((w) => w.b.y0)),
    x1: Math.max(...words.map((w) => w.b.x1)),
    y1: Math.max(...words.map((w) => w.b.y1)),
  };
  return {
    text: words.map((w) => w.t).join(' ').replace(/\s+/g, ' ').trim(),
    conf: Math.min(...words.map((w) => w.c)),
    box,
    words,
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function applyTextOverride(text: string): string {
  for (const o of TEXT_OVERRIDES) if (o.test(text)) return o.replace;
  return text;
}

function cropRgba(data: Uint8Array, box: Rect): { px: Uint8ClampedArray; w: number; h: number } {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const w = Math.max(1, Math.min(W, Math.ceil(box.x1)) - x0);
  const h = Math.max(1, Math.min(H, Math.ceil(box.y1)) - y0);
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * W + (x0 + x)) * 4;
      const d = (y * w + x) * 4;
      px[d] = data[s]; px[d + 1] = data[s + 1]; px[d + 2] = data[s + 2]; px[d + 3] = 255;
    }
  }
  return { px, w, h };
}

/**
 * Curated font per style group — matched against the printed banner — then
 * width-fitted (width is the reliable signal; cap height follows).
 * The originals are proprietary faces; these are the closest open-licensed
 * matches from our bundled library.
 */
function pickFont(
  text: string,
  box: Rect,
  density: number,
): { family: string; fontWeight: number; fontSize: number } {
  const t = text;
  let family: string;
  let weight: number;
  if (t === 'MAKE GOOD' || t === 'BUSINESS' || t === 'HARD TO MISS') {
    family = 'Space Grotesk'; weight = 700;       // closest metrics to the display face
  } else if (t === '360° GROWTH PARTNER') {
    family = 'Montserrat'; weight = 700;          // exact metric match for the pill
  } else if (t.startsWith('We Build Systems') || t.startsWith('for Businesses')) {
    family = 'Lato'; weight = 400;                // humanist book line
  } else if (t === 'AGENCY' || t === 'SHOP' || t === 'APP') {
    family = 'Space Grotesk'; weight = 700;       // column heads, same display face
  } else if (t === 'Digital & Strategy' || t === 'Print & Branding' || t === 'Local Commerce') {
    family = 'Inter'; weight = 600;               // semibold labels
  } else if (t === 'LET’S BUILD' || t === 'GROWTH') {
    family = 'Space Grotesk'; weight = 700;       // footer headline
  } else if (t === 'www.keemsyconsult.com' || t === 'info@keemsyconsult.com') {
    family = 'Inter'; weight = 400;               // footer contacts
  } else if (t.startsWith('Phone:')) {
    family = 'Inter'; weight = 600;
  } else {
    family = 'Inter'; weight = 400;               // body copy
  }

  const font = loadFont(family, weight);
  const probe = (size: number) =>
    font ? advanceWidth(font, t, size) : t.length * size * 0.55;
  const boxH = box.y1 - box.y0;
  const fontSize = fitFontSize(
    probe,
    Math.max(8, (box.x1 - box.x0) * 0.98),
    6,
    Math.min(600, Math.max(24, boxH * 3)),
  );
  return { family, fontWeight: nearestWeight(family, weight), fontSize };
}

/** Same per-row horizontal-gradient paint-out as applyExtraction.paintOutRegions. */
function paintOut(
  src: Uint8Array,
  regions: { box: Rect; bgColor: string }[],
): Uint8Array {
  const out = Uint8Array.from(src);
  const MARGIN = 8;
  const pad = 3;
  const hex = (h: string): [number, number, number] => {
    const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const sample = (x: number, y: number): [number, number, number] => {
    const cx = Math.max(0, Math.min(W - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(H - 1, Math.round(y)));
    const o = (cy * W + cx) * 4;
    return [out[o], out[o + 1], out[o + 2]];
  };
  const sorted = [...regions].sort(
    (a, b) => (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0) - (a.box.x1 - a.box.x0) * (a.box.y1 - a.box.y0),
  );
  for (const region of sorted) {
    const x0 = Math.max(0, Math.floor(region.box.x0) - pad);
    const y0 = Math.max(0, Math.floor(region.box.y0) - pad);
    const x1 = Math.min(W, Math.ceil(region.box.x1) + pad);
    const y1 = Math.min(H, Math.ceil(region.box.y1) + pad);
    if (x1 <= x0 || y1 <= y0) continue;
    const hasLeft = x0 - MARGIN >= 0;
    const hasRight = x1 + MARGIN < W;
    const fallback = hex(region.bgColor);
    for (let y = y0; y < y1; y++) {
      let left = hasLeft ? sample(x0 - MARGIN, y) : fallback;
      let right = hasRight ? sample(x1 + MARGIN, y) : hasLeft ? left : fallback;
      for (let x = x0; x < x1; x++) {
        const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
        const o = (y * W + x) * 4;
        out[o] = Math.round(left[0] + (right[0] - left[0]) * t);
        out[o + 1] = Math.round(left[1] + (right[1] - left[1]) * t);
        out[o + 2] = Math.round(left[2] + (right[2] - left[2]) * t);
      }
    }
  }
  return out;
}

async function collectWords(worker: any, input: string | Buffer): Promise<Word[]> {
  const r = await worker.recognize(input, {}, { blocks: true });
  const words: Word[] = [];
  for (const b of r.data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const wd of l.words ?? []) {
          const t = (wd.text ?? '').trim();
          if (!t) continue;
          words.push({ t, c: Math.round(wd.confidence ?? 0), b: { ...wd.bbox } });
        }
      }
    }
  }
  return words;
}

async function main(): Promise<void> {
  if (!fs.existsSync(SRC_JPEG)) {
    throw new Error(`Missing source image: ${SRC_JPEG}`);
  }
  const raw = fs.readFileSync(SRC_JPEG);
  const img = jpeg.decode(raw, { useTArray: true });
  if (img.width !== W || img.height !== H) {
    throw new Error(`Expected ${W}×${H}, got ${img.width}×${img.height}`);
  }

  // --- OCR: full page + headline band ---------------------------------------
  const langPath = path.join(ROOT, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0');
  const workerPath = path.join(ROOT, 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js');
  const corePath = path.join(ROOT, 'node_modules', 'tesseract.js-core');
  const worker = await (Tesseract as any).createWorker('eng', 1, {
    langPath, workerPath, corePath, gzip: true, logger: () => {},
  });

  const fullWords = await collectWords(worker, SRC_JPEG);

  // Headline band crop, upscaled (the giant lines vanish on the full-page pass).
  const { y0: hy0, y1: hy1, scale: hs } = HEAD_BAND;
  const cw = W;
  const ch = hy1 - hy0;
  const Wc = Math.round(cw * hs);
  const Hc = Math.round(ch * hs);
  const scaled = Buffer.alloc(Wc * Hc * 4);
  for (let y = 0; y < Hc; y++) {
    for (let x = 0; x < Wc; x++) {
      const sx = Math.min(cw - 1, Math.round(x / hs));
      const sy = Math.min(ch - 1, Math.round(y / hs));
      const s = ((hy0 + sy) * W + sx) * 4;
      const d = (y * Wc + x) * 4;
      scaled[d] = img.data[s]; scaled[d + 1] = img.data[s + 1]; scaled[d + 2] = img.data[s + 2]; scaled[d + 3] = 255;
    }
  }
  const bandJpg = jpeg.encode({ data: scaled, width: Wc, height: Hc }, 95).data;
  const bandWords = (await collectWords(worker, bandJpg)).map((w) => ({
    t: w.t,
    c: w.c,
    b: {
      x0: Math.round(w.b.x0 / hs),
      y0: Math.round(w.b.y0 / hs) + hy0,
      x1: Math.round(w.b.x1 / hs),
      y1: Math.round(w.b.y1 / hs) + hy0,
    },
  }));
  await worker.terminate();

  const words = [
    ...fullWords.filter((w) => w.b.y0 < hy0 || w.b.y1 > hy1),
    ...bandWords,
  ];
  console.log(`OCR words: full=${fullWords.length} band=${bandWords.length}`);

  // --- Curate runs -----------------------------------------------------------
  const dropped: { text: string; why: string }[] = [];
  let runs = clusterRuns(words);
  const before = runs.length;

  const keep: Run[] = [];
  for (const run of runs) {
    const finalText = applyTextOverride(run.text);
    if (run.box.y1 <= 40) { dropped.push({ text: run.text, why: 'top edge junk' }); continue; }
    if (run.box.y0 < 150 && run.box.x0 < 400) { dropped.push({ text: run.text, why: 'logo band' }); continue; }
    if (finalText === '|' || finalText.length < 2) { dropped.push({ text: run.text, why: 'glyph junk' }); continue; }
    if (run.conf < 50 && !LOW_CONF_ALLOW.has(finalText)) {
      dropped.push({ text: run.text, why: `low confidence (${run.conf})` });
      continue;
    }
    keep.push({ ...run, text: finalText });
  }
  console.log(`Runs: ${before} → kept ${keep.length}, dropped ${dropped.length}`);

  // --- Photos: chroma-aware, restricted to the printed fabric ----------------
// The image is an office mockup: plant / window / floor around the roll-up,
// plus soft shadow banding across the print. The replaceable photo slots are
// therefore measured inside a curated zone covering the banner's two circular
// photos, using fine-grained luma-range cells (photos are textured; shadows
// and flat fills are not) with 8-connected components.
const PHOTO_ZONE: Rect = { x0: 66, y0: 140, x1: 620, y1: 716 };

function detectFabricPhotos(data: Uint8Array): Rect[] {
  const cell = 8;
  const cols = Math.ceil((PHOTO_ZONE.x1 - PHOTO_ZONE.x0) / cell);
  const rows = Math.ceil((PHOTO_ZONE.y1 - PHOTO_ZONE.y0) / cell);
  const stats: boolean[] = new Array(cols * rows).fill(false);

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = PHOTO_ZONE.x0 + tx * cell;
      const y0 = PHOTO_ZONE.y0 + ty * cell;
      const x1 = Math.min(W, x0 + cell);
      const y1 = Math.min(H, y0 + cell);
      let mn = 255;
      let mx = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * W + x) * 4;
          const luma = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
          if (luma < mn) mn = luma;
          if (luma > mx) mx = luma;
        }
      }
      stats[ty * cols + tx] = mx - mn >= 48;
    }
  }

  const seen = new Array(cols * rows).fill(false);
  const regions: Rect[] = [];
  const minCells = Math.max(4, Math.ceil((0.02 * W * H) / (cell * cell)));
  for (let i = 0; i < stats.length; i++) {
    if (seen[i] || !stats[i]) continue;
    const queue = [i];
    seen[i] = true;
    let minX = cols, minY = rows, maxX = -1, maxY = -1, count = 0;
    while (queue.length) {
      const cur = queue.pop()!;
      const cxx = cur % cols;
      const cyy = Math.floor(cur / cols);
      count++;
      minX = Math.min(minX, cxx); minY = Math.min(minY, cyy);
      maxX = Math.max(maxX, cxx); maxY = Math.max(maxY, cyy);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = cxx + dx;
          const ny = cyy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nb = ny * cols + nx;
          if (!seen[nb] && stats[nb]) { seen[nb] = true; queue.push(nb); }
        }
      }
    }
    if (count < minCells) continue;
    const rect: Rect = {
      x0: PHOTO_ZONE.x0 + minX * cell,
      y0: PHOTO_ZONE.y0 + minY * cell,
      x1: Math.min(W, PHOTO_ZONE.x0 + (maxX + 1) * cell),
      y1: Math.min(H, PHOTO_ZONE.y0 + (maxY + 1) * cell),
    };
    if (rect.x1 - rect.x0 < 48 || rect.y1 - rect.y0 < 48) continue;
    regions.push(rect);
  }
  regions.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
  return regions;
}

  let photos = detectFabricPhotos(img.data);
  // Drop runs sitting inside photos (text printed on the collateral).
  const afterPhoto: Run[] = [];
  for (const run of keep) {
    const ra = (run.box.x1 - run.box.x0) * (run.box.y1 - run.box.y0);
    const inPhoto = photos.some((p) => overlapArea(run.box, p) / Math.max(1, ra) >= 0.25);
    if (inPhoto) dropped.push({ text: run.text, why: 'inside photo' });
    else afterPhoto.push(run);
  }
  console.log(`Photos: ${JSON.stringify(photos)}`);

  // --- Style every kept line -------------------------------------------------
  const lines: TextRegion[] = afterPhoto.map((run, i) => {
    const { px, w, h } = cropRgba(img.data, run.box);
    const ink = estimateInkStyle(px, w, h);
    const font = pickFont(run.text, run.box, ink.density);
    return {
      id: `b_${i}`,
      text: run.text,
      bbox: run.box,
      confidence: run.conf,
      fontSize: font.fontSize,
      fontFamily: font.family,
      fontWeight: font.fontWeight,
      color: ink.color,
      bgColor: ink.bgColor,
      density: ink.density,
    };
  });

  for (const l of lines) {
    console.log(
      `  KEEP "${l.text}" @ ${Math.round(l.bbox.x0)},${Math.round(l.bbox.y0)} ` +
      `${Math.round(l.bbox.x1 - l.bbox.x0)}×${Math.round(l.bbox.y1 - l.bbox.y0)} → ` +
      `${l.fontFamily} ${l.fontWeight} ${l.fontSize}px ${l.color} (bg ${l.bgColor}, conf ${l.confidence})`,
    );
  }
  for (const d of dropped) console.log(`  DROP "${d.text}" — ${d.why}`);

  // --- Paint out + write artifacts ------------------------------------------
  const clean = paintOut(
    img.data,
    lines.map((l) => ({ box: l.bbox, bgColor: l.bgColor })),
  );

  fs.mkdirSync(OUT_SAMPLES, { recursive: true });
  fs.writeFileSync(path.join(OUT_SAMPLES, 'keemsy-banner.jpeg'), raw);
  fs.writeFileSync(
    path.join(OUT_SAMPLES, 'keemsy-banner-clean.jpeg'),
    jpeg.encode({ data: clean, width: W, height: H }, 92).data,
  );

  const dataTs = `// AUTO-GENERATED by scripts/precomputeKeemsy.ts — do not edit by hand.
// Precomputed extraction for the bundled example banner (Keemsy Consulting
// roll-up): every editable text line (in source-image pixels) and the
// detected photo slots. The clean base image has these text areas painted
// out so the editable layers can sit exactly on top — one Ctrl+Z restores
// the untouched original artwork.
import type { Rect } from '../ocr/styleEst';
import type { TextRegion } from '../ocr/extractText';

export interface BannerAssets {
  width: number;
  height: number;
  original: string;
  clean: string;
}

export const BANNER: BannerAssets = {
  width: ${W},
  height: ${H},
  original: 'samples/keemsy-banner.jpeg',
  clean: 'samples/keemsy-banner-clean.jpeg',
};

export const BANNER_LINES: TextRegion[] = ${JSON.stringify(lines, null, 2)};

export const BANNER_PHOTOS: Rect[] = ${JSON.stringify(photos, null, 2)};
`;
  fs.mkdirSync(path.dirname(OUT_DATA), { recursive: true });
  fs.writeFileSync(OUT_DATA, dataTs);
  console.log(`\nWrote ${OUT_SAMPLES}/keemsy-banner.jpeg, keemsy-banner-clean.jpeg and ${OUT_DATA}`);
  console.log(`${lines.length} text lines, ${photos.length} photo slots.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
