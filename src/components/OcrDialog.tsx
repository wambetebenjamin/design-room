// "Make this image editable" review dialog: scans the chosen image in the
// browser for text lines and photo areas, then adds positioned, style-matched
// editable text layers plus replaceable image slots (optionally erasing the
// original text pixels first).

import { useEffect, useRef, useState } from 'react';
import { useEditor, type OcrTarget } from '../store/editorStore';
import { extractTextRegions, resetOcrWorker, type OcrProgress, type TextRegion } from '../ocr/extractText';
import { buildTextElements, buildImageSlots, paintOutRegions, type ReviewLine, type PhotoSlot } from '../ocr/applyExtraction';
import type { SlotGeometry } from '../ocr/applyExtraction';
import { detectPhotoRegions } from '../ocr/detectRegions';
import type { Rect } from '../ocr/styleEst';
import { getImage, preloadAssets } from '../render/imageCache';
import { saveAsset, listAssets } from '../data/designRepo';
import { withElement, addElement, uid } from '../domain/document';
import { defaultCrop } from '../domain/crop';
import { FONTS, FONT_CATEGORIES, nearestWeight } from '../domain/templates';
import type { DesignElement, ImageContent } from '../domain/types';

interface Props {
  target: OcrTarget;
  onClose: () => void;
}

type Phase = 'scanning' | 'review' | 'applying' | 'error' | 'empty';

const DETECT_MAX = 1600;

export function OcrDialog({ target, onClose }: Props) {
  const commit = useEditor((s) => s.commit);
  const toast = useEditor((s) => s.toast);

  const [phase, setPhase] = useState<Phase>('scanning');
  const [progress, setProgress] = useState<OcrProgress>({ phase: 'engine', progress: 0, label: 'Starting…' });
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [photos, setPhotos] = useState<PhotoSlot[]>([]);
  const [erase, setErase] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const runIdRef = useRef(0);

  const runScan = async () => {
    const runId = ++runIdRef.current;
    setPhase('scanning');
    setError(null);
    setProgress({ phase: 'engine', progress: 0, label: 'Starting…' });
    try {
      const img = await ensureImage(target.assetId);
      if (runId !== runIdRef.current) return;
      imgRef.current = img;

      const regions = await extractTextRegions(img, (p) => {
        if (runId === runIdRef.current) setProgress(p);
      });
      if (runId !== runIdRef.current) return;

      // Photo areas: texture analysis on a downscaled copy, text boxes excluded.
      let photoRects: Rect[] = [];
      try {
        photoRects = detectPhotos(img, regions.map((r) => r.bbox));
      } catch (e) {
        console.error('Photo detection failed', e);
      }
      if (runId !== runIdRef.current) return;

      if (regions.length === 0 && photoRects.length === 0) {
        setPhase('empty');
        return;
      }
      setLines(
        regions.map((r) => ({
          region: r,
          include: r.confidence >= 55,
          text: r.text,
          fontFamily: r.fontFamily,
        })),
      );
      setPhotos(photoRects.map((rect) => ({ rect, include: true })));
      setPhase('review');
    } catch (e) {
      if (runId !== runIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Text extraction failed.');
      setPhase('error');
    }
  };

  useEffect(() => {
    void runScan();
    return () => {
      runIdRef.current++; // invalidate in-flight work on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes (matching the other dialogs) unless we are mid-apply.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'applying') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const patchLine = (i: number, patch: Partial<ReviewLine>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const patchPhoto = (i: number, patch: Partial<PhotoSlot>) => {
    setPhotos((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const includedLines = lines.filter((l) => l.include && l.text.trim());
  const includedPhotos = photos.filter((p) => p.include);
  const includedCount = includedLines.length + includedPhotos.length;

  const apply = async () => {
    if (includedCount === 0) {
      toast('info', 'Tick at least one text line or photo area.');
      return;
    }
    setPhase('applying');
    try {
      const current = useEditor.getState();
      const docNow = current.doc;
      const activePageId = current.currentPageId ?? docNow?.pages[0]?.id;
      const img = imgRef.current;
      if (!docNow || !activePageId || !img) throw new Error('No active page.');

      // Regions are in source-image pixels; map them onto the canvas through
      // the base image element's frame + crop (identity when full-bleed).
      const baseEl = findBaseElement(docNow.elements, target);
      const { map: toCanvas, scale } = makeMapper(baseEl, img.naturalWidth, img.naturalHeight);

      const maxOrder = docNow.elements
        .filter((e) => e.pageId === activePageId)
        .reduce((m, e) => Math.max(m, e.order), -1);

      // Optionally paint the original text out of the base image first.
      let newAssetId: string | null = null;
      if (erase && baseEl) {
        const assets = await listAssets(docNow.design.id);
        const baseContent = baseEl.content as ImageContent;
        const sourceMime = assets.find((a) => a.id === baseContent.assetId)?.mimeType ?? 'image/png';
        const { blob, mimeType } = await paintOutRegions(
          img,
          includedLines.map((l) => ({ bbox: l.region.bbox, bgColor: l.region.bgColor })),
          sourceMime,
        );
        newAssetId = uid('asset');
        await saveAsset({
          id: newAssetId,
          designId: docNow.design.id,
          name: 'text-extracted-clean',
          mimeType,
          blob,
        });
        await preloadAssets([{ id: newAssetId, blob }]);
      }

      const slotAssetId = newAssetId ?? target.assetId;
      const slotGeometry: SlotGeometry[] = includedPhotos.map((p) => ({
        sourceRect: p.rect,
        canvasRect: toCanvas(p.rect),
        include: true,
      }));
      const slots = buildImageSlots(slotGeometry, slotAssetId, activePageId, maxOrder + 1, scale);
      const textElements = buildTextElements(
        includedLines.map((l) => ({
          ...l,
          region: { ...l.region, bbox: toCanvas(l.region.bbox), fontSize: l.region.fontSize * scale },
        })),
        activePageId,
        maxOrder + 1 + slots.length,
      );

      const swapAssetId = newAssetId;
      const baseElId = baseEl?.id;
      commit((d) => {
        let next = d;
        if (swapAssetId && baseElId) {
          const el = next.elements.find((e) => e.id === baseElId);
          if (el && el.type === 'image') {
            next = withElement(next, el.id, { content: { ...el.content, assetId: swapAssetId } });
          }
        }
        for (const s of slots) next = addElement(next, s);
        for (const t of textElements) next = addElement(next, t);
        return next;
      });

      const parts: string[] = [];
      if (textElements.length > 0) {
        parts.push(`${textElements.length} text layer${textElements.length === 1 ? '' : 's'}`);
      }
      if (slots.length > 0) {
        parts.push(`${slots.length} photo slot${slots.length === 1 ? '' : 's'} (use Replace image to swap in your own picture)`);
      }
      toast('success', `Added ${parts.join(' and ')} — everything is editable.`);
      onClose();
    } catch (e) {
      setPhase('review');
      toast('error', e instanceof Error ? e.message : 'Could not apply the extraction.');
    }
  };

  const busy = phase === 'applying';

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal ocr-modal" role="dialog" aria-modal="true" aria-labelledby="ocr-title">
        <h2 id="ocr-title">Make this image editable</h2>
        <p className="panel-note">
          Scans run entirely in your browser — nothing is uploaded. Detected text becomes editable layers and photo
          areas become slots you can fill with your own pictures. English text.
        </p>

        {phase === 'scanning' && (
          <div className="ocr-scan" aria-live="polite">
            <span className="ocr-dot" aria-hidden="true" />
            <div className="ocr-scan-label">{progress.label}</div>
            <div
              className="ocr-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.progress * 100)}
              aria-label={progress.label}
            >
              <div className="ocr-progress-fill" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
            </div>
            <p className="panel-note">The first run downloads the OCR engine (~4 MB) once, then caches it.</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="ocr-scan" aria-live="assertive">
            <p className="form-error">{error}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  resetOcrWorker();
                  void runScan();
                }}
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {phase === 'empty' && (
          <div className="ocr-scan">
            <p>No text or photo areas were found in this image.</p>
            <p className="panel-note">Extraction recognises English text and large textured (photo) regions.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}

        {phase === 'review' && (
          <>
            {lines.length > 0 && (
              <label className="ocr-opt">
                <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} />
                <span>
                  <strong>Erase original text</strong> in the image (recommended for flat or solid backgrounds) — the
                  new layers replace it seamlessly
                </span>
              </label>
            )}

            {lines.length > 0 && (
              <section aria-label="Detected text">
                <h3 className="ocr-section-title">Text ({lines.length})</h3>
                <div className="ocr-list">
                  {lines.map((l, i) => (
                    <div className={`ocr-line${l.include ? '' : ' is-off'}`} key={l.region.id}>
                      <input
                        type="checkbox"
                        className="ocr-line-check"
                        checked={l.include}
                        aria-label={`Include text line ${i + 1}`}
                        onChange={(e) => patchLine(i, { include: e.target.checked })}
                      />
                      <div className="ocr-line-main">
                        <input
                          className="ocr-line-text"
                          value={l.text}
                          aria-label={`Text for line ${i + 1}`}
                          onChange={(e) => patchLine(i, { text: e.target.value })}
                        />
                        <div className="ocr-line-meta">
                          <select
                            className="font-select"
                            aria-label={`Font for line ${i + 1}`}
                            value={l.fontFamily}
                            onChange={(e) => patchLine(i, { fontFamily: e.target.value })}
                          >
                            {FONT_CATEGORIES.map((cat) => (
                              <optgroup label={cat} key={cat}>
                                {FONTS.filter((f) => f.category === cat).map((f) => (
                                  <option value={f.family} key={f.family}>
                                    {f.family}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <span
                            className="ocr-line-preview"
                            aria-hidden="true"
                            style={{
                              fontFamily: l.fontFamily,
                              fontWeight: nearestWeight(l.fontFamily, l.region.fontWeight),
                              color: l.region.color,
                            }}
                          >
                            Aa
                          </span>
                          <span
                            className={`ocr-conf${l.region.confidence < 70 ? ' is-low' : ''}`}
                            title="Recognition confidence"
                          >
                            {l.region.confidence}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {photos.length > 0 && (
              <section aria-label="Detected photo areas" className="ocr-photos">
                <h3 className="ocr-section-title">Photo areas ({photos.length})</h3>
                <p className="panel-note">
                  Each checked area becomes a slot that looks identical for now — select it on the canvas and use{' '}
                  <strong>Replace image</strong> to drop in your own picture.
                </p>
                {photos.map((p, i) => (
                  <label className={`ocr-opt${p.include ? '' : ' is-off'}`} key={`photo-${i}`}>
                    <input
                      type="checkbox"
                      checked={p.include}
                      aria-label={`Include photo area ${i + 1}`}
                      onChange={(e) => patchPhoto(i, { include: e.target.checked })}
                    />
                    <span>
                      <strong>Photo {i + 1}</strong> — {Math.round(p.rect.x1 - p.rect.x0)}×
                      {Math.round(p.rect.y1 - p.rect.y0)} px at ({Math.round(p.rect.x0)}, {Math.round(p.rect.y0)})
                    </span>
                  </label>
                ))}
              </section>
            )}

            <div className="modal-actions">
              <span className="ocr-count">
                {includedLines.length} text · {includedPhotos.length} photo · {lines.length + photos.length} found
              </span>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy} autoFocus>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void apply()}
                disabled={busy || includedCount === 0}
              >
                Add to design
              </button>
            </div>
          </>
        )}

        {phase === 'applying' && (
          <div className="ocr-scan" aria-live="polite">
            <span className="ocr-dot" aria-hidden="true" />
            <div className="ocr-scan-label">Adding layers to your design…</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Texture analysis for photo areas (downscaled for memory safety). */
function detectPhotos(img: HTMLImageElement, textBoxes: Rect[]): Rect[] {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const f = Math.min(1, DETECT_MAX / Math.max(nw, nh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(nw * f));
  canvas.height = Math.max(1, Math.round(nh * f));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const scaledText = textBoxes.map((b) => ({ x0: b.x0 * f, y0: b.y0 * f, x1: b.x1 * f, y1: b.y1 * f }));
  const found = detectPhotoRegions(data.data, canvas.width, canvas.height, scaledText);
  return found.map((r) => ({ x0: r.x0 / f, y0: r.y0 / f, x1: r.x1 / f, y1: r.y1 / f }));
}

/** The image element the scanned regions belong to. */
function findBaseElement(elements: DesignElement[], target: OcrTarget): DesignElement | undefined {
  if (target.elementId) {
    const el = elements.find((e) => e.id === target.elementId);
    if (el && el.type === 'image') return el;
  }
  return elements.find((e) => e.type === 'image' && (e.content as ImageContent).assetId === target.assetId);
}

/** Map source-image pixel coordinates onto canvas coordinates. */
function makeMapper(
  el: DesignElement | undefined,
  nw: number,
  nh: number,
): { map: (r: Rect) => Rect; scale: number } {
  if (!el || el.type !== 'image') return { map: (r) => r, scale: 1 };
  const content = el.content as ImageContent;
  const crop = content.crop ?? defaultCrop(nw, nh, el.width, el.height);
  const map = (r: Rect): Rect => ({
    x0: el.x + crop.ox + r.x0 * crop.s,
    y0: el.y + crop.oy + r.y0 * crop.s,
    x1: el.x + crop.ox + r.x1 * crop.s,
    y1: el.y + crop.oy + r.y1 * crop.s,
  });
  return { map, scale: crop.s };
}

/** The cache may not have this asset yet (dialog can mount before preload). */
async function ensureImage(assetId: string): Promise<HTMLImageElement> {
  const first = await getImage(assetId);
  if (first) return first;
  const designId = useEditor.getState().doc?.design.id;
  if (designId) {
    const assets = await listAssets(designId);
    const asset = assets.find((a) => a.id === assetId);
    if (asset) await preloadAssets([{ id: asset.id, blob: asset.blob }]);
  }
  const img = await getImage(assetId);
  if (!img) throw new Error('That image could not be loaded for scanning.');
  return img;
}
