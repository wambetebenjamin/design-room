// Unit tests for photo-region detection on synthetic pixel buffers.

import { describe, it, expect } from 'vitest';
import { detectPhotoRegions } from './detectRegions';
import type { Rect } from './styleEst';

function makeImage(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(255); // flat white
}

/** Deterministic pseudo-noise (LCG) so tests are stable. */
function fillNoise(data: Uint8ClampedArray, width: number, rect: Rect, seed = 42): void {
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let y = Math.floor(rect.y0); y < rect.y1; y++) {
    for (let x = Math.floor(rect.x0); x < rect.x1; x++) {
      const o = (y * width + x) * 4;
      data[o] = Math.floor(rand() * 256);
      data[o + 1] = Math.floor(rand() * 256);
      data[o + 2] = Math.floor(rand() * 256);
      data[o + 3] = 255;
    }
  }
}

function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function area(r: Rect): number {
  return (r.x1 - r.x0) * (r.y1 - r.y0);
}

describe('detectPhotoRegions', () => {
  it('finds nothing on a flat image', () => {
    const w = 300;
    const h = 300;
    expect(detectPhotoRegions(makeImage(w, h), w, h)).toEqual([]);
  });

  it('finds a large textured block', () => {
    const w = 300;
    const h = 300;
    const block: Rect = { x0: 60, y0: 80, x1: 260, y1: 240 };
    const data = makeImage(w, h);
    fillNoise(data, w, block);
    const regions = detectPhotoRegions(data, w, h);
    expect(regions).toHaveLength(1);
    const r = regions[0];
    // Overlap with the original block should be substantial (tile rounding ok).
    expect(intersection(r, block) / area(block)).toBeGreaterThan(0.8);
    expect(intersection(r, block) / area(r)).toBeGreaterThan(0.7);
  });

  it('ignores regions covered by text boxes', () => {
    const w = 300;
    const h = 300;
    const block: Rect = { x0: 60, y0: 80, x1: 260, y1: 240 };
    const data = makeImage(w, h);
    fillNoise(data, w, block);
    const textBoxes: Rect[] = [{ x0: 50, y0: 70, x1: 270, y1: 250 }];
    expect(detectPhotoRegions(data, w, h, textBoxes)).toEqual([]);
  });

  it('skips textured areas below the minimum size', () => {
    const w = 300;
    const h = 300;
    const data = makeImage(w, h);
    fillNoise(data, w, { x0: 10, y0: 10, x1: 40, y1: 40 });
    expect(detectPhotoRegions(data, w, h)).toEqual([]);
  });

  it('keeps two separate photo blocks as two regions', () => {
    const w = 400;
    const h = 300;
    const a: Rect = { x0: 20, y0: 20, x1: 160, y1: 160 };
    const b: Rect = { x0: 240, y0: 140, x1: 380, y1: 280 };
    const data = makeImage(w, h);
    fillNoise(data, w, a, 1);
    fillNoise(data, w, b, 7);
    const regions = detectPhotoRegions(data, w, h);
    expect(regions).toHaveLength(2);
    // Sorted largest-first: both blocks are similar; just check both are found.
    const totalOverlap = regions.reduce((sum, r) => {
      const oa = intersection(r, a) / area(a);
      const ob = intersection(r, b) / area(b);
      return sum + Math.max(oa, ob);
    }, 0);
    expect(totalOverlap).toBeGreaterThan(1.6);
  });

  it('returns nothing for tiny images', () => {
    const data = makeImage(40, 40);
    expect(detectPhotoRegions(data, 40, 40)).toEqual([]);
  });
});
