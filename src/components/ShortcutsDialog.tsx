// Keyboard shortcuts reference — opened with "?" or the ? button in the top bar.

import { useEffect, useRef } from 'react';

interface Props {
  onClose: () => void;
}

interface ShortcutRow {
  keys: string[];
  label: string;
}

const GROUPS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: 'Editing',
    rows: [
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], label: 'Redo' },
      { keys: ['Ctrl', 'C'], label: 'Copy selection' },
      { keys: ['Ctrl', 'X'], label: 'Cut selection' },
      { keys: ['Ctrl', 'V'], label: 'Paste' },
      { keys: ['Ctrl', 'D'], label: 'Duplicate selection' },
      { keys: ['Delete'], label: 'Remove selection' },
      { keys: ['Ctrl', 'S'], label: 'Save now' },
    ],
  },
  {
    title: 'Canvas',
    rows: [
      { keys: ['↑', '↓', '←', '→'], label: 'Nudge 1 px (Shift = 10 px)' },
      { keys: ['Enter'], label: 'Edit selected text' },
      { keys: ['Double-click'], label: 'Text: edit · Background: add text' },
      { keys: ['Esc'], label: 'Deselect / exit crop or editing' },
      { keys: ['Alt', 'Drag'], label: 'Move without snapping to guides' },
    ],
  },
  {
    title: 'View & help',
    rows: [
      { keys: ['Ctrl', 'E'], label: 'Export dialog' },
      { keys: ['?'], label: 'This shortcuts list' },
      { keys: ['−', '+'], label: 'Zoom (bottom-right of the canvas)' },
    ],
  },
];

export function ShortcutsDialog({ onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <div className="shortcut-groups">
          {GROUPS.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <h3 className="ocr-section-title">{g.title}</h3>
              <dl className="shortcut-list">
                {g.rows.map((r) => (
                  <div className="shortcut-row" key={r.label}>
                    <dt>
                      {r.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && <span className="shortcut-plus">+</span>}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{r.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button ref={closeRef} type="button" className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
