// Left library: templates, text, elements, uploads and style.

import { useCallback, useEffect, useRef, useState } from 'react';
import { TEMPLATES, FONTS, FONT_CATEGORIES, nearestWeight } from '../domain/templates';
import type { TextStyle } from '../domain/types';
import { PALETTES } from '../domain/palettes';
import type { TemplateDef } from '../domain/types';
import {
  useEditor,
  useSelectedElement,
  uploadImageFile,
  uploadLogo,
  deleteLogo,
  listLogos,
} from '../store/editorStore';
import { StyleControls } from './ContextToolbar';
import { ElementView, PageBackground } from './ElementView';
import { starClipPath } from '../domain/shapes';
import { getImage, getImageSync, preloadAssets, useImageVersion } from '../render/imageCache';
import { getByIndex, STORES } from '../data/db';
import type { Asset } from '../domain/types';

type TabId = 'templates' | 'text' | 'uploads' | 'logos' | 'elements' | 'style';

const TABS: { id: TabId; label: string }[] = [
  { id: 'templates', label: 'Templates' },
  { id: 'text', label: 'Text' },
  { id: 'uploads', label: 'Images' },
  { id: 'logos', label: 'Logos' },
  { id: 'elements', label: 'Elements' },
  { id: 'style', label: 'Style' },
];

export function LeftPanel() {
  const [tab, setTab] = useState<TabId>('templates');

  return (
    <aside className="left-panel" aria-label="Design library">
      <div className="tabs" role="tablist" aria-label="Library sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const idx = TABS.findIndex((x) => x.id === tab);
              if (e.key === 'ArrowRight') setTab(TABS[(idx + 1) % TABS.length].id);
              if (e.key === 'ArrowLeft') setTab(TABS[(idx - 1 + TABS.length) % TABS.length].id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="panel-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'text' && <TextTab />}
        {tab === 'uploads' && <UploadsTab />}
        {tab === 'logos' && <LogosTab />}
        {tab === 'elements' && <ElementsTab />}
        {tab === 'style' && <StyleControls />}
      </div>
    </aside>
  );
}

// --- Templates -------------------------------------------------------------

export function TemplatePreview({ tpl }: { tpl: TemplateDef }) {
  const maxW = 200;
  const scale = maxW / tpl.width;
  return (
    <span className="tpl-preview" style={{ width: maxW, height: tpl.height * scale }} aria-hidden="true">
      <span
        className="tpl-canvas"
        style={{
          width: tpl.width,
          height: tpl.height,
          transform: `scale(${scale})`,
        }}
      >
        <PageBackground background={tpl.background} width={tpl.width} height={tpl.height} />
        {tpl.elements.map((te, i) => (
          <ElementView
            key={i}
            staticView
            el={{
              id: `prev-${i}`,
              pageId: 'prev',
              type: te.type,
              x: te.x,
              y: te.y,
              width: te.width,
              height: te.height,
              rotation: te.rotation ?? 0,
              opacity: te.opacity ?? 1,
              order: i,
              content: te.content,
              style: te.style,
            }}
          />
        ))}
      </span>
    </span>
  );
}

function TemplatesTab() {
  const createDesign = useEditor((s) => s.createDesign);
  const askConfirm = useEditor((s) => s.askConfirm);
  const view = useEditor((s) => s.view);

  const startFromTemplate = async (tpl: TemplateDef) => {
    if (view === 'editor') {
      const ok = await askConfirm(
        'Start a new design?',
        `“${tpl.name}” opens as a new design. Your current design is saved first.`,
        'Open template',
      );
      if (!ok) return;
    }
    await createDesign({ width: tpl.width, height: tpl.height, title: tpl.name, templateId: tpl.id });
  };

  return (
    <div className="tpl-grid">
      <p className="panel-note">Six original layouts — click one to start a new design from it.</p>
      {TEMPLATES.map((tpl) => (
        <button key={tpl.id} type="button" className="tpl-card" onClick={() => void startFromTemplate(tpl)}>
          <TemplatePreview tpl={tpl} />
          <span className="tpl-meta">
            <strong>{tpl.name}</strong>
            <small>
              {tpl.category} · {tpl.width}×{tpl.height}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}

// --- Text ------------------------------------------------------------------

function TextTab() {
  const addText = useEditor((s) => s.addText);
  const selected = useSelectedElement();
  const patchSelected = useEditor((s) => s.patchSelected);
  const toast = useEditor((s) => s.toast);
  const doc = useEditor((s) => s.doc);
  const unit = doc ? Math.min(doc.design.width, doc.design.height) : 1080;

  const presets = [
    { id: 'h1', label: 'Add a heading', size: Math.round(unit * 0.1), weight: 700, fontFamily: 'Space Grotesk', text: 'Add a heading' },
    { id: 'h2', label: 'Add a subheading', size: Math.round(unit * 0.06), weight: 600, fontFamily: 'Inter', text: 'Add a subheading' },
    { id: 'body', label: 'Add body text', size: Math.round(unit * 0.03), weight: 400, fontFamily: 'Inter', text: 'Add some body text' },
  ];

  const applyFont = (family: string) => {
    if (!selected || selected.type !== 'text') {
      toast('info', 'Select a text object first, then tap a font to apply it.');
      return;
    }
    const cur = selected.style as TextStyle;
    patchSelected({
      style: { ...cur, fontFamily: family, fontWeight: nearestWeight(family, cur.fontWeight) },
    });
  };

  const activeFamily = selected?.type === 'text' ? (selected.style as TextStyle).fontFamily : null;

  return (
    <div className="text-tab">
      <p className="panel-note">Click to drop text on the page, then edit it in place (double-click).</p>
      {presets.map((p) => (
        <button
          key={p.id}
          type="button"
          className="text-preset"
          style={{ fontFamily: `"${p.fontFamily}", sans-serif`, fontWeight: p.weight }}
          onClick={() => addText({ size: p.size, weight: p.weight, fontFamily: p.fontFamily, text: p.text })}
        >
          {p.label}
        </button>
      ))}

      <h3 className="panel-heading">Font gallery — {FONTS.length} bundled fonts</h3>
      <p className="panel-note">All openly licensed (OFL), bundled locally. Select text, then tap to apply.</p>
      <div className="font-gallery">
        {FONT_CATEGORIES.map((cat) => (
          <div key={cat} className="font-cat">
            <h4 className="font-cat-title">{cat}</h4>
            <div className="font-cat-grid">
              {FONTS.filter((f) => f.category === cat).map((f) => (
                <button
                  key={f.family}
                  type="button"
                  className={`font-card${activeFamily === f.family ? ' is-active' : ''}`}
                  style={{ fontFamily: `"${f.family}", sans-serif` }}
                  onClick={() => applyFont(f.family)}
                  aria-pressed={activeFamily === f.family}
                  title={`Apply ${f.family}`}
                >
                  <span className="font-card-aa" aria-hidden="true">
                    Aa
                  </span>
                  <span className="font-card-name">{f.family}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Elements --------------------------------------------------------------

function ShapeGlyph({ shape, fill }: { shape: string; fill: string }) {
  const common = { background: fill };
  if (shape === 'ellipse') return <span className="glyph" style={{ ...common, borderRadius: '50%' }} />;
  if (shape === 'triangle') return <span className="glyph" style={{ ...common, clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }} />;
  if (shape === 'star') return <span className="glyph" style={{ ...common, clipPath: starClipPath(48, 48) }} />;
  if (shape === 'line') return <span className="glyph glyph-line" style={{ background: fill }} />;
  return <span className="glyph" style={common} />;
}

function ElementsTab() {
  const addShape = useEditor((s) => s.addShape);
  const shapes: { id: string; label: string; kind: 'rect' | 'ellipse' | 'triangle' | 'star' | 'line' }[] = [
    { id: 'rect', label: 'Rectangle', kind: 'rect' },
    { id: 'ellipse', label: 'Ellipse', kind: 'ellipse' },
    { id: 'triangle', label: 'Triangle', kind: 'triangle' },
    { id: 'star', label: 'Star', kind: 'star' },
    { id: 'line', label: 'Line', kind: 'line' },
  ];
  return (
    <div className="elements-tab">
      <p className="panel-note">Geometric shapes — recolor and reshape them from the toolbar.</p>
      <div className="shape-grid">
        {shapes.map((s) => (
          <button key={s.id} type="button" className="shape-card" onClick={() => addShape(s.kind)} aria-label={`Add ${s.label}`}>
            <ShapeGlyph shape={s.kind} fill="#12B5A9" />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      <h3 className="panel-heading">Palette shortcuts</h3>
      <div className="palette-row">
        <div className="palette-swatches">
          {PALETTES.flatMap((p) => p.colors.slice(0, 2)).slice(0, 8).map((c, i) => (
            <span key={i} className="swatch swatch-static" style={{ background: c }} title={c} />
          ))}
        </div>
      </div>
      <p className="panel-note">Add a shape, then use Style → palettes to color it.</p>
    </div>
  );
}

// --- Uploads ---------------------------------------------------------------

interface AssetTile {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

function UploadsTab() {
  const doc = useEditor((s) => s.doc);
  const addImageElement = useEditor((s) => s.addImageElement);
  const toast = useEditor((s) => s.toast);
  const askConfirm = useEditor((s) => s.askConfirm);
  const [tiles, setTiles] = useState<AssetTile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useImageVersion();

  const refresh = useCallback(async () => {
    if (!doc) return;
    try {
      const assets = await getByIndex<Asset>(STORES.assets, 'designId', doc.design.id);
      const out: AssetTile[] = [];
      for (const a of assets) {
        const img = await getImage(a.id);
        out.push({
          id: a.id,
          name: a.name,
          url: img?.src ?? '',
          width: img?.naturalWidth ?? 0,
          height: img?.naturalHeight ?? 0,
        });
      }
      setTiles(out.reverse());
    } catch {
      /* list will retry on next action */
    }
  }, [doc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const { assetId, width, height } = await uploadImageFile(file);
        addImageElement(assetId, width, height);
      }
      toast('success', files.length === 1 ? 'Image added to the page.' : `${files.length} images added.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeAsset = async (id: string) => {
    if (!doc) return;
    const referenced = doc.elements.some((e) => e.type === 'image' && (e.content as { assetId: string }).assetId === id);
    if (referenced) {
      toast('info', 'That image is used on your canvas — delete the object first.');
      return;
    }
    const ok = await askConfirm('Delete this upload?', 'The stored copy will be removed from this browser.', 'Delete');
    if (!ok) return;
    try {
      const { deleteKeys } = await import('../data/db');
      await deleteKeys(STORES.assets, [id]);
      await refresh();
      toast('success', 'Upload removed.');
    } catch {
      toast('error', 'Could not remove that upload.');
    }
  };

  if (!doc) return null;

  return (
    <div className="uploads-tab">
      <div
        className={`dropzone${dragOver ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <p>{busy ? 'Uploading…' : 'Drag images here, or'}</p>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Uploading…' : 'Choose files'}
        </button>
        <p className="panel-note">PNG, JPEG or WebP · max 15 MB · max 12000px</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          aria-label="Upload images"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {tiles.length === 0 ? (
        <div className="empty-mini">
          <p>No uploads yet.</p>
          <p className="panel-note">Images you add stay saved in this browser, inside your design.</p>
        </div>
      ) : (
        <ul className="asset-grid">
          {tiles.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="asset-tile"
                title={`Add ${t.name} to the page`}
                onClick={() => {
                  if (t.width && t.height) addImageElement(t.id, t.width, t.height);
                  else toast('error', 'That image is not ready yet.');
                }}
              >
                {t.url ? <img src={t.url} alt={t.name} /> : <span className="asset-fallback">{t.name}</span>}
              </button>
              <button
                type="button"
                className="asset-remove"
                aria-label={`Remove upload ${t.name}`}
                title="Remove upload"
                onClick={() => void removeAsset(t.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Logos -----------------------------------------------------------------

interface LogoTile {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

function LogosTab() {
  const addLogoElement = useEditor((s) => s.addLogoElement);
  const toast = useEditor((s) => s.toast);
  const askConfirm = useEditor((s) => s.askConfirm);
  const [tiles, setTiles] = useState<LogoTile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useImageVersion();

  const refresh = useCallback(async () => {
    try {
      const assets = await listLogos();
      await preloadAssets(assets);
      const out: LogoTile[] = [];
      for (const a of assets) {
        const img = getImageSync(a.id);
        out.push({
          id: a.id,
          name: a.name,
          url: img?.src ?? '',
          width: img?.naturalWidth ?? 0,
          height: img?.naturalHeight ?? 0,
        });
      }
      setTiles(out.reverse());
    } catch {
      /* retried on next action */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await uploadLogo(file);
      }
      toast('success', files.length === 1 ? 'Logo saved to your library.' : `${files.length} logos saved.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const placeLogo = (t: LogoTile) => {
    if (t.width && t.height) addLogoElement(t.id, t.width, t.height);
    else toast('error', 'That logo is not decoded yet — try again in a moment.');
  };

  const removeLogo = async (t: LogoTile) => {
    const ok = await askConfirm(
      'Remove this logo?',
      `“${t.name}” will be deleted from your library. Copies already placed in designs will show as unavailable.`,
      'Remove',
    );
    if (!ok) return;
    try {
      await deleteLogo(t.id);
      await refresh();
      toast('success', 'Logo removed.');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not remove that logo.');
    }
  };

  return (
    <div className="logos-tab">
      <p className="panel-note">
        Your logo library is shared across every design. Upload once, then tap a logo to place it.
      </p>

      <div
        className={`dropzone${dragOver ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <p>{busy ? 'Saving…' : 'Drop your logo here, or'}</p>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Saving…' : 'Choose logo file'}
        </button>
        <p className="panel-note">Transparent PNG works best · max 15 MB</p>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          aria-label="Upload logo files"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {tiles.length === 0 ? (
        <div className="empty-mini">
          <p>No logos yet.</p>
          <p className="panel-note">Upload your brand mark to reuse it across designs.</p>
        </div>
      ) : (
        <ul className="asset-grid logo-grid">
          {tiles.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="asset-tile logo-tile"
                title={`Place ${t.name} on the page`}
                onClick={() => placeLogo(t)}
              >
                {t.url ? <img src={t.url} alt={t.name} /> : <span className="asset-fallback">{t.name}</span>}
              </button>
              <button
                type="button"
                className="asset-remove"
                aria-label={`Remove logo ${t.name}`}
                title="Remove logo"
                onClick={() => void removeLogo(t)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
