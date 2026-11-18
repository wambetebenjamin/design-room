// Home screen: your designs, sample content, empty state, import JSON.

import { useEffect, useRef, useState } from 'react';
import type { Design, DesignDoc } from '../domain/types';
import { useEditor, importDesignFromImage } from '../store/editorStore';
import { loadDoc } from '../data/designRepo';
import { fetchImageAsFile } from '../data/urlImport';
import { preloadDesignAssets } from '../render/imageCache';
import { ElementView, PageBackground } from './ElementView';
import { elementsOfPage, backgroundToCss } from '../domain/document';
import { validateDocument, toDesignDoc } from '../domain/validate';
import { filterDesigns, formatEditedTime } from '../domain/designList';

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
  const setPendingOcr = useEditor((s) => s.setPendingOcr);

  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [uploadingDesign, setUploadingDesign] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [query, setQuery] = useState('');

  const onImportLink = async () => {
    setImportError(null);
    setLinkBusy(true);
    try {
      const file = await fetchImageAsFile(linkValue);
      setLinkValue('');
      setLinkOpen(false);
      await onUploadDesign(file);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not download that link.');
    } finally {
      setLinkBusy(false);
    }
  };

  const onUploadDesign = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    setUploadingDesign(true);
    try {
      const { designId, assetId, elementId } = await importDesignFromImage(file);
      await openDesign(designId);
      // Automatic extraction: text + photo areas offered right away.
      setPendingOcr({ assetId, elementId });
      toast('success', 'Design uploaded — reading its text and photo areas…');
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

      <div className="link-import">
        {!linkOpen ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinkOpen(true)}>
            🔗 Import from a link <span className="muted-inline">(GitHub, Google Drive, or any image URL)</span>
          </button>
        ) : (
          <form className="link-import-form" onSubmit={(e) => { e.preventDefault(); void onImportLink(); }}>
            <input
              type="url"
              inputMode="url"
              className="link-import-input"
              placeholder="https://… — e.g. a GitHub raw link or Drive share link"
              aria-label="Image link to import"
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              disabled={linkBusy}
              autoFocus
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={linkBusy || !linkValue.trim()}>
              {linkBusy ? 'Downloading…' : 'Import'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setLinkOpen(false);
                setLinkValue('');
              }}
              disabled={linkBusy}
            >
              Cancel
            </button>
          </form>
        )}
      </div>

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

      <Hero
        hasDesigns={designs.length > 0}
        onNewDesign={onNewDesign}
        onUpload={onUploadDesign}
        uploading={uploadingDesign}
      />

      {designs.length > 0 && (
        <section aria-label="Your designs">
            <div className="section-head">
              <h2 className="section-title">Your designs</h2>
              <label className="search-box">
                <span className="sr-only">Search designs by name</span>
                <input
                  type="search"
                  className="search-input"
                  placeholder="Search designs…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    className="search-clear"
                    aria-label="Clear search"
                    onClick={() => setQuery('')}
                  >
                    ×
                  </button>
                )}
              </label>
            </div>
            {(() => {
              const visible = filterDesigns(designs, query);
              if (visible.length === 0) {
                return (
                  <div className="empty-mini" role="status">
                    No designs match “{query.trim()}”.
                    <div className="empty-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuery('')}>
                        Clear search
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <ul className="design-grid">
                  {visible.map((d) => (
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
                            {d.width} × {d.height} · edited {formatEditedTime(d.updatedAt)}
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
              );
            })()}
        </section>
      )}

      <HowItWorks />
      <FeatureRows />

      <footer className="home-footer">
        <p>
          Local-first demo — designs and uploads live in your browser (IndexedDB). Export PNG, JPEG, ZIP or portable
          JSON anytime.
        </p>
      </footer>
    </div>
  );
}

// --- Hero ------------------------------------------------------------------

const CONFETTI = [
  { x: '5%', y: '16%', s: 16, r: 18, c: '#6D28D9' },
  { x: '11%', y: '70%', s: 12, r: -24, c: '#DB2777' },
  { x: '87%', y: '20%', s: 14, r: 40, c: '#F59E0B' },
  { x: '79%', y: '74%', s: 18, r: -12, c: '#12B5A9' },
  { x: '47%', y: '9%', s: 10, r: 60, c: '#DB2777' },
  { x: '93%', y: '54%', s: 12, r: 24, c: '#6D28D9' },
  { x: '2%', y: '46%', s: 14, r: -36, c: '#F59E0B' },
  { x: '62%', y: '86%', s: 11, r: 15, c: '#12B5A9' },
];

function Hero({
  hasDesigns,
  onNewDesign,
  onUpload,
  uploading,
}: {
  hasDesigns: boolean;
  onNewDesign: () => void;
  onUpload: (file: File | undefined) => void;
  uploading: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <section className="hero" aria-label="Welcome">
      <div className="hero-bg" aria-hidden="true">
        <span className="hero-blob hero-blob-1" />
        <span className="hero-blob hero-blob-2" />
        {CONFETTI.map((c, i) => (
          <i
            key={i}
            className="confetti-bit"
            style={{
              left: c.x,
              top: c.y,
              width: c.s,
              height: c.s,
              background: c.c,
              transform: `rotate(${c.r}deg)`,
            }}
          />
        ))}
      </div>

      <div className="hero-copy">
        {!hasDesigns && (
          <div className="empty-art" aria-hidden="true">
            <span className="empty-sheet" />
            <span className="empty-dot empty-dot-1" />
            <span className="empty-dot empty-dot-2" />
            <span className="empty-shape" />
          </div>
        )}
        <p className="hero-eyebrow">
          {hasDesigns ? 'CHRISCO Design Room' : 'Free online design editor · no account needed'}
        </p>
        <h2 className="hero-title">{hasDesigns ? 'Pick up where you left off.' : 'Your desk is clear'}</h2>
        <p className="hero-sub">
          {hasDesigns
            ? 'Open a design below, or start something new — everything saves in this browser automatically.'
            : 'Start from a canvas size, pick one of six original templates, or import a JSON document. Everything you make is saved in this browser automatically.'}
        </p>
        <div className="empty-actions hero-ctas">
          {!hasDesigns && (
            <button type="button" className="btn btn-primary btn-lg" onClick={onNewDesign}>
              Create your first design
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={() => fileRef.current?.click()}
          >
            Upload a design to edit
          </button>
        </div>
        <ul className="hero-badges">
          <li>
            <CheckIcon /> Free to use
          </li>
          <li>
            <CheckIcon /> No account needed
          </li>
          <li>
            <CheckIcon /> Saved in your browser
          </li>
        </ul>
      </div>

      <div
        className={`hero-drop${dragOver ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onUpload(e.dataTransfer.files?.[0]);
        }}
      >
        <span className="hero-drop-icon" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4" />
            <path d="m6 10 6-6 6 6" />
            <path d="M4 20h16" />
          </svg>
        </span>
        <p className="hero-drop-title">{dragOver ? 'Drop it to start editing' : 'Drag & drop a poster here'}</p>
        <p className="hero-drop-sub">PNG, JPEG or WebP · up to 15 MB</p>
        <label className={`btn btn-gradient btn-lg${uploading ? ' is-busy' : ''}`}>
          {uploading ? 'Uploading…' : 'Browse to upload'}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Upload an existing design image to edit"
            onChange={(e) => {
              onUpload(e.target.files?.[0]);
              e.target.value = '';
            }}
            disabled={uploading}
          />
        </label>
        <p className="hero-drop-hint">Or paste a GitHub / Drive link above.</p>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// --- How it works ----------------------------------------------------------

const STEPS = [
  {
    n: 1,
    t: 'Start or upload',
    d: 'Create a canvas from a preset — or drop in an existing poster, even from a GitHub or Drive link, and open it as an editable design.',
  },
  {
    n: 2,
    t: 'Extract & edit',
    d: 'Scan its text into editable layers, swap photo slots with your own pictures, then restyle with 22 bundled fonts, shapes and logos.',
  },
  {
    n: 3,
    t: 'Export & share',
    d: 'Download crisp PNG or JPEG at up to 8×, a ZIP of every page, or a portable JSON — all rendered right in your browser.',
  },
];

function HowItWorks() {
  return (
    <section className="how" aria-label="How it works">
      <h2 className="display-h">How it works</h2>
      <ol className="how-grid">
        {STEPS.map((s) => (
          <li key={s.n} className="how-card">
            <span className="how-num" aria-hidden="true">
              {s.n}
            </span>
            <h3>{s.t}</h3>
            <p>{s.d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// --- Feature rows ----------------------------------------------------------

function FeatureRows() {
  return (
    <section className="features" aria-label="Features">
      <article className="feature-row">
        <div className="feature-copy">
          <p className="hero-eyebrow">Text & photo extraction</p>
          <h2 className="display-h">Make any poster editable.</h2>
          <p>
            Upload a picture of a design and CHRISCO reads its text, turning every line into an editable layer that
            sits exactly where the original was — colours and sizes sampled from your image. Photo areas become slots
            you can fill with your own pictures.
          </p>
          <ul className="feature-ticks">
            <li>
              <CheckIcon /> Fonts matched to the original style
            </li>
            <li>
              <CheckIcon /> Replace photos without touching the layout
            </li>
            <li>
              <CheckIcon /> One undo puts everything back
            </li>
          </ul>
        </div>
        <div className="feature-art art-poster" aria-hidden="true">
          <span className="art-bar art-bar-1" />
          <span className="art-bar art-bar-2" />
          <span className="art-bar art-bar-3" />
          <span className="art-select">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="art-chip">Editable text</span>
        </div>
      </article>

      <article className="feature-row feature-row-flip">
        <div className="feature-copy">
          <p className="hero-eyebrow">Typography & style</p>
          <h2 className="display-h">Your words, your fonts.</h2>
          <p>
            Twenty-two open-licensed font families across sans, serif, display, handwriting and mono — plus six colour
            palettes, page presets and full controls for weight, spacing, alignment and line height.
          </p>
          <ul className="feature-ticks">
            <li>
              <CheckIcon /> Grouped font picker with live preview
            </li>
            <li>
              <CheckIcon /> Every family licensed for commercial use
            </li>
          </ul>
        </div>
        <div className="feature-art art-fonts" aria-hidden="true">
          <span className="font-chip" style={{ fontFamily: 'Inter' }}>
            Inter
          </span>
          <span className="font-chip" style={{ fontFamily: 'Playfair Display' }}>
            Playfair
          </span>
          <span className="font-chip" style={{ fontFamily: 'Bebas Neue' }}>
            BEBAS
          </span>
          <span className="font-chip" style={{ fontFamily: 'Caveat' }}>
            Caveat
          </span>
          <span className="font-chip" style={{ fontFamily: 'Space Mono' }}>
            Space Mono
          </span>
          <span className="font-chip" style={{ fontFamily: 'Abril Fatface' }}>
            Abril
          </span>
        </div>
      </article>

      <article className="feature-row">
        <div className="feature-copy">
          <p className="hero-eyebrow">High-definition export</p>
          <h2 className="display-h">Export in gorgeous detail.</h2>
          <p>
            Render PNG or JPEG at 1× through 8× with a live pixel readout, smart guards for oversized canvases, a ZIP of
            every page, and portable JSON that round-trips your whole document.
          </p>
          <ul className="feature-ticks">
            <li>
              <CheckIcon /> Exact-size canvas renderer
            </li>
            <li>
              <CheckIcon /> All-pages ZIP in one click
            </li>
          </ul>
        </div>
        <div className="feature-art art-export" aria-hidden="true">
          <div className="export-chips">
            <span>1×</span>
            <span>2×</span>
            <span>4×</span>
            <span>6×</span>
            <span className="is-on">8×</span>
          </div>
          <p className="export-readout">
            4320 × 4320 px <strong>· 18.7 MP</strong>
          </p>
          <p className="export-note">PNG · JPEG · ZIP · JSON</p>
        </div>
      </article>
    </section>
  );
}
