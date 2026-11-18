// Home screen: your designs, sample content, empty state, import JSON.

import { useEffect, useState } from 'react';
import type { Design, DesignDoc } from '../domain/types';
import { useEditor, importDesignFromImage } from '../store/editorStore';
import { loadDoc } from '../data/designRepo';
import { preloadDesignAssets } from '../render/imageCache';
import { ElementView, PageBackground } from './ElementView';
import { elementsOfPage, backgroundToCss } from '../domain/document';
import { validateDocument, toDesignDoc } from '../domain/validate';

interface Props {
  onNewDesign: () => void;
}

interface ThumbState {
  doc: DesignDoc | null;
  loading: boolean;
}

function DesignThumb({ design }: { design: Design }) {
  const [state, setState] = useState<ThumbState>({ doc: null, loading: true });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await preloadDesignAssets(design.id);
        const doc = await loadDoc(design.id);
        if (alive) setState({ doc, loading: false });
      } catch {
        if (alive) setState({ doc: null, loading: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, [design.id]);

  if (state.loading) {
    return <div className="thumb-skeleton" aria-hidden="true" />;
  }
  if (!state.doc) {
    return (
      <div className="thumb-error" role="img" aria-label="Preview unavailable">
        Preview unavailable
      </div>
    );
  }
  const page = [...state.doc.pages].sort((a, b) => a.order - b.order)[0];
  if (!page) return <div className="thumb-error">Empty</div>;
  const els = elementsOfPage(state.doc, page.id);
  const tw = 240;
  const scale = tw / state.doc.design.width;

  return (
    <div
      className="thumb-frame"
      style={{ width: tw, height: Math.min(320, state.doc.design.height * scale) }}
      aria-hidden="true"
    >
      <div
        className="thumb-inner"
        style={{
          width: state.doc.design.width,
          height: state.doc.design.height,
          transform: `scale(${scale})`,
        }}
      >
        <PageBackground background={page.background} width={state.doc.design.width} height={state.doc.design.height} />
        {els.map((el) => (
          <ElementView key={el.id} el={el} staticView />
        ))}
      </div>
    </div>
  );
}

export function HomeScreen({ onNewDesign }: Props) {
  const designs = useEditor((s) => s.designs);
  const loadError = useEditor((s) => s.loadError);
  const openDesign = useEditor((s) => s.openDesign);
  const deleteDesignById = useEditor((s) => s.deleteDesignById);
  const duplicateDesignById = useEditor((s) => s.duplicateDesignById);
  const askConfirm = useEditor((s) => s.askConfirm);
  const importDoc = useEditor((s) => s.importDoc);
  const toast = useEditor((s) => s.toast);
  const refreshDesigns = useEditor((s) => s.refreshDesigns);

  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [uploadingDesign, setUploadingDesign] = useState(false);

  const onUploadDesign = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setUploadingDesign(true);
    try {
      const id = await importDesignFromImage(file);
      await openDesign(id);
      toast('success', 'Design uploaded — layer text, images and logos on top.');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not upload that design.');
    } finally {
      setUploadingDesign(false);
    }
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setImporting(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('That JSON file is larger than 10 MB.');
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON.');
      }
      const result = validateDocument(parsed);
      if (!result.ok) {
        throw new Error(`Invalid document: ${result.errors.slice(0, 3).join(' ')}`);
      }
      await importDoc(toDesignDoc(parsed));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const onDelete = async (d: Design) => {
    const ok = await askConfirm(
      'Delete this design?',
      `“${d.title}” and everything in it will be removed from this browser. This cannot be undone.`,
      'Delete design',
    );
    if (ok) await deleteDesignById(d.id);
  };

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-brand">
          <span className="brand-mark brand-mark-lg" aria-hidden="true">
            C
          </span>
          <div>
            <h1>CHRISCO Design Room</h1>
            <p className="home-tagline">Social posts, stories and posters — made from your own ideas.</p>
          </div>
        </div>
        <div className="home-actions">
          <label className={`btn btn-ghost import-btn${uploadingDesign ? ' is-busy' : ''}`}>
            {uploadingDesign ? 'Uploading…' : '⬆ Upload design'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Upload an existing design image to edit"
              onChange={(e) => {
                void onUploadDesign(e.target.files?.[0]);
                e.target.value = '';
              }}
              disabled={uploadingDesign}
            />
          </label>
          <label className="btn btn-ghost import-btn">
            Import JSON
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Import a portable JSON document"
              onChange={(e) => {
                void onImport(e.target.files?.[0]);
                e.target.value = '';
              }}
              disabled={importing}
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={onNewDesign}>
            + New design
          </button>
        </div>
      </header>

      {loadError && (
        <div className="banner banner-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refreshDesigns()}>
            Try again
          </button>
        </div>
      )}
      {importError && (
        <div className="banner banner-error" role="alert">
          <span>{importError}</span>
        </div>
      )}
      {importing && (
        <div className="banner" role="status">
          Validating document…
        </div>
      )}

      {designs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art" aria-hidden="true">
            <span className="empty-sheet" />
            <span className="empty-dot empty-dot-1" />
            <span className="empty-dot empty-dot-2" />
            <span className="empty-shape" />
          </div>
          <h2>Your desk is clear</h2>
          <p>
            Start from a canvas size, pick one of six original templates, or import a JSON document. Everything you
            make is saved in this browser automatically.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={onNewDesign}>
              Create your first design
            </button>
            <label className="btn btn-ghost">
              Upload a design to edit
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="Upload an existing design image to edit"
                onChange={(e) => {
                  void onUploadDesign(e.target.files?.[0]);
                  e.target.value = '';
                }}
                disabled={uploadingDesign}
              />
            </label>
          </div>
        </div>
      ) : (
        <>
          <section aria-label="Your designs">
            <h2 className="section-title">Your designs</h2>
            <ul className="design-grid">
              {designs.map((d) => (
                <li key={d.id} className="design-card">
                  <button
                    type="button"
                    className="design-open"
                    onClick={() => void openDesign(d.id)}
                    aria-label={`Open ${d.title}`}
                  >
                    <DesignThumb design={d} />
                    <span className="design-meta">
                      <strong>
                        {d.title}
                        {d.sample && <em className="badge-sample">Sample</em>}
                      </strong>
                      <small>
                        {d.width} × {d.height} · {new Date(d.updatedAt).toLocaleDateString()}
                      </small>
                    </span>
                  </button>
                  <div className="design-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void duplicateDesignById(d.id)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => void onDelete(d)}
                      aria-label={`Delete ${d.title}`}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <footer className="home-footer">
        <p>
          Local-first demo — designs and uploads live in your browser (IndexedDB). Export PNG, JPEG, ZIP or portable
          JSON anytime.
        </p>
      </footer>
    </div>
  );
}
