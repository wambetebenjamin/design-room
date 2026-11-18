// Toast notifications and the destructive-action confirm dialog.

import { useEffect, useRef } from 'react';
import { useEditor } from '../store/editorStore';

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.message}</span>
          <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog() {
  const confirm = useEditor((s) => s.confirm);
  const close = useEditor((s) => s.closeConfirm);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirm) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, close]);

  if (!confirm) return null;

  return (
    <div className="modal-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="modal modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg">
        <h2 id="confirm-title">{confirm.title}</h2>
        <p id="confirm-msg">{confirm.message}</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={() => close(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger-solid" onClick={() => close(true)}>
            {confirm.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
