// "Start a design" dialog: size presets, custom size, or an original template.

import { useEffect, useRef, useState } from 'react';
import { SIZE_PRESETS, CUSTOM_MIN, CUSTOM_MAX } from '../domain/sizes';
import { TEMPLATES } from '../domain/templates';
import { useEditor } from '../store/editorStore';
import { TemplatePreview } from './LeftPanel';

interface Props {
  onClose: () => void;
}

export function NewDesignModal({ onClose }: Props) {
  const createDesign = useEditor((s) => s.createDesign);
  const [title, setTitle] = useState('');
  const [customW, setCustomW] = useState('1080');
  const [customH, setCustomH] = useState('1080');
  const [customError, setCustomError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const start = async (width: number, height: number, templateId?: string, fallbackTitle?: string) => {
    await createDesign({
      width,
      height,
      title: title.trim() || fallbackTitle || 'Untitled design',
      templateId,
    });
    onClose();
  };

  const startCustom = async () => {
    const w = Number(customW);
    const h = Number(customH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < CUSTOM_MIN || h < CUSTOM_MIN || w > CUSTOM_MAX || h > CUSTOM_MAX) {
      setCustomError(`Width and height must be between ${CUSTOM_MIN} and ${CUSTOM_MAX} pixels.`);
      return;
    }
    setCustomError(null);
    await start(Math.round(w), Math.round(h), undefined, `${Math.round(w)} × ${Math.round(h)} design`);
  };

  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="new-title">
        <h2 id="new-title">Start a design</h2>

        <label className="field field-block">
          <span className="field-label">Design name</span>
          <input
            type="text"
            value={title}
            maxLength={200}
            placeholder="Untitled design"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <h3 className="panel-heading">Canvas size</h3>
        <div className="size-grid">
          {SIZE_PRESETS.map((p, i) => (
            <button
              key={p.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="size-card"
              onClick={() => void start(p.width, p.height, undefined, p.label)}
            >
              <strong>{p.label}</strong>
              <small>
                {p.width} × {p.height}
                <br />
                {p.hint}
              </small>
            </button>
          ))}
          <div className="size-card size-custom">
            <strong>Custom</strong>
            <div className="custom-dims">
              <label>
                <span className="sr-only">Custom width</span>
                <input
                  type="number"
                  value={customW}
                  min={CUSTOM_MIN}
                  max={CUSTOM_MAX}
                  aria-label="Custom width in pixels"
                  onChange={(e) => setCustomW(e.target.value)}
                />
              </label>
              <span aria-hidden="true">×</span>
              <label>
                <span className="sr-only">Custom height</span>
                <input
                  type="number"
                  value={customH}
                  min={CUSTOM_MIN}
                  max={CUSTOM_MAX}
                  aria-label="Custom height in pixels"
                  onChange={(e) => setCustomH(e.target.value)}
                />
              </label>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void startCustom()}>
              Create
            </button>
          </div>
        </div>
        {customError && (
          <p className="form-error" role="alert">
            {customError}
          </p>
        )}

        <h3 className="panel-heading">Or start from an original template</h3>
        <div className="tpl-grid tpl-grid-modal">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              className="tpl-card"
              onClick={() => void start(tpl.width, tpl.height, tpl.id, tpl.name)}
            >
              <TemplatePreview tpl={tpl} />
              <span className="tpl-meta">
                <strong>{tpl.name}</strong>
                <small>{tpl.category}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
