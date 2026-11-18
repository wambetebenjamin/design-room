// App root: view switching, global keyboard shortcuts, unload guard, overlays.

import { useEffect, useRef, useState } from 'react';
import { useEditor } from './store/editorStore';
import { HomeScreen } from './components/HomeScreen';
import { EditorShell } from './components/EditorShell';
import { NewDesignModal } from './components/NewDesignModal';
import { ConfirmDialog, Toasts } from './components/Overlays';

export default function App() {
  const view = useEditor((s) => s.view);
  const init = useEditor((s) => s.init);
  const [newOpen, setNewOpen] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void init();
  }, [init]);

  // Never silently lose edits when the tab closes mid-save.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useEditor.getState();
      if (s.saveStatus === 'dirty' || s.saveStatus === 'saving' || s.saveStatus === 'error') {
        void s.saveNow();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useGlobalShortcuts();

  if (view === 'loading') {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <span className="brand-mark brand-mark-lg" aria-hidden="true">
          C
        </span>
        <p>Opening your workspace…</p>
      </div>
    );
  }

  return (
    <>
      {view === 'home' ? (
        <HomeScreen onNewDesign={() => setNewOpen(true)} />
      ) : (
        <EditorShell />
      )}
      {newOpen && <NewDesignModal onClose={() => setNewOpen(false)} />}
      <ConfirmDialog />
      <Toasts />
    </>
  );
}

/** Keyboard operation for the editor: undo/redo, delete, nudge, shortcuts. */
function useGlobalShortcuts() {
  useEffect(() => {
    let nudgeTxOpen = false;

    const isEditableTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable === true
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      if (s.view !== 'editor') return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void s.saveNow().then(() => {
          const st = useEditor.getState();
          if (st.saveStatus === 'saved') st.toast('success', 'Design saved.');
          else if (st.saveStatus === 'error') st.toast('error', st.saveError ?? 'Save failed.');
        });
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        s.copySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        s.cutSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        s.pasteClipboard();
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        s.setExportOpen(true);
        return;
      }

      if (isEditableTarget(e.target)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectionId && !s.editingTextId) {
          e.preventDefault();
          s.deleteSelected();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (s.cropMode) s.setCropMode(false);
        else if (s.selectionId) s.select(null);
        return;
      }
      if (e.key === 'Enter' && s.selectionId) {
        const el = s.doc?.elements.find((x) => x.id === s.selectionId);
        if (el?.type === 'text') {
          e.preventDefault();
          s.setEditingText(el.id);
        }
        return;
      }

      // Arrow-key nudge (grouped into one undo step per key hold).
      if (e.key.startsWith('Arrow') && s.selectionId && !s.editingTextId) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (!nudgeTxOpen) {
          s.beginTx();
          nudgeTxOpen = true;
        }
        const id = s.selectionId;
        s.patchSelectedLive({
          x: (s.doc?.elements.find((x) => x.id === id)?.x ?? 0) + dx,
          y: (s.doc?.elements.find((x) => x.id === id)?.y ?? 0) + dy,
        });
      }
    };

    const onKeyUp = () => {
      if (nudgeTxOpen) {
        nudgeTxOpen = false;
        useEditor.getState().endTx();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onKeyUp);
    };
  }, []);
}
