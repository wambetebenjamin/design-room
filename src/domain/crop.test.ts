import { describe, expect, it } from 'vitest';
import { clampOffset, coverScale, defaultCrop, fitCropToFrame, moveCrop, scaleCrop } from './crop';

const NW = 4000;
const NH = 3000;
const FW = 600;
const FH = 400;

describe('crop math', () => {
  it('coverScale makes the image at least as large as the frame', () => {
    const s = coverScale(NW, NH, FW, FH);
    expect(NW * s).toBeGreaterThanOrEqual(FW - 1e-9);
    expect(NH * s).toBeGreaterThanOrEqual(FH - 1e-9);
  });

  it('defaultCrop covers the frame and is centered', () => {
    const c = defaultCrop(NW, NH, FW, FH);
    expect(c.ox + NW * c.s).toBeGreaterThanOrEqual(FW - 1e-6);
    expect(c.oy + NH * c.s).toBeGreaterThanOrEqual(FH - 1e-6);
    expect(c.ox).toBeLessThanOrEqual(0);
    expect(c.oy).toBeLessThanOrEqual(0);
    // centered horizontally (cover by width here)
    expect(Math.abs(c.ox + (NW * c.s - FW) / 2)).toBeLessThan(1e-6);
  });

  it('moveCrop clamps so the image keeps covering the frame', () => {
    const c = defaultCrop(NW, NH, FW, FH);
    // Pushing right/down pins the image's left/top edge to the frame edge…
    const moved = moveCrop(c, 10000, 10000, NW, NH, FW, FH);
    expect(moved.ox).toBe(0);
    expect(moved.oy).toBe(0);
    // …and pushing left/up pins the right/bottom edge instead.
    const moved2 = moveCrop(c, -10000, -10000, NW, NH, FW, FH);
    expect(moved2.ox).toBeCloseTo(FW - NW * moved2.s, 5);
    expect(moved2.oy).toBeCloseTo(FH - NH * moved2.s, 5);
  });

  it('scaleCrop never lets the image drop below cover size', () => {
    const c = defaultCrop(NW, NH, FW, FH);
    const tiny = scaleCrop(c, 0.01, NW, NH, FW, FH);
    expect(tiny.s).toBeCloseTo(coverScale(NW, NH, FW, FH), 6);
    const big = scaleCrop(c, 2, NW, NH, FW, FH);
    expect(big.s).toBeCloseTo(c.s * 2, 6);
    expect(big.ox + NW * big.s).toBeGreaterThanOrEqual(FW - 1e-6);
    expect(big.oy + NH * big.s).toBeGreaterThanOrEqual(FH - 1e-6);
  });

  it('fitCropToFrame recovers when the frame grows beyond the crop', () => {
    const c = defaultCrop(NW, NH, 200, 200);
    const grown = fitCropToFrame(c, NW, NH, FW, FH);
    expect(grown.s).toBeGreaterThanOrEqual(coverScale(NW, NH, FW, FH) - 1e-9);
    const clamped = clampOffset(grown.ox, grown.oy, NW * grown.s, NH * grown.s, FW, FH);
    expect(clamped.ox).toBeCloseTo(grown.ox, 6);
  });

  it('handles portrait frames too', () => {
    const c = defaultCrop(NW, NH, 300, 900);
    expect(NH * c.s).toBeGreaterThanOrEqual(900 - 1e-6);
    expect(c.oy + NH * c.s).toBeGreaterThanOrEqual(900 - 1e-6);
  });
});
