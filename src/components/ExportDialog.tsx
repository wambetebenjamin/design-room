// Export dialog: PNG/JPEG at a chosen scale, current page or all pages (ZIP),
// plus portable JSON.

import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';
import {
  exportAllPagesZip,
  exportJson,
  exportPageImage,
  maxScaleFor,
  validateExportScale,
  type ExportProgress,
  type ImageFormat,
} from '../export/exportImage';

const SCALE_OPTIONS = [1, 2, 3, 4, 6, 8];

interface Props {
  onClose: () => void;
}

export function ExportDialog({ onClose }: Props) {
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const toast = useEditor((s) => s.toast);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [scale, setScale] = useState(2);
  const [scope, setScope] = useState<'current' | 'all' | 'json'>('current');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!doc) return null;

  const pageIndex = Math.max(
    0,
    doc.pages.findIndex((p) => p.id === currentPageId),
  );
  const totalPages = doc.pages.length;
  const maxScale = maxScaleFor(doc.design.width, doc.design.height);
  const effScale = Math.min(scale, maxScale);
  const outW = Math.round(doc.design.width * effScale);
  const outH = Math.round(doc.design.height * effScale);
  const outMP = ((outW * outH) / 1e6).toFixed(1);

  const run = async () => {
    setError(null);
    setProgress({ done: 0, total: 1, label: 'Starting…' });
    try {
      if (scope === 'json') {
        exportJson(doc);
        toast('success', 'Document JSON downloaded.');
      } else if (scope === 'current') {
        validateExportScale(doc.design.width, doc.design.height, effScale);
        await exportPageImage(doc, pageIndex, format, effScale, setProgress);
        toast('success', 'Image downloaded.');
      } else {
        validateExportScale(doc.design.width, doc.design.height, effScale);
        await exportAllPagesZip(doc, format, effScale, setProgress);
        toast('success', 'ZIP downloaded.');
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
      setProgress(null);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <h2 id="export-title">Export</h2>

        <fieldset className="modal-fieldset">
          <legend>What to export</legend>
          <label className={`radio-card${scope === 'current' ? ' is-active' : ''}`}>
            <input
              type="radio"
              name="scope"
              checked={scope === 'current'}
              onChange={() => setScope('current')}
              disabled={progress !== null}
            />
            <span>
              <strong>Current page</strong>
              <small>
                Page {pageIndex + 1} of {totalPages} as one image
              </small>
            </span>
          </label>
          <label className={`radio-card${scope === 'all' ? ' is-active' : ''}`}>
            <input
              type="radio"
              name="scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
              disabled={progress !== null || totalPages < 2}
            />
            <span>
              <strong>All pages as ZIP</strong>
              <small>{totalPages < 2 ? 'Add another page to enable this' : `${totalPages} images in one file`}</small>
            </span>
          </label>
          <label className={`radio-card${scope === 'json' ? ' is-active' : ''}`}>
            <input
              type="radio"
              name="scope"
              checked={scope === 'json'}
              onChange={() => setScope('json')}
              disabled={progress !== null}
            />
            <span>
              <strong>Portable JSON</strong>
              <small>Validated document file (images stay in this browser)</small>
            </span>
          </label>
        </fieldset>

        {scope !== 'json' && (
          <>
            <fieldset className="modal-fieldset">
              <legend>Format</legend>
              <div className="btn-group">
                <button
                  type="button"
                  className={`btn ${format === 'png' ? 'btn-primary' : 'btn-ghost'}`}
                  aria-pressed={format === 'png'}
                  onClick={() => setFormat('png')}
                  disabled={progress !== null}
                >
                  PNG (lossless)
                </button>
                <button
                  type="button"
                  className={`btn ${format === 'jpeg' ? 'btn-primary' : 'btn-ghost'}`}
                  aria-pressed={format === 'jpeg'}
                  onClick={() => setFormat('jpeg')}
                  disabled={progress !== null}
                >
                  JPEG (smaller)
                </button>
              </div>
            </fieldset>

            <fieldset className="modal-fieldset">
              <legend>High-definition scale</legend>
              <div className="btn-group">
                {SCALE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`btn ${effScale === s ? 'btn-primary' : 'btn-ghost'}`}
                    aria-pressed={effScale === s}
                    onClick={() => setScale(s)}
                    disabled={progress !== null || s > maxScale}
                    title={s > maxScale ? 'Exceeds the browser canvas limit for this page size' : `${s}× scale`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <p className="panel-note panel-readout">
                Output: <strong>{outW} × {outH} px</strong> · {outMP} MP
                {maxScale < 8 && (
                  <span className="readout-cap"> (max {maxScale}× for this page size)</span>
                )}
              </p>
            </fieldset>
          </>
        )}

        {progress && (
          <p className="export-progress" role="status" aria-live="polite">
            {progress.label}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button ref={closeRef} type="button" className="btn btn-ghost" onClick={onClose} disabled={progress !== null}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={progress !== null}>
            {progress ? 'Exporting…' : scope === 'json' ? 'Download JSON' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  );
}
