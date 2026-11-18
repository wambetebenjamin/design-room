// App header: back to designs, editable title, save status, undo/redo, export.

import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editorStore';

interface Props {
  onExport: () => void;
  onTogglePanel: () => void;
  panelOpen: boolean;
}

export function TopBar({ onExport, onTogglePanel, panelOpen }: Props) {
  const doc = useEditor((s) => s.doc);
  const saveStatus = useEditor((s) => s.saveStatus);
  const saveError = useEditor((s) => s.saveError);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const goHome = useEditor((s) => s.goHome);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const rename = useEditor((s) => s.rename);
  const saveNow = useEditor((s) => s.saveNow);
  const toast = useEditor((s) => s.toast);

  const [title, setTitle] = useState(doc?.design.title ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(doc?.design.title ?? '');
  }, [doc?.design.title, doc?.design.id]);

  if (!doc) return null;

  const statusLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'saved'
        ? 'Saved'
        : saveStatus === 'error'
          ? 'Save failed'
          : 'Unsaved changes';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void goHome();
          }}
          aria-label="Back to your designs"
        >
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <span className="brand-text">Designs</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost panel-toggle"
          onClick={onTogglePanel}
          aria-expanded={panelOpen}
          aria-label={panelOpen ? 'Hide library panel' : 'Show library panel'}
        >
          ☰ Library
        </button>
      </div>

      <div className="topbar-center">
        <label className="sr-only" htmlFor="design-title">
          Design title
        </label>
        <input
          id="design-title"
          ref={inputRef}
          className="title-input"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => rename(title)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setTitle(doc.design.title);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        <span
          className={`save-status save-${saveStatus}`}
          role="status"
          aria-live="polite"
          title={saveError ?? undefined}
        >
          {saveStatus === 'error' ? (
            <button
              type="button"
              className="btn btn-link"
              onClick={() => {
                void saveNow().then((ok) => {
                  if (useEditor.getState().saveStatus === 'error') {
                    toast('error', useEditor.getState().saveError ?? 'Saving failed again.');
                  }
                });
              }}
            >
              {statusLabel} — Retry
            </button>
          ) : (
            statusLabel
          )}
        </span>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className="btn btn-icon"
          onClick={undo}
          disabled={past.length === 0}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          type="button"
          className="btn btn-icon"
          onClick={redo}
          disabled={future.length === 0}
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
        >
          ↷
        </button>
        <button type="button" className="btn btn-primary" onClick={onExport}>
          Export
        </button>
      </div>
    </header>
  );
}
