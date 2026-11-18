// Text-extraction review dialog: scans the chosen image in the browser,
// shows every detected line for review, then adds positioned, style-matched
// editable text layers (optionally erasing the original pixels first).

import { useEffect, useRef, useState } from 'react';
import { useEditor, type OcrTarget } from '../store/editorStore';
import { extractTextRegions, resetOcrWorker, type OcrProgress } from '../ocr/extractText';
import { buildTextElements, paintOutRegions, type ReviewLine } from '../ocr/applyExtraction';
import { getImage, preloadAssets } from '../render/imageCache';
import { saveAsset, listAssets } from '../data/designRepo';
import { withElement, addElement, uid } from '../domain/document';
import { FONTS, FONT_CATEGORIES, nearestWeight } from '../domain/templates';

interface Props {
  target: OcrTarget;
  onClose: () => void;
}

type Phase = 'scanning' | 'review' | 'applying' | 'error' | 'empty';

export function OcrDialog({ target, onClose }: Props) {
  const commit = useEditor((s) => s.commit);
  const toast = useEditor((s) => s.toast);

  const [phase, setPhase] = useState<Phase>('scanning');
  const [progress, setProgress] = useState<OcrProgress>({ phase: 'engine', progress: 0, label: 'Starting…' });
  const [lines, setLines] = useState<ReviewLine[]>([]);
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
      if (regions.length === 0) {
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

  const includedCount = lines.filter((l) => l.include && l.text.trim()).length;

  const apply = async () => {
    const included = lines.filter((l) => l.include && l.text.trim());
    if (included.length === 0) {
      toast('info', 'Tick at least one line to add as text.');
      return;
    }
    setPhase('applying');
    try {
      const current = useEditor.getState();
      const docNow = current.doc;
      const activePageId = current.currentPageId ?? docNow?.pages[0]?.id;
      if (!docNow || !activePageId) throw new Error('No active page.');

      const maxOrder = docNow.elements
        .filter((e) => e.pageId === activePageId)
        .reduce((m, e) => Math.max(m, e.order), -1);
      const textElements = buildTextElements(included, activePageId, maxOrder + 1);

      // Optionally paint the original text out of the base image first.
      let newAssetId: string | null = null;
      if (erase && target.elementId) {
        const img = imgRef.current;
        const el = docNow.elements.find((e) => e.id === target.elementId);
        if (img && el && el.type === 'image') {
          const baseAssetId = (el.content as { assetId: string }).assetId;
          const assets = await listAssets(docNow.design.id);
          const sourceMime = assets.find((a) => a.id === baseAssetId)?.mimeType ?? 'image/png';
          const { blob, mimeType } = await paintOutRegions(
            img,
            included.map((l) => ({ bbox: l.region.bbox, bgColor: l.region.bgColor })),
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
      }

      const swapAssetId = newAssetId;
      commit((d) => {
        let next = d;
        if (swapAssetId && target.elementId) {
          const el = next.elements.find((e) => e.id === target.elementId);
          if (el && el.type === 'image') {
            next = withElement(next, el.id, { content: { ...el.content, assetId: swapAssetId } });
          }
        }
        for (const t of textElements) next = addElement(next, t);
        return next;
      });

      toast(
        'success',
        `${textElements.length} text layer${textElements.length === 1 ? '' : 's'} added — editable and styled to match.`,
      );
      onClose();
    } catch (e) {
      setPhase('review');
      toast('error', e instanceof Error ? e.message : 'Could not apply extracted text.');
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
        <h2 id="ocr-title">Extract text from image</h2>
        <p className="panel-note">
          Runs entirely in your browser — nothing is uploaded. Colours and sizes are sampled from the image and fonts
          are matched to the closest bundled style. English text.
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
            <p>No readable text was found in this image.</p>
            <p className="panel-note">Extraction recognises English text in reasonably clear, upright lettering.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}

        {phase === 'review' && (
          <>
            <label className="ocr-opt">
              <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} />
              <span>
                <strong>Erase original text</strong> in the image (recommended for flat or solid backgrounds) — the new
                layers replace it seamlessly
              </span>
            </label>
            <div className="ocr-list">
              {lines.map((l, i) => (
                <div className={`ocr-line${l.include ? '' : ' is-off'}`} key={l.region.id}>
                  <input
                    type="checkbox"
                    className="ocr-line-check"
                    checked={l.include}
                    aria-label={`Include line ${i + 1}`}
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
            <div className="modal-actions">
              <span className="ocr-count">
                {includedCount} of {lines.length} lines selected
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
                Add text layers
              </button>
            </div>
          </>
        )}

        {phase === 'applying' && (
          <div className="ocr-scan" aria-live="polite">
            <span className="ocr-dot" aria-hidden="true" />
            <div className="ocr-scan-label">Adding text layers…</div>
          </div>
        )}
      </div>
    </div>
  );
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
