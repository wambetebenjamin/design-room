// Contextual controls above the canvas: page background when nothing is
// selected, otherwise position/size plus type-specific controls.

import { useEffect, useRef, useState } from 'react';
import type { DesignElement, ImageCrop, ShapeKind, ShapeStyle, TextStyle } from '../domain/types';
import { fitCropToFrame } from '../domain/crop';
import { getImageSync } from '../render/imageCache';
import { useEditor, useSelectedElement, useCurrentPage } from '../store/editorStore';
import type { Page } from '../domain/types';
import { FONTS } from '../domain/templates';
import { PALETTES, DESIGN_PRESETS } from '../domain/palettes';
import { backgroundToCss, setBackground } from '../domain/document';

function NumField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  onFocus,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  onFocus?: () => void;
}) {
  const [local, setLocal] = useState(String(Math.round(value * 100) / 100));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(String(Math.round(value * 100) / 100));
  }, [value]);
  return (
    <label className="field field-num">
      <span className="field-label">{label}</span>
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        step={step}
        onFocus={() => {
          focused.current = true;
          onFocus?.();
        }}
        onChange={(e) => {
          setLocal(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        onBlur={() => {
          focused.current = false;
          onCommit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

export function ContextToolbar() {
  const doc = useEditor((s) => s.doc);
  const selected = useSelectedElement();
  const page = useCurrentPage();
  const patchSelected = useEditor((s) => s.patchSelected);
  const patchSelectedLive = useEditor((s) => s.patchSelectedLive);
  const beginTx = useEditor((s) => s.beginTx);
  const endTx = useEditor((s) => s.endTx);
  const layerSelected = useEditor((s) => s.layerSelected);
  const alignSelected = useEditor((s) => s.alignSelected);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const setPageBackground = useEditor((s) => s.setPageBackground);
  const setCropMode = useEditor((s) => s.setCropMode);
  const cropMode = useEditor((s) => s.cropMode);
  const askConfirm = useEditor((s) => s.askConfirm);
  const updateLive = useEditor((s) => s.updateLive);

  const patchPageBackgroundLive = (bg: Page['background']) => {
    if (!page) return;
    updateLive((d) => setBackground(d, page.id, bg));
  };

  if (!doc || !page) return null;

  // --- No selection: page controls ---------------------------------------
  if (!selected) {
    const bgCss = backgroundToCss(page.background);
    const solid = typeof page.background === 'string' ? page.background : '#ffffff';
    return (
      <div className="ctxbar" role="toolbar" aria-label="Page controls">
        <span className="ctx-label">Page {page.order + 1} background</span>
        <label className="field field-color">
          <span className="sr-only">Page background color</span>
          <input
            type="color"
            value={solid}
            aria-label="Page background color"
            onFocus={beginTx}
            onBlur={endTx}
            onChange={(e) => patchPageBackgroundLive(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setPageBackground({ angle: 135, from: '#0B7A70', to: '#12B5A9' })}
          title="Apply a turquoise gradient"
        >
          Gradient
        </button>
        <span className="ctx-sep" aria-hidden="true" />
        <span className="ctx-dim">
          {doc.design.width} × {doc.design.height}px — select an object to edit it
        </span>
        <span className="ctx-sep" aria-hidden="true" />
        <span className="ctx-label">Quick colors</span>
        {PALETTES[0].colors.slice(0, 4).map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            style={{ background: c }}
            title={`Set background ${c}`}
            aria-label={`Set page background ${c}`}
            onClick={() => setPageBackground(c)}
          />
        ))}
        <span className="ctx-hint" style={{ marginLeft: 'auto', background: bgCss, opacity: 0 }} aria-hidden="true" />
      </div>
    );
  }

  // --- Selected element ----------------------------------------------------
  const isText = selected.type === 'text';
  const isShape = selected.type === 'shape';
  const isImage = selected.type === 'image';
  const textStyle = isText ? (selected.style as TextStyle) : null;

  const setGeom = (patch: Partial<DesignElement>) => patchSelected(patch);
  const setStyle = (patch: Record<string, unknown>, live = false) => {
    if (!selected) return;
    const next = { ...(selected.style as object), ...patch };
    if (live) patchSelectedLive({ style: next as never });
    else patchSelected({ style: next as never });
  };

  const onDelete = async () => {
    const ok = await askConfirm(
      'Delete this object?',
      'It will be removed from the page. You can undo this with Ctrl+Z.',
      'Delete',
    );
    if (ok) deleteSelected();
  };

  return (
    <div className="ctxbar" role="toolbar" aria-label="Object controls">
      {/* position / size / rotation — grouped as one undo step per focus session */}
      <NumField label="X" value={selected.x} min={-20000} max={20000} onFocus={beginTx} onChange={(v) => patchSelectedLive({ x: v })} onCommit={endTx} />
      <NumField label="Y" value={selected.y} min={-20000} max={20000} onFocus={beginTx} onChange={(v) => patchSelectedLive({ y: v })} onCommit={endTx} />
      <NumField label="W" value={selected.width} min={8} max={20000} onFocus={beginTx} onChange={(v) => patchSelectedLive({ width: v })} onCommit={endTx} />
      {!isText && (
        <NumField label="H" value={selected.height} min={2} max={20000} onFocus={beginTx} onChange={(v) => patchSelectedLive({ height: v })} onCommit={endTx} />
      )}
      <NumField
        label="°"
        value={selected.rotation}
        min={-180}
        max={180}
        onFocus={beginTx}
        onChange={(v) => patchSelectedLive({ rotation: v })}
        onCommit={endTx}
      />

      <label className="field field-range">
        <span className="field-label">Opacity</span>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(selected.opacity * 100)}
          aria-label="Opacity percent"
          onPointerDown={beginTx}
          onPointerUp={endTx}
          onChange={(e) => patchSelectedLive({ opacity: Number(e.target.value) / 100 })}
        />
        <span className="range-value">{Math.round(selected.opacity * 100)}%</span>
      </label>

      <span className="ctx-sep" aria-hidden="true" />

      {isText && textStyle && <TextControls style={textStyle} setStyle={setStyle} beginTx={beginTx} endTx={endTx} />}
      {isShape && <ShapeControls el={selected} setStyle={setStyle} />}
      {isImage && (
        <>
          <button
            type="button"
            className={`btn btn-sm ${cropMode ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => {
              if (!cropMode) {
                // Normalise the crop before entering crop mode so drag/scale
                // always starts from a covering crop.
                const content = selected.content as { assetId: string; crop: ImageCrop | null };
                const img = getImageSync(content.assetId);
                if (img) {
                  const fitted = fitCropToFrame(
                    content.crop,
                    img.naturalWidth,
                    img.naturalHeight,
                    selected.width,
                    selected.height,
                  );
                  const cur = content.crop;
                  if (!cur || cur.s !== fitted.s || cur.ox !== fitted.ox || cur.oy !== fitted.oy) {
                    patchSelected({ content: { ...content, crop: fitted } as never });
                  }
                }
              }
              setCropMode(!cropMode);
            }}
            aria-pressed={cropMode}
          >
            {cropMode ? 'Done cropping' : 'Crop'}
          </button>
          <label className="field field-range">
            <span className="field-label">Corners</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(((selected.style as { radius: number }).radius ?? 0) / Math.min(selected.width, selected.height) * 200)}
              aria-label="Corner radius"
              onPointerDown={beginTx}
              onPointerUp={endTx}
              onChange={(e) => {
                const pct = Number(e.target.value) / 200;
                patchSelectedLive({ style: { ...(selected.style as object), radius: pct * Math.min(selected.width, selected.height) } as never });
              }}
            />
          </label>
        </>
      )}

      <span className="ctx-sep" aria-hidden="true" />

      {/* layering */}
      <button type="button" className="btn btn-icon" onClick={() => layerSelected('front')} aria-label="Bring to front" title="Bring to front">
        ⤒
      </button>
      <button type="button" className="btn btn-icon" onClick={() => layerSelected('forward')} aria-label="Bring forward" title="Bring forward">
        ↑
      </button>
      <button type="button" className="btn btn-icon" onClick={() => layerSelected('backward')} aria-label="Send backward" title="Send backward">
        ↓
      </button>
      <button type="button" className="btn btn-icon" onClick={() => layerSelected('back')} aria-label="Send to back" title="Send to back">
        ⤓
      </button>

      <span className="ctx-sep" aria-hidden="true" />

      {/* align to page (keyboard-accessible alternative to dragging) */}
      <button type="button" className="btn btn-icon" onClick={() => alignSelected('left')} aria-label="Align to left edge" title="Align left">
        ⇤
      </button>
      <button type="button" className="btn btn-icon" onClick={() => alignSelected('centerH')} aria-label="Center horizontally" title="Center horizontally">
        ↔
      </button>
      <button type="button" className="btn btn-icon" onClick={() => alignSelected('right')} aria-label="Align to right edge" title="Align right">
        ⇥
      </button>
      <button type="button" className="btn btn-icon" onClick={() => alignSelected('top')} aria-label="Align to top edge" title="Align top">
        ⇧
      </button>
      <button type="button" className="btn btn-icon" onClick={() => alignSelected('middleV')} aria-label="Center vertically" title="Center vertically">
        ↕
      </button>
      <button type="button" className="btn btn-icon" onClick={() => alignSelected('bottom')} aria-label="Align to bottom edge" title="Align bottom">
        ⇩
      </button>

      <span className="ctx-sep" aria-hidden="true" />

      <button type="button" className="btn btn-icon" onClick={duplicateSelected} aria-label="Duplicate object" title="Duplicate (Ctrl+D)">
        ⧉
      </button>
      <button type="button" className="btn btn-icon btn-danger" onClick={() => void onDelete()} aria-label="Delete object" title="Delete (Del)">
        🗑
      </button>
    </div>
  );
}

function TextControls({
  style,
  setStyle,
  beginTx,
  endTx,
}: {
  style: TextStyle;
  setStyle: (patch: Record<string, unknown>, live?: boolean) => void;
  beginTx: () => void;
  endTx: () => void;
}) {
  const selected = useSelectedElement();
  const [content, setContent] = useState((selected?.content as { text: string })?.text ?? '');
  useEffect(() => {
    setContent((selected?.content as { text: string })?.text ?? '');
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const font = FONTS.find((f) => f.family === style.fontFamily) ?? FONTS[0];

  return (
    <>
      <label className="field">
        <span className="sr-only">Text content</span>
        <input
          className="text-content-input"
          type="text"
          value={content}
          placeholder="Text…"
          aria-label="Text content"
          onFocus={beginTx}
          onBlur={() => {
            endTx();
            if (selected) {
              const cur = useEditor.getState().doc?.elements.find((e) => e.id === selected.id);
              const curText = (cur?.content as { text: string })?.text;
              if (curText !== content) useEditor.getState().patchSelected({ content: { text: content } });
            }
          }}
          onChange={(e) => {
            setContent(e.target.value);
            useEditor.getState().patchSelectedLive({ content: { text: e.target.value } });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          }}
        />
      </label>

      <label className="field">
        <span className="sr-only">Font family</span>
        <select
          value={style.fontFamily}
          aria-label="Font family"
          onChange={(e) => setStyle({ fontFamily: e.target.value })}
        >
          {FONTS.map((f) => (
            <option key={f.family} value={f.family}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="sr-only">Font weight</span>
        <select
          value={style.fontWeight}
          aria-label="Font weight"
          onChange={(e) => setStyle({ fontWeight: Number(e.target.value) })}
        >
          {font.weights.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>

      <NumField
        label="Size"
        value={style.fontSize}
        min={4}
        max={2000}
        onFocus={beginTx}
        onChange={(v) => setStyle({ fontSize: v }, true)}
        onCommit={endTx}
      />

      <label className="field field-color">
        <span className="sr-only">Text color</span>
        <input
          type="color"
          value={style.color}
          aria-label="Text color"
          onFocus={beginTx}
          onBlur={endTx}
          onChange={(e) => setStyle({ color: e.target.value }, true)}
        />
      </label>

      <div className="btn-group" role="group" aria-label="Text alignment">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={`btn btn-icon${style.align === a ? ' is-active' : ''}`}
            aria-pressed={style.align === a}
            aria-label={`Align text ${a}`}
            title={`Align ${a}`}
            onClick={() => setStyle({ align: a })}
          >
            {a === 'left' ? '☰' : a === 'center' ? '≡' : '☰'}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`btn btn-icon${style.italic ? ' is-active' : ''}`}
        aria-pressed={style.italic}
        aria-label="Italic"
        title="Italic"
        onClick={() => setStyle({ italic: !style.italic })}
      >
        <em>I</em>
      </button>

      <NumField
        label="Line"
        value={style.lineHeight}
        min={0.5}
        max={4}
        step={0.05}
        onFocus={beginTx}
        onChange={(v) => setStyle({ lineHeight: v }, true)}
        onCommit={endTx}
      />
      <NumField
        label="Track"
        value={style.letterSpacing}
        min={0}
        max={200}
        onFocus={beginTx}
        onChange={(v) => setStyle({ letterSpacing: v }, true)}
        onCommit={endTx}
      />
    </>
  );
}

function ShapeControls({
  el,
  setStyle,
}: {
  el: DesignElement;
  setStyle: (patch: Record<string, unknown>, live?: boolean) => void;
}) {
  const style = el.style as { shape: ShapeKind; fill: string; radius: number };
  return (
    <>
      <label className="field">
        <span className="sr-only">Shape kind</span>
        <select
          value={style.shape}
          aria-label="Shape kind"
          onChange={(e) => setStyle({ shape: e.target.value })}
        >
          <option value="rect">Rectangle</option>
          <option value="ellipse">Ellipse</option>
          <option value="triangle">Triangle</option>
          <option value="star">Star</option>
          <option value="line">Line</option>
        </select>
      </label>
      <label className="field field-color">
        <span className="sr-only">Fill color</span>
        <input
          type="color"
          value={style.fill.length === 7 ? style.fill : '#12b5a9'}
          aria-label="Fill color"
          onFocus={() => useEditor.getState().beginTx()}
          onBlur={() => useEditor.getState().endTx()}
          onChange={(e) => setStyle({ fill: e.target.value }, true)}
        />
      </label>
      {style.shape === 'rect' && (
        <label className="field field-range">
          <span className="field-label">Radius</span>
          <input
            type="range"
            min={0}
            max={50}
            value={Math.min(50, style.radius)}
            aria-label="Corner radius"
            onChange={(e) => setStyle({ radius: Number(e.target.value) }, true)}
          />
        </label>
      )}
      <span className="ctx-label">Palettes</span>
      {PALETTES[0].colors.slice(0, 4).map((c) => (
        <button
          key={c}
          type="button"
          className="swatch"
          style={{ background: c }}
          title={`Fill ${c}`}
          aria-label={`Fill color ${c}`}
          onClick={() => setStyle({ fill: c })}
        />
      ))}
    </>
  );
}

/** Style tab content: palettes + page presets (shared with the left panel). */
export function StyleControls() {
  const selected = useSelectedElement();
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const patchSelected = useEditor((s) => s.patchSelected);
  const setPageBackground = useEditor((s) => s.setPageBackground);
  const commit = useEditor((s) => s.commit);
  const toast = useEditor((s) => s.toast);

  const applyColor = (c: string) => {
    if (selected?.type === 'text') patchSelected({ style: { ...(selected.style as object), color: c } as never });
    else if (selected?.type === 'shape') patchSelected({ style: { ...(selected.style as object), fill: c } as never });
    else if (selected?.type === 'image') toast('info', 'Pick a text or shape object to recolor.');
    else setPageBackground(c);
  };

  const applyPreset = (presetId: string) => {
    const preset = DESIGN_PRESETS.find((p) => p.id === presetId);
    if (!doc || !preset || !currentPageId) return;
    commit((d) => {
      const pageEls = d.elements.filter((e) => e.pageId === currentPageId);
      const textEls = pageEls.filter((e) => e.type === 'text');
      const maxFont = textEls.reduce((m, e) => Math.max(m, (e.style as { fontSize: number }).fontSize), 0);
      let shapeIdx = 0;
      const elements: DesignElement[] = d.elements.map((e) => {
        if (e.pageId !== currentPageId) return e;
        if (e.type === 'text') {
          const s = e.style as TextStyle;
          const isDisplay = s.fontSize >= maxFont * 0.85 && maxFont > 0;
          const dark = isDarkBackground(d.pages.find((p) => p.id === currentPageId)!.background);
          return {
            ...e,
            style: {
              ...s,
              fontFamily: isDisplay ? preset.displayFont : preset.bodyFont,
              fontWeight: isDisplay ? 700 : s.fontWeight,
              color: dark ? '#FFFFFF' : '#111418',
            },
          };
        }
        if (e.type === 'shape') {
          const fill = preset.palette[shapeIdx % preset.palette.length];
          shapeIdx++;
          return { ...e, style: { ...(e.style as ShapeStyle), fill } };
        }
        return e;
      });
      return {
        ...d,
        elements,
        pages: d.pages.map((p) => (p.id === currentPageId ? { ...p, background: preset.background } : p)),
      };
    });
    toast('success', `Applied “${preset.name}” to this page.`);
  };

  return (
    <div className="style-controls">
      <h3 className="panel-heading">Color palettes</h3>
      {PALETTES.map((p) => (
        <div key={p.id} className="palette-row">
          <span className="palette-name">{p.name}</span>
          <div className="palette-swatches">
            {p.colors.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                style={{ background: c }}
                title={`Apply ${c}`}
                aria-label={`Apply color ${c} from ${p.name} palette`}
                onClick={() => applyColor(c)}
              />
            ))}
          </div>
        </div>
      ))}
      <h3 className="panel-heading">Design presets</h3>
      <p className="panel-note">Recolors the current page and pairs fonts by role.</p>
      <div className="preset-grid">
        {DESIGN_PRESETS.map((p) => (
          <button key={p.id} type="button" className="preset-card" onClick={() => applyPreset(p.id)}>
            <span
              className="preset-preview"
              style={{ background: backgroundToCss(p.background) }}
              aria-hidden="true"
            >
              {p.palette.slice(0, 4).map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
            </span>
            <span className="preset-name">{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function isDarkBackground(bg: string | { angle: number; from: string; to: string }): boolean {
  const hex = typeof bg === 'string' ? bg : bg.from;
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}
