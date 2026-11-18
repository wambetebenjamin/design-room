// The centered canvas: zoom, page rendering, selection chrome and direct
// manipulation (move, resize, rotate, crop) plus inline text editing.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DesignElement, ImageCrop } from '../domain/types';
import { elementsOfPage } from '../domain/document';
import { clampOffset, coverScale, moveCrop, scaleCrop } from '../domain/crop';
import { useEditor } from '../store/editorStore';
import { ElementView, PageBackground } from './ElementView';
import { getImageSync, useImageVersion } from '../render/imageCache';

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

interface DragState {
  kind: 'move' | 'resize' | 'rotate' | 'crop-move' | 'crop-scale';
  handle?: HandleId;
  pointerId: number;
  startX: number;
  startY: number;
  startEl: DesignElement;
  startCrop: ImageCrop | null;
  startDist: number;
  anchor: { x: number; y: number } | null;
}

const HANDLES: { id: HandleId; cx: number; cy: number; label: string }[] = [
  { id: 'nw', cx: 0, cy: 0, label: 'Top left' },
  { id: 'n', cx: 0.5, cy: 0, label: 'Top' },
  { id: 'ne', cx: 1, cy: 0, label: 'Top right' },
  { id: 'e', cx: 1, cy: 0.5, label: 'Right' },
  { id: 'se', cx: 1, cy: 1, label: 'Bottom right' },
  { id: 's', cx: 0.5, cy: 1, label: 'Bottom' },
  { id: 'sw', cx: 0, cy: 1, label: 'Bottom left' },
  { id: 'w', cx: 0, cy: 0.5, label: 'Left' },
];

function handleSigns(id: HandleId): { sx: number; sy: number } {
  const sx = id.includes('w') ? -1 : id.includes('e') ? 1 : 0;
  const sy = id.includes('n') ? -1 : id.includes('s') ? 1 : 0;
  return { sx, sy };
}

export function CanvasStage() {
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const selectionId = useEditor((s) => s.selectionId);
  const cropMode = useEditor((s) => s.cropMode);
  const zoomSetting = useEditor((s) => s.zoom);
  const editingTextId = useEditor((s) => s.editingTextId);
  const select = useEditor((s) => s.select);
  const setZoom = useEditor((s) => s.setZoom);
  const beginTx = useEditor((s) => s.beginTx);
  const endTx = useEditor((s) => s.endTx);
  const updateLive = useEditor((s) => s.updateLive);
  const setEditingText = useEditor((s) => s.setEditingText);
  const setCropMode = useEditor((s) => s.setCropMode);
  useImageVersion();

  const stageRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [fitZoom, setFitZoom] = useState(0.5);

  const page = doc ? doc.pages.find((p) => p.id === currentPageId) ?? null : null;
  const elements = useMemo(
    () => (doc && page ? elementsOfPage(doc, page.id) : []),
    [doc, page],
  );
  const selected = selectionId ? elements.find((e) => e.id === selectionId) ?? null : null;
  const zoom = zoomSetting === 'fit' ? fitZoom : zoomSetting;

  // Fit-to-screen zoom, recomputed when the stage resizes.
  useLayoutEffect(() => {
    if (!doc || zoomSetting !== 'fit') return;
    const el = stageRef.current;
    if (!el) return;
    const compute = () => {
      const pad = 48;
      const zw = (el.clientWidth - pad) / doc.design.width;
      const zh = (el.clientHeight - pad) / doc.design.height;
      setFitZoom(Math.max(0.02, Math.min(4, Math.min(zw, zh))));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc, zoomSetting, doc?.design.width, doc?.design.height]);

  // --- Pointer helpers -----------------------------------------------------

  const docPoint = useCallback((clientX: number, clientY: number) => {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  }, [zoom]);

  const onElementPointerDown = (e: React.PointerEvent, el: DesignElement) => {
    if (editingTextId) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    if (selectionId !== el.id) select(el.id);
    if (cropMode && el.type === 'image') return; // handled by crop view
    beginTx();
    dragRef.current = {
      kind: 'move',
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startEl: el,
      startCrop: null,
      startDist: 0,
      anchor: null,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onHandlePointerDown = (e: React.PointerEvent, el: DesignElement, handle: HandleId) => {
    e.stopPropagation();
    e.preventDefault();
    beginTx();
    const center = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    const p = docPoint(e.clientX, e.clientY);
    dragRef.current = {
      kind: handle === 'rotate' ? 'rotate' : 'resize',
      handle,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startEl: el,
      startCrop: null,
      startDist: 0,
      anchor: null,
    };
    void center;
    void p;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onGlobalPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const st = useEditor.getState();
    const docNow = st.doc;
    if (!drag || !docNow) return;

    if (drag.kind === 'move') {
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      const el = drag.startEl;
      st.updateLive((d) => ({
        ...d,
        elements: d.elements.map((x) =>
          x.id === el.id ? { ...x, x: Math.round((el.x + dx) * 10) / 10, y: Math.round((el.y + dy) * 10) / 10 } : x,
        ),
      }));
      return;
    }

    if (drag.kind === 'rotate') {
      const el = drag.startEl;
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const p = docPoint(e.clientX, e.clientY);
      let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (deg > 180) deg -= 360;
      if (deg <= -180) deg += 360;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      st.updateLive((d) => ({
        ...d,
        elements: d.elements.map((x) => (x.id === el.id ? { ...x, rotation: Math.round(deg * 10) / 10 } : x)),
      }));
      return;
    }

    if (drag.kind === 'resize') {
      const el = drag.startEl;
      const { sx, sy } = handleSigns(drag.handle!);
      const dxW = (e.clientX - drag.startX) / zoom;
      const dyW = (e.clientY - drag.startY) / zoom;
      const th = (-el.rotation * Math.PI) / 180;
      const dxL = dxW * Math.cos(th) - dyW * Math.sin(th);
      const dyL = dxW * Math.sin(th) + dyW * Math.cos(th);

      let w = sx === 0 ? el.width : el.width + sx * dxL;
      let h = sy === 0 ? el.height : el.height + sy * dyL;
      const minW = el.type === 'text' ? 24 : 8;
      const minH = el.type === 'text' ? el.style && 'fontSize' in el.style ? (el.style as { fontSize: number }).fontSize * 0.6 : 8 : 8;
      w = Math.max(minW, w);
      h = Math.max(minH, h);
      if (e.shiftKey && sx !== 0 && sy !== 0) {
        const r = Math.max(w / el.width, h / el.height);
        w = el.width * r;
        h = el.height * r;
      }

      // Keep the anchored corner fixed in world space (handles rotation).
      const tr = (el.rotation * Math.PI) / 180;
      const cos = Math.cos(tr);
      const sin = Math.sin(tr);
      const oStartX = sx > 0 ? -el.width / 2 : sx < 0 ? el.width / 2 : 0;
      const oStartY = sy > 0 ? -el.height / 2 : sy < 0 ? el.height / 2 : 0;
      const cX = el.x + el.width / 2;
      const cY = el.y + el.height / 2;
      const aX = cX + oStartX * cos - oStartY * sin;
      const aY = cY + oStartX * sin + oStartY * cos;
      const oNewX = sx > 0 ? -w / 2 : sx < 0 ? w / 2 : 0;
      const oNewY = sy > 0 ? -h / 2 : sy < 0 ? h / 2 : 0;
      const nCX = aX - (oNewX * cos - oNewY * sin);
      const nCY = aY - (oNewX * sin + oNewY * cos);

      st.updateLive((d) => ({
        ...d,
        elements: d.elements.map((x) =>
          x.id === el.id
            ? { ...x, width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10, x: Math.round((nCX - w / 2) * 10) / 10, y: Math.round((nCY - h / 2) * 10) / 10 }
            : x,
        ),
      }));
      return;
    }

    // Crop interactions
    if (drag.kind === 'crop-move' || drag.kind === 'crop-scale') {
      const el = drag.startEl;
      if (el.type !== 'image' || !drag.startCrop) return;
      const img = getImageSync((el.content as { assetId: string }).assetId);
      if (!img) return;
      const p = pointerToFrame(e, el, docPoint, zoom);
      if (drag.kind === 'crop-move') {
        const p0 = drag.anchor!;
        const next = moveCrop(
          drag.startCrop,
          p.x - p0.x,
          p.y - p0.y,
          img.naturalWidth,
          img.naturalHeight,
          el.width,
          el.height,
        );
        st.setImageCrop(next);
      } else {
        const anchor = drag.anchor!;
        const d0 = drag.startDist;
        const d = Math.hypot(p.x - anchor.x, p.y - anchor.y);
        if (d0 <= 0) return;
        const next = scaleCrop(
          drag.startCrop,
          d / d0,
          img.naturalWidth,
          img.naturalHeight,
          el.width,
          el.height,
        );
        st.setImageCrop(next);
      }
    }
  };

  const onGlobalPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture?.(drag.pointerId);
    } catch {
      /* pointer already released */
    }
    endTx();
  };

  // --- Inline text editing -------------------------------------------------

  const startTextEdit = (id: string) => {
    if (cropMode) setCropMode(false);
    beginTx();
    setEditingText(id);
  };

  const finishTextEdit = () => {
    if (!editingTextId) return;
    setEditingText(null);
    endTx();
  };

  useEffect(() => {
    // Escape exits crop mode / text editing before deselecting.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editingTextId) {
        (document.activeElement as HTMLElement | null)?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingTextId]);

  if (!doc || !page) {
    return (
      <div className="stage stage-empty" ref={stageRef}>
        <p className="stage-empty-msg">Loading canvas…</p>
      </div>
    );
  }

  const isCropSubject = cropMode && selected?.type === 'image';

  return (
    <div
      className="stage"
      ref={stageRef}
      onPointerMove={onGlobalPointerMove}
      onPointerUp={onGlobalPointerUp}
      onPointerCancel={onGlobalPointerUp}
    >
      <div className="stage-scroll">
        <div
          className="page-frame"
          style={{ width: doc.design.width * zoom, height: doc.design.height * zoom }}
        >
          <div
            ref={pageRef}
            className="page-inner"
            role="application"
            aria-label={`Design canvas, ${doc.design.width} by ${doc.design.height} pixels. Page ${page.order + 1} of ${doc.pages.length}.`}
            style={{
              width: doc.design.width,
              height: doc.design.height,
              transform: `scale(${zoom})`,
            }}
            onPointerDown={() => {
              if (!editingTextId) select(null);
            }}
          >
            <PageBackground background={page.background} width={doc.design.width} height={doc.design.height} />

            {elements.map((el) => {
              if (editingTextId === el.id) {
                return <EditableText key={el.id} el={el} onDone={finishTextEdit} />;
              }
              if (isCropSubject && selected?.id === el.id) {
                return (
                  <CropView
                    key={el.id}
                    el={el}
                    zoom={zoom}
                    docPoint={docPoint}
                    onDragStart={(e, kind, extra) => {
                      beginTx();
                      const img = getImageSync((el.content as { assetId: string }).assetId);
                      const crop = (el.content as { crop: ImageCrop | null }).crop;
                      dragRef.current = {
                        kind,
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                        startEl: el,
                        startCrop: crop,
                        startDist: extra?.dist ?? 0,
                        anchor: extra?.anchor ?? null,
                      };
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      void img;
                    }}
                  />
                );
              }
              return (
                <div
                  key={el.id}
                  className={`el-hit${selected?.id === el.id ? ' is-selected' : ''}`}
                  style={{
                    left: el.x,
                    top: el.y,
                    width: el.width,
                    height: el.height,
                    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={ariaLabelFor(el)}
                  aria-pressed={selected?.id === el.id}
                  onPointerDown={(e) => onElementPointerDown(e, el)}
                  onDoubleClick={() => {
                    if (el.type === 'text') startTextEdit(el.id);
                  }}
                  onFocus={() => {
                    if (selectionId !== el.id) select(el.id);
                  }}
                >
                  <ElementView el={el} embedded />
                </div>
              );
            })}

            {selected && !isCropSubject && !editingTextId && (
              <SelectionOverlay
                el={selected}
                zoom={zoom}
                onHandleDown={onHandlePointerDown}
              />
            )}
          </div>
        </div>
      </div>

      <div className="zoom-bar" role="group" aria-label="Zoom controls">
        <button type="button" className="btn btn-icon" aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(Math.max(0.05, Math.round((zoom - 0.1) * 100) / 100))}>
          −
        </button>
        <button type="button" className="btn btn-ghost zoom-label" title="Reset zoom to fit" onClick={() => setZoom('fit')}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="btn btn-icon" aria-label="Zoom in" title="Zoom in" onClick={() => setZoom(Math.min(4, Math.round((zoom + 0.1) * 100) / 100))}>
          +
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setZoom('fit')}>
          Fit
        </button>
      </div>

      {isCropSubject && selected && (
        <div className="crop-hint" role="status">
          Crop mode — drag the image to reposition, use the corners to rescale.
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCropMode(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function ariaLabelFor(el: DesignElement): string {
  if (el.type === 'text') {
    const t = (el.content as { text: string }).text.replace(/\s+/g, ' ').slice(0, 60);
    return `Text element: ${t}`;
  }
  if (el.type === 'shape') {
    return `Shape element: ${(el.style as { shape: string }).shape}`;
  }
  return 'Image element';
}

function pointerToFrame(
  e: { clientX: number; clientY: number },
  el: DesignElement,
  docPoint: (x: number, y: number) => { x: number; y: number },
  _zoom: number,
): { x: number; y: number } {
  const p = docPoint(e.clientX, e.clientY);
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const th = (-el.rotation * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const rx = dx * Math.cos(th) - dy * Math.sin(th);
  const ry = dx * Math.sin(th) + dy * Math.cos(th);
  return { x: rx + el.width / 2, y: ry + el.height / 2 };
}

// --- Selection chrome ------------------------------------------------------

function SelectionOverlay({
  el,
  zoom,
  onHandleDown,
}: {
  el: DesignElement;
  zoom: number;
  onHandleDown: (e: React.PointerEvent, el: DesignElement, handle: HandleId) => void;
}) {
  const s = 9 / zoom;
  const border = 2 / zoom;
  return (
    <div
      className="selection-box"
      aria-hidden="true"
      style={{
        left: el.x,
        top: el.y,
        width: el.width,
        height: el.height,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        borderWidth: border,
      }}
    >
      {HANDLES.map((h) => (
        <div
          key={h.id}
          className="handle"
          title={h.label}
          style={{
            width: s,
            height: s,
            left: `calc(${h.cx * 100}% - ${s / 2}px)`,
            top: `calc(${h.cy * 100}% - ${s / 2}px)`,
            borderWidth: Math.max(1, 1.5 / zoom),
          }}
          onPointerDown={(e) => onHandleDown(e, el, h.id)}
        />
      ))}
      <div
        className="handle handle-rotate"
        title="Rotate"
        style={{
          width: s,
          height: s,
          left: `calc(50% - ${s / 2}px)`,
          top: -30 / zoom,
          borderWidth: Math.max(1, 1.5 / zoom),
        }}
        onPointerDown={(e) => onHandleDown(e, el, 'rotate')}
      />
      <div className="rotate-stem" style={{ height: 30 / zoom, top: -30 / zoom, width: Math.max(1, 2 / zoom) }} />
    </div>
  );
}

// --- Crop view -------------------------------------------------------------

function CropView({
  el,
  zoom,
  docPoint,
  onDragStart,
}: {
  el: DesignElement;
  zoom: number;
  docPoint: (x: number, y: number) => { x: number; y: number };
  onDragStart: (
    e: React.PointerEvent,
    kind: 'crop-move' | 'crop-scale',
    extra?: { dist: number; anchor: { x: number; y: number } | null },
  ) => void;
}) {
  const content = el.content as { assetId: string; crop: ImageCrop | null };
  const img = getImageSync(content.assetId);
  useImageVersion();
  if (!img) return <ElementView el={el} />;

  const minS = coverScale(img.naturalWidth, img.naturalHeight, el.width, el.height);
  const crop = content.crop && content.crop.s >= minS ? content.crop : { ...content.crop ?? { ox: 0, oy: 0, s: minS } };
  const iw = img.naturalWidth * crop.s;
  const ih = img.naturalHeight * crop.s;
  const s = 11 / zoom;
  const corners: { id: string; x: number; y: number; anchor: { x: number; y: number } }[] = [
    { id: 'nw', x: crop.ox, y: crop.oy, anchor: { x: crop.ox + iw, y: crop.oy + ih } },
    { id: 'ne', x: crop.ox + iw, y: crop.oy, anchor: { x: crop.ox, y: crop.oy + ih } },
    { id: 'se', x: crop.ox + iw, y: crop.oy + ih, anchor: { x: crop.ox, y: crop.oy } },
    { id: 'sw', x: crop.ox, y: crop.oy + ih, anchor: { x: crop.ox + iw, y: crop.oy } },
  ];

  return (
    <div
      className="el el-image crop-root"
      style={{ left: el.x, top: el.y, width: el.width, height: el.height, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, opacity: el.opacity }}
    >
      <img
        src={img.src}
        alt=""
        draggable={false}
        className="crop-img"
        style={{ left: crop.ox, top: crop.oy, width: iw, height: ih }}
        onPointerDown={(e) => {
          e.stopPropagation();
          const p = pointerToFrame(e, el, docPoint, zoom);
          onDragStart(e, 'crop-move', { dist: 0, anchor: p });
        }}
      />
      {/* dim everything outside the frame */}
      {crop.oy > 0 && <div className="crop-dim" style={{ left: 0, top: 0, width: el.width, height: crop.oy }} />}
      {crop.oy + ih < el.height && (
        <div className="crop-dim" style={{ left: 0, top: crop.oy + ih, width: el.width, height: el.height - (crop.oy + ih) }} />
      )}
      {crop.ox > 0 && <div className="crop-dim" style={{ left: 0, top: crop.oy, width: crop.ox, height: ih }} />}
      {crop.ox + iw < el.width && (
        <div className="crop-dim" style={{ left: crop.ox + iw, top: crop.oy, width: el.width - (crop.ox + iw), height: ih }} />
      )}
      <div className="crop-frame" style={{ borderWidth: 2 / zoom }} />
      {corners.map((c) => (
        <div
          key={c.id}
          className="handle handle-crop"
          title="Rescale image"
          style={{ width: s, height: s, left: c.x - s / 2, top: c.y - s / 2, borderWidth: Math.max(1, 1.5 / zoom) }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const p = pointerToFrame(e, el, docPoint, zoom);
            const dist = Math.hypot(p.x - c.anchor.x, p.y - c.anchor.y);
            onDragStart(e, 'crop-scale', { dist, anchor: c.anchor });
          }}
        />
      ))}
    </div>
  );
}

// --- Inline text editing ---------------------------------------------------

function EditableText({ el, onDone }: { el: DesignElement; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const content = el.content as { text: string };
  const s = el.style as {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    color: string;
    align: string;
    lineHeight: number;
    letterSpacing: number;
    italic: boolean;
  };

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.textContent = content.text;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className="el el-text el-editing"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Edit text"
      spellCheck
      style={{
        left: el.x,
        top: el.y,
        width: el.width,
        minHeight: el.height,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        opacity: el.opacity,
        fontFamily: `"${s.fontFamily}", sans-serif`,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        color: s.color,
        textAlign: s.align as 'left' | 'center' | 'right',
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing || undefined,
        fontStyle: s.italic ? 'italic' : undefined,
        outline: `${Math.max(1, 2 / (window.devicePixelRatio > 0 ? 1 : 1))}px solid #0B7A70`,
      }}
      onInput={(e) => {
        const text = (e.currentTarget as HTMLElement).innerText;
        useEditor.getState().patchSelectedLive({ content: { text } });
      }}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
