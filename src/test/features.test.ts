// New feature coverage: design-image import, font library, logo library.

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildDesignFromImage } from '../store/editorStore';
import { deleteLogo, listLogos, saveAsset, LOGO_LIBRARY_ID } from '../data/designRepo';
import { FONTS, FONT_CATEGORIES, nearestWeight } from '../domain/templates';
import { defaultCrop } from '../domain/crop';

describe('upload-a-design import', () => {
  it('creates a design sized to the image with a full-bleed base layer', () => {
    const { doc, assetId } = buildDesignFromImage('My Poster.png', 1080, 1350);
    expect(doc.design.width).toBe(1080);
    expect(doc.design.height).toBe(1350);
    expect(doc.design.title).toBe('My Poster');
    expect(doc.pages).toHaveLength(1);
    expect(doc.elements).toHaveLength(1);
    const el = doc.elements[0];
    expect(el.type).toBe('image');
    expect(el.x).toBe(0);
    expect(el.y).toBe(0);
    expect(el.width).toBe(1080);
    expect(el.height).toBe(1350);
    expect((el.content as { assetId: string }).assetId).toBe(assetId);
    // crop covers the frame exactly
    const crop = (el.content as { crop: { ox: number; oy: number; s: number } }).crop;
    expect(crop.ox + 1080 * crop.s).toBeGreaterThanOrEqual(1080 - 1e-6);
    expect(crop.oy + 1350 * crop.s).toBeGreaterThanOrEqual(1350 - 1e-6);
  });

  it('sanitizes the title from the filename', () => {
    const { doc } = buildDesignFromImage('summer <flyer> v2!.jpg', 800, 600);
    expect(doc.design.title).toBe('summer flyer v2');
  });

  it('falls back when the filename has no usable name', () => {
    const { doc } = buildDesignFromImage('!!!.png', 800, 600);
    expect(doc.design.title).toBe('Imported design');
  });

  it('shrinks oversized images while keeping aspect ratio', () => {
    const { doc } = buildDesignFromImage('huge.png', 20000, 15000);
    expect(doc.design.width).toBe(10000);
    expect(doc.design.height).toBe(7500);
    const crop = (doc.elements[0].content as { crop: { s: number } }).crop;
    expect(crop.s).toBeCloseTo(10000 / 20000, 6);
  });

  it('never produces a canvas smaller than the minimum', () => {
    const { doc } = buildDesignFromImage('tiny.png', 8, 8);
    expect(doc.design.width).toBeGreaterThanOrEqual(16);
    expect(doc.design.height).toBeGreaterThanOrEqual(16);
  });
});

describe('font library', () => {
  it('offers a wide, unique set of families across categories', () => {
    expect(FONTS.length).toBeGreaterThanOrEqual(20);
    const families = FONTS.map((f) => f.family);
    expect(new Set(families).size).toBe(families.length);
    for (const f of FONTS) {
      expect(FONT_CATEGORIES).toContain(f.category);
      expect(f.weights.length).toBeGreaterThan(0);
      expect(f.weights.every((w) => w >= 100 && w <= 900)).toBe(true);
    }
    // every category represented
    for (const cat of FONT_CATEGORIES) {
      expect(FONTS.some((f) => f.category === cat)).toBe(true);
    }
  });

  it('nearestWeight snaps to an available weight', () => {
    expect(nearestWeight('Bebas Neue', 700)).toBe(400); // single-weight family
    expect(nearestWeight('Inter', 650)).toBe(600); // tie goes to the lower weight
    expect(nearestWeight('Inter', 510)).toBe(500);
    expect(nearestWeight('Inter', 690)).toBe(700);
    expect(nearestWeight('Unknown Family', 400)).toBe(400); // passthrough
  });
});

describe('logo library (global across designs)', () => {
  it('lists, and deletes, logos stored under the shared library id', async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    await saveAsset({ id: 'logo_test_1', designId: LOGO_LIBRARY_ID, name: 'brand.png', mimeType: 'image/png', blob });
    await saveAsset({ id: 'logo_test_2', designId: LOGO_LIBRARY_ID, name: 'mark.png', mimeType: 'image/png', blob });

    const logos = await listLogos();
    const ids = logos.map((l) => l.id);
    expect(ids).toContain('logo_test_1');
    expect(ids).toContain('logo_test_2');

    await deleteLogo('logo_test_1');
    const after = await listLogos();
    expect(after.map((l) => l.id)).not.toContain('logo_test_1');
    expect(after.map((l) => l.id)).toContain('logo_test_2');

    await deleteLogo('logo_test_2');
    expect((await listLogos()).length).toBe(0);
  });
});

describe('defaultCrop parity with import', () => {
  it('matches the crop the importer builds', () => {
    const c = defaultCrop(2000, 1000, 500, 500);
    expect(c.s).toBeCloseTo(0.5, 6); // cover by height
    expect(c.ox).toBeCloseTo(-250, 6); // wider than frame → centered horizontally
    expect(c.oy).toBeCloseTo(0, 6);
  });
});
