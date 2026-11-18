// Unit tests for the pure text-extraction helpers: style estimation,
// font guessing, size fitting, bbox math and text-element construction.

import { describe, it, expect } from 'vitest';
import {
  estimateInkStyle,
  guessFontFamily,
  fitFontSize,
  scaleBbox,
  clampBbox,
  toHex,
  luminance,
} from './styleEst';
import { buildTextElements, buildImageSlots, type ReviewLine, type SlotGeometry } from './applyExtraction';
import type { TextRegion } from './extractText';

function makeImage(width: number, height: number, bg: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return data;
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number],
): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = 255;
    }
  }
}

describe('estimateInkStyle', () => {
  it('finds dark ink on a light background', () => {
    const w = 120;
    const h = 40;
    const data = makeImage(w, h, [255, 255, 255]);
    fillRect(data, w, 10, 8, 110, 32, [10, 10, 10]); // dark "text" block
    const style = estimateInkStyle(data, w, h);
    expect(style.bgColor).toBe('#ffffff');
    const rgb = parseInt(style.color.slice(1), 16);
    const r = (rgb >> 16) & 255;
    expect(r).toBeLessThan(60);
    expect(style.dark).toBe(true);
    expect(style.density).toBeGreaterThan(0.2);
    expect(style.density).toBeLessThan(0.9);
  });

  it('finds light ink on a dark background', () => {
    const w = 100;
    const h = 30;
    const data = makeImage(w, h, [5, 15, 30]);
    fillRect(data, w, 8, 6, 92, 24, [245, 245, 245]);
    const style = estimateInkStyle(data, w, h);
    expect(style.dark).toBe(false);
    const rgb = parseInt(style.color.slice(1), 16);
    const r = (rgb >> 16) & 255;
    expect(r).toBeGreaterThan(200);
    expect(style.bgColor).toBe('#050f1e');
  });

  it('reports near-zero density on a uniform region', () => {
    const w = 40;
    const h = 40;
    const data = makeImage(w, h, [200, 200, 200]);
    const style = estimateInkStyle(data, w, h);
    expect(style.density).toBeLessThan(0.05);
    expect(style.color).toBe(style.bgColor);
  });
});

describe('guessFontFamily', () => {
  it('picks condensed display for narrow all-caps', () => {
    expect(guessFontFamily('SUMMER SALE', 200, 60, 0.25)).toBe('Bebas Neue');
  });

  it('picks Oswald for medium-width all-caps', () => {
    expect(guessFontFamily('OPEN TODAY', 280, 60, 0.25)).toBe('Oswald');
  });

  it('picks a heavy face for wide bold all-caps', () => {
    expect(guessFontFamily('GRAND OPENING', 700, 70, 0.4)).toBe('Anton');
  });

  it('defaults to Inter for normal mixed-case body text', () => {
    expect(guessFontFamily('Fresh baked daily', 400, 40, 0.2)).toBe('Inter');
  });

  it('picks Montserrat for dense heavy mixed-case text', () => {
    expect(guessFontFamily('Big News!', 360, 64, 0.4)).toBe('Montserrat');
  });

  it('falls back to Inter for digits only', () => {
    expect(guessFontFamily('50% 2026', 150, 40, 0.2)).toBe('Inter');
  });
});

describe('fitFontSize', () => {
  it('solves linearly-growing probe widths', () => {
    // width = size * 0.5 → target 100 needs size 200
    expect(fitFontSize((size) => size * 0.5, 100)).toBe(200);
  });

  it('respects the upper bound', () => {
    expect(fitFontSize((size) => size * 0.1, 100_000, 6, 320)).toBe(320);
  });

  it('returns a sane default for degenerate input', () => {
    expect(fitFontSize(() => 0, 100)).toBe(16);
    expect(fitFontSize((s) => s, 0)).toBe(16);
  });
});

describe('bbox helpers', () => {
  it('scales boxes back to source coordinates', () => {
    expect(scaleBbox({ x0: 10, y0: 20, x1: 110, y1: 70 }, 2)).toEqual({ x0: 20, y0: 40, x1: 220, y1: 140 });
  });

  it('clamps to image bounds', () => {
    const c = clampBbox({ x0: -5, y0: -5, x1: 500, y1: 120 }, 200, 100);
    expect(c).toEqual({ x0: 0, y0: 0, x1: 200, y1: 100 });
  });
});

describe('toHex / luminance', () => {
  it('formats and orders brightness', () => {
    expect(toHex(255, 0, 128)).toBe('#ff0080');
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 5);
    expect(luminance(0, 0, 0)).toBe(0);
  });
});

function region(partial: Partial<TextRegion>): TextRegion {
  return {
    id: 'ocr_0',
    text: 'Hello',
    bbox: { x0: 100, y0: 200, x1: 300, y1: 250 },
    confidence: 90,
    fontSize: 40,
    fontFamily: 'Inter',
    fontWeight: 400,
    color: '#111111',
    bgColor: '#ffffff',
    density: 0.2,
    ...partial,
  };
}

describe('buildTextElements', () => {
  it('places text exactly over the detected box', () => {
    const line: ReviewLine = { region: region({}), include: true, text: 'Hello', fontFamily: 'Inter' };
    const [el] = buildTextElements([line], 'page_1', 7);
    expect(el.type).toBe('text');
    expect(el.pageId).toBe('page_1');
    expect(el.x).toBe(98); // x0 - 2
    expect(el.y).toBe(200);
    expect(el.width).toBe(208); // (x1 - x0) + 8 slack so it never wraps
    expect(el.order).toBe(7);
    expect(el.content).toEqual({ text: 'Hello' });
    const style = el.style as { fontSize: number; lineHeight: number; color: string; fontFamily: string };
    expect(style.fontFamily).toBe('Inter');
    expect(style.color).toBe('#111111');
    expect(style.fontSize).toBe(40);
    // line box height tracks the original glyph box
    expect(el.height).toBe(Math.round(40 * style.lineHeight));
    expect(40 * style.lineHeight).toBeCloseTo(50, 1);
  });

  it('skips excluded and empty lines', () => {
    const lines: ReviewLine[] = [
      { region: region({ id: 'a' }), include: false, text: 'Nope', fontFamily: 'Inter' },
      { region: region({ id: 'b' }), include: true, text: '   ', fontFamily: 'Inter' },
      { region: region({ id: 'c' }), include: true, text: 'Yes', fontFamily: 'Inter' },
    ];
    const els = buildTextElements(lines, 'page_1', 0);
    expect(els).toHaveLength(1);
    expect(els[0].content).toEqual({ text: 'Yes' });
    expect(els[0].order).toBe(0);
  });
});

describe('buildImageSlots', () => {
  const sourceRect = { x0: 10, y0: 20, x1: 110, y1: 170 };

  it('places the slot at the canvas rect with an exact source crop', () => {
    const slots: SlotGeometry[] = [
      { sourceRect, canvasRect: { x0: 20, y0: 40, x1: 220, y1: 340 }, include: true },
    ];
    const [el] = buildImageSlots(slots, 'asset_1', 'page_1', 5, 2);
    expect(el.type).toBe('image');
    expect(el.x).toBe(20);
    expect(el.y).toBe(40);
    expect(el.width).toBe(200);
    expect(el.height).toBe(300);
    expect(el.order).toBe(5);
    expect(el.content).toEqual({ assetId: 'asset_1', crop: { ox: -20, oy: -40, s: 2 } });
  });

  it('uses identity mapping at scale 1 (full-bleed import)', () => {
    const slots: SlotGeometry[] = [{ sourceRect, canvasRect: sourceRect, include: true }];
    const [el] = buildImageSlots(slots, 'asset_1', 'page_1', 0);
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.width).toBe(100);
    expect(el.height).toBe(150);
    expect(el.content).toEqual({ assetId: 'asset_1', crop: { ox: -10, oy: -20, s: 1 } });
  });

  it('skips unchecked slots', () => {
    const slots: SlotGeometry[] = [
      { sourceRect, canvasRect: sourceRect, include: false },
      { sourceRect, canvasRect: sourceRect, include: true },
    ];
    expect(buildImageSlots(slots, 'asset_1', 'page_1', 0)).toHaveLength(1);
  });
});
