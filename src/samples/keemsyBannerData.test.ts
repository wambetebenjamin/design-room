// The bundled example banner's extraction is precomputed offline
// (scripts/precomputeKeemsy.ts) so the app can open it instantly and fully
// editable. These tests lock the data contract: images shipped, text lines
// styled within our bundled font set, curated wording intact, and the
// element-building maths (identity mapping, layer order) correct.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildImageSlots, buildTextElements, type ReviewLine, type SlotGeometry } from '../ocr/applyExtraction';
import { FONTS } from '../domain/templates';
import type { ImageContent, TextStyle } from '../domain/types';
import { BANNER, BANNER_LINES, BANNER_PHOTOS } from './keemsyBannerData';

const HEX = /^#[0-9a-f]{6}$/i;

describe('example banner extraction data', () => {
  it('ships the original and cleaned banner images in public/samples', () => {
    const dir = path.join(process.cwd(), 'public', 'samples');
    const original = path.join(dir, 'keemsy-banner.jpeg');
    const clean = path.join(dir, 'keemsy-banner-clean.jpeg');
    expect(fs.existsSync(original)).toBe(true);
    expect(fs.existsSync(clean)).toBe(true);
    expect(fs.statSync(original).size).toBeGreaterThan(100_000);
    expect(fs.statSync(clean).size).toBeGreaterThan(100_000);
  });

  it('matches the 656×1568 source photo', () => {
    expect(BANNER.width).toBe(656);
    expect(BANNER.height).toBe(1568);
  });

  it('holds every text line inside the canvas, styled from our bundled fonts', () => {
    expect(BANNER_LINES.length).toBeGreaterThanOrEqual(25);
    const families = new Set(FONTS.map((f) => f.family));
    const weights = new Map(FONTS.map((f) => [f.family, f.weights]));
    for (const line of BANNER_LINES) {
      expect(line.text.trim().length).toBeGreaterThan(0);
      expect(line.bbox.x0).toBeGreaterThanOrEqual(0);
      expect(line.bbox.y0).toBeGreaterThanOrEqual(0);
      expect(line.bbox.x1).toBeLessThanOrEqual(BANNER.width);
      expect(line.bbox.y1).toBeLessThanOrEqual(BANNER.height);
      expect(line.bbox.x1).toBeGreaterThan(line.bbox.x0);
      expect(line.fontSize).toBeGreaterThanOrEqual(6);
      expect(families.has(line.fontFamily)).toBe(true);
      expect(weights.get(line.fontFamily)).toContain(line.fontWeight);
      expect(line.color).toMatch(HEX);
      expect(line.bgColor).toMatch(HEX);
    }
  });

  it('preserves the printed wording — headline, pill, columns, contacts', () => {
    const texts = BANNER_LINES.map((l) => l.text);
    for (const expected of [
      'MAKE GOOD',
      'BUSINESS',
      'HARD TO MISS',
      '360° GROWTH PARTNER',
      'AGENCY',
      'SHOP',
      'APP',
      'LET’S BUILD',
      'GROWTH',
      'www.keemsyconsult.com',
      'info@keemsyconsult.com',
    ]) {
      expect(texts).toContain(expected);
    }
    expect(texts.some((t) => t.includes('0728 498 299'))).toBe(true);
    // The stylised wordmark stays part of the artwork — never re-typed as
    // standalone text (contact addresses that merely contain the name are fine).
    expect(texts.some((t) => /(^|[^a-z])keemsy([^a-z]|$)/i.test(t))).toBe(false);
    // Text printed inside the photos stays artwork too.
    expect(texts.some((t) => t.includes('BRAND'))).toBe(false);
  });

  it('detects the circular photo area as one replaceable slot', () => {
    expect(BANNER_PHOTOS.length).toBeGreaterThanOrEqual(1);
    for (const rect of BANNER_PHOTOS) {
      expect(rect.x0).toBeGreaterThanOrEqual(0);
      expect(rect.y0).toBeGreaterThanOrEqual(0);
      expect(rect.x1).toBeLessThanOrEqual(BANNER.width);
      expect(rect.y1).toBeLessThanOrEqual(BANNER.height);
      expect(rect.x1 - rect.x0).toBeGreaterThanOrEqual(48);
      expect(rect.y1 - rect.y0).toBeGreaterThanOrEqual(48);
    }
  });

  it('builds editable layers on the identity canvas mapping', () => {
    const pageId = 'page_sample';

    const geometry: SlotGeometry[] = BANNER_PHOTOS.map((rect) => ({
      sourceRect: rect,
      canvasRect: rect,
      include: true,
    }));
    const slots = buildImageSlots(geometry, 'asset_clean', pageId, 1, 1);
    expect(slots.length).toBe(BANNER_PHOTOS.length);
    const [slot] = slots;
    expect(slot.type).toBe('image');
    expect(slot.x).toBe(BANNER_PHOTOS[0].x0);
    expect(slot.y).toBe(BANNER_PHOTOS[0].y0);
    const crop = (slot.content as ImageContent).crop!;
    expect(crop.s).toBe(1);
    // Frame pixel (0,0) must show source pixel (x0, y0): ox + x0*s = 0.
    expect(crop.ox + BANNER_PHOTOS[0].x0 * crop.s).toBeCloseTo(0, 6);
    expect(crop.oy + BANNER_PHOTOS[0].y0 * crop.s).toBeCloseTo(0, 6);

    const lines: ReviewLine[] = BANNER_LINES.map((line) => ({
      region: line,
      include: true,
      text: line.text,
      fontFamily: line.fontFamily,
    }));
    const texts = buildTextElements(lines, pageId, 1 + slots.length);
    expect(texts.length).toBe(BANNER_LINES.length);
    for (const [i, el] of texts.entries()) {
      const src = BANNER_LINES[i];
      expect(el.type).toBe('text');
      expect(el.pageId).toBe(pageId);
      expect(el.content).toEqual({ text: src.text });
      expect(el.width).toBeGreaterThanOrEqual(12);
      expect(el.x).toBeGreaterThanOrEqual(-2);
      expect((el.style as TextStyle).fontFamily).toBe(src.fontFamily);
    }
    // Slots sit below the text layers in draw order.
    expect(slot.order).toBeLessThan(texts[texts.length - 1].order);
  });
});
