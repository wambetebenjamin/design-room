// One-click example: the bundled Keemsy Consulting roll-up banner opens in
// the canvas as a fully editable design — every text line as a styled layer
// and the photo area as a replaceable slot — while the artwork underneath
// stays pixel-identical. The extraction was computed offline by
// scripts/precomputeKeemsy.ts (OCR + curated curation), so no scanning runs
// at load time. The untouched original is stored alongside the cleaned base;
// one Ctrl+Z removes every added layer and restores it.

import { saveAsset } from '../data/designRepo';
import { addElement, uid } from '../domain/document';
import { buildImageSlots, buildTextElements, type ReviewLine, type SlotGeometry } from '../ocr/applyExtraction';
import { importDesignFromImage, useEditor } from '../store/editorStore';
import { preloadAssets } from '../render/imageCache';
import { BANNER, BANNER_LINES, BANNER_PHOTOS } from './keemsyBannerData';

export interface LoadedBanner {
  designId: string;
  textLayers: number;
  photoSlots: number;
}

async function fetchSample(path: string): Promise<Blob> {
  const base = import.meta.env.BASE_URL || '/';
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error('The example banner could not be downloaded.');
  const blob = await res.blob();
  if (blob.size < 1024) throw new Error('The example banner file looks incomplete.');
  return blob;
}

/**
 * Create the example banner design and open it, fully editable.
 * Throws with a user-actionable message on any failure.
 */
export async function loadExampleBanner(): Promise<LoadedBanner> {
  const [originalBlob, cleanBlob] = await Promise.all([
    fetchSample(BANNER.original),
    fetchSample(BANNER.clean),
  ]);

  const original = new File([originalBlob], 'Keemsy Consulting banner.jpeg', { type: 'image/jpeg' });
  const { designId } = await importDesignFromImage(original);

  const st = useEditor.getState();
  await st.openDesign(designId);

  // The cleaned base: identical pixels with the extractable text painted out
  // so the editable layers can sit exactly on top of it.
  const cleanAssetId = uid('asset');
  await saveAsset({
    id: cleanAssetId,
    designId,
    name: 'Keemsy Consulting banner — text layers',
    mimeType: 'image/jpeg',
    blob: cleanBlob,
  });
  // Fire-and-forget: warms the image cache when a real browser can decode
  // (never resolves under jsdom) — views repaint as soon as it lands.
  void preloadAssets([{ id: cleanAssetId, blob: cleanBlob }]);

  const state = useEditor.getState();
  const doc = state.doc;
  if (!doc || doc.design.id !== designId) throw new Error('The banner design could not be opened.');
  const pageId = doc.pages[0]?.id;
  if (!pageId) throw new Error('The banner design has no page.');

  const maxOrder = doc.elements
    .filter((e) => e.pageId === pageId)
    .reduce((m, e) => Math.max(m, e.order), -1);

  // Identity geometry: the base image element is full-bleed at 1:1 scale, so
  // source-image pixel coordinates and canvas coordinates are the same.
  const geometry: SlotGeometry[] = BANNER_PHOTOS.map((rect) => ({
    sourceRect: rect,
    canvasRect: rect,
    include: true,
  }));
  const slots = buildImageSlots(geometry, cleanAssetId, pageId, maxOrder + 1, 1);
  const lines: ReviewLine[] = BANNER_LINES.map((line) => ({
    region: line,
    include: true,
    text: line.text,
    fontFamily: line.fontFamily,
  }));
  const texts = buildTextElements(lines, pageId, maxOrder + 1 + slots.length);

  let textCount = 0;
  let slotCount = 0;
  state.commit((d) => {
    let next = d;
    const base = next.elements.find((e) => e.type === 'image' && e.order === 0);
    if (base && base.type === 'image') {
      next = {
        ...next,
        elements: next.elements.map((e) =>
          e.id === base.id ? { ...e, content: { ...e.content, assetId: cleanAssetId } } : e,
        ),
      };
    }
    for (const s of slots) next = addElement(next, s);
    for (const t of texts) next = addElement(next, t);
    textCount = texts.length;
    slotCount = slots.length;
    return next;
  });

  state.toast(
    'success',
    `Banner ready — ${textCount} editable text layers and ${slotCount} photo slot sit over the untouched artwork. Ctrl+Z restores the original.`,
  );

  return { designId, textLayers: textCount, photoSlots: slotCount };
}
