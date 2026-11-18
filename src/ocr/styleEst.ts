// Pure helpers that guess how extracted text should be re-styled so the new
// editable layers visually match the original poster: ink colour, weight,
// font family and size. All functions are deterministic and unit-testable.

export interface InkStyle {
  /** Estimated text colour (hex). */
  color: string;
  /** Estimated background colour behind the text (hex). */
  bgColor: string;
  /** Fraction of the box covered by ink (drives bold/regular). */
  density: number;
  /** True when the ink is darker than the background. */
  dark: boolean;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
}

export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Estimate ink vs background colours inside a region of RGBA pixel data.
 * Background = median of the 1px border ring; ink = pixels farthest from it.
 */
export function estimateInkStyle(pixels: Uint8ClampedArray, width: number, height: number): InkStyle {
  const total = width * height;
  if (total === 0 || pixels.length < total * 4) {
    return { color: '#000000', bgColor: '#ffffff', density: 0, dark: true };
  }

  // --- background: median of the border ring ---
  const ring: number[] = [];
  const push = (i: number) => {
    const o = i * 4;
    ring.push((pixels[o] << 16) | (pixels[o + 1] << 8) | pixels[o + 2]);
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  ring.sort((a, b) => a - b);
  const mid = ring[Math.floor(ring.length / 2)] ?? 0xffffff;
  const br = (mid >> 16) & 255;
  const bgc = (mid >> 8) & 255;
  const bb = mid & 255;

  // --- distances from background ---
  const dists: number[] = new Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    dists[i] =
      Math.abs(pixels[o] - br) + Math.abs(pixels[o + 1] - bgc) + Math.abs(pixels[o + 2] - bb);
  }
  const sorted = [...dists].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const maxD = sorted[sorted.length - 1] ?? 0;

  if (maxD < 45) {
    // Essentially uniform region — no distinct ink.
    return { color: toHex(br, bgc, bb), bgColor: toHex(br, bgc, bb), density: 0, dark: luminance(br, bgc, bb) < 0.5 };
  }

  // One adaptive cutoff serves both the ink colour and the density:
  // above background noise, but capped so heavy coverage still counts.
  const inkCutoff = Math.max(40, Math.min(p90 * 1.1, maxD * 0.55));

  let sr = 0;
  let sg = 0;
  let sb = 0;
  let inkCount = 0;
  for (let i = 0; i < total; i++) {
    if (dists[i] >= inkCutoff) {
      const o = i * 4;
      sr += pixels[o];
      sg += pixels[o + 1];
      sb += pixels[o + 2];
      inkCount++;
    }
  }

  let fr: number;
  let fg: number;
  let fb: number;
  if (inkCount === 0) {
    fr = br;
    fg = bgc;
    fb = bb;
  } else {
    fr = sr / inkCount;
    fg = sg / inkCount;
    fb = sb / inkCount;
  }

  const density = inkCount / total;
  const dark = luminance(fr, fg, fb) < luminance(br, bgc, bb);
  return {
    color: toHex(fr, fg, fb),
    bgColor: toHex(br, bgc, bb),
    density: Math.round(density * 1000) / 1000,
    dark,
  };
}

/**
 * Best-match bundled font family for an extracted line.
 * Heuristics: case pattern, average advance width vs line height, ink density.
 */
export function guessFontFamily(text: string, boxW: number, boxH: number, density: number): string {
  const letters = text.replace(/[^A-Za-z]/g, '');
  const hasLower = /[a-z]/.test(text);
  const allCaps = letters.length > 2 && !hasLower && /[A-Z]/.test(letters);
  const chars = Math.max(1, text.trim().length);
  const advance = boxW / chars;
  const ratio = advance / Math.max(1, boxH);

  if (allCaps) {
    if (ratio < 0.36) return 'Bebas Neue';
    if (ratio < 0.5) return 'Oswald';
    if (density > 0.3) return 'Anton';
    return 'Archivo Black';
  }
  if (letters.length === 0) return 'Inter'; // digits / symbols only
  if (density > 0.34) return 'Montserrat';
  if (ratio > 0.62 && density < 0.22) return 'Lora';
  return 'Inter';
}

/**
 * Fit a font size (px) so `probe(size)` measures close to `targetW`.
 * Binary search around a linear first guess — monotonic probe required.
 */
export function fitFontSize(
  probe: (size: number) => number,
  targetW: number,
  lo = 6,
  hi = 800,
): number {
  if (!(targetW > 0)) return 16;
  const w100 = probe(100);
  if (!(w100 > 0)) return 16;
  const guess = (100 * targetW) / w100;
  let a = Math.max(lo, Math.min(guess * 0.4, hi));
  let b = Math.min(hi, Math.max(guess * 1.6, lo + 1));
  for (let i = 0; i < 26; i++) {
    const mid = (a + b) / 2;
    const w = probe(mid);
    if (w < targetW) a = mid;
    else b = mid;
  }
  const size = (a + b) / 2;
  return Math.max(lo, Math.min(hi, Math.round(size)));
}

/** Scale an OCR bbox from the (possibly downscaled) scan back to source coords. */
export function scaleBbox(bbox: Rect, scale: number): Rect {
  return {
    x0: bbox.x0 * scale,
    y0: bbox.y0 * scale,
    x1: bbox.x1 * scale,
    y1: bbox.y1 * scale,
  };
}

export function clampBbox(bbox: Rect, w: number, h: number): Rect {
  return {
    x0: Math.max(0, Math.min(w, bbox.x0)),
    y0: Math.max(0, Math.min(h, bbox.y0)),
    x1: Math.max(0, Math.min(w, bbox.x1)),
    y1: Math.max(0, Math.min(h, bbox.y1)),
  };
}
