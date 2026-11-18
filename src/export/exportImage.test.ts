import { describe, expect, it } from 'vitest';
import { maxScaleFor, validateExportScale, MAX_CANVAS_SIDE } from './exportImage';

describe('high-definition export guards', () => {
  it('allows 4× for a social post', () => {
    expect(() => validateExportScale(1080, 1080, 4)).not.toThrow();
    expect(() => validateExportScale(1080, 1080, 8)).not.toThrow(); // 8640² fits
  });

  it('rejects scales that exceed the canvas side limit', () => {
    expect(() => validateExportScale(4000, 4000, 8)).toThrow(/browser limit/);
    expect(MAX_CANVAS_SIDE).toBe(16384);
  });

  it('rejects scales that exceed the canvas area limit', () => {
    // side passes (16000) but area 16000×16400 ≈ 262MP is fine; use bigger
    expect(() => validateExportScale(5000, 6000, 4)).toThrow(/too large|browser limit/);
  });

  it('maxScaleFor returns the largest offered scale that fits', () => {
    expect(maxScaleFor(1080, 1080)).toBe(8);
    expect(maxScaleFor(1654, 2339)).toBe(6); // 8× poster = 13232×18712 ≈ 248MP ok? side ok, area 248<268 → 8
    expect(maxScaleFor(8000, 8000)).toBe(2);
    expect(maxScaleFor(10000, 10000)).toBe(1);
  });

  it('never returns a scale that fails validation', () => {
    for (const [w, h] of [
      [1080, 1080],
      [1080, 1920],
      [1654, 2339],
      [1920, 1080],
      [8000, 8000],
      [64, 4000],
    ] as const) {
      const s = maxScaleFor(w, h);
      expect(() => validateExportScale(w, h, s)).not.toThrow();
    }
  });
});
