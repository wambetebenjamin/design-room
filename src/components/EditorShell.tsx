// Editor layout: top bar, contextual toolbar, library panel, canvas, page tabs.

import { useEffect, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { preloadDesignAssets } from '../render/imageCache';
import { TopBar } from './TopBar';
import { ContextToolbar } from './ContextToolbar';
import { LeftPanel } from './LeftPanel';
import { CanvasStage } from './CanvasStage';
import { PageTabs } from './PageTabs';
import { ExportDialog } from './ExportDialog';
import { OcrDialog } from './OcrDialog';
import { ShortcutsDialog } from './ShortcutsDialog';

export function EditorShell() {
  const doc = useEditor((s) => s.doc);
  const pendingOcr = useEditor((s) => s.pendingOcr);
  const setPendingOcr = useEditor((s) => s.setPendingOcr);
  const exportOpen = useEditor((s) => s.exportOpen);
  const setExportOpen = useEditor((s) => s.setExportOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  // "?" opens the shortcuts list (unless typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      setHelpOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Preload this design's images so canvas + exports are ready.
  useEffect(() => {
    if (!doc) return;
    void preloadDesignAssets(doc.design.id);
  }, [doc?.design.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default the library panel to hidden on narrow screens.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => setPanelOpen(!mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  if (!doc) return null;

  return (
    <div className="editor">
      <TopBar
        onExport={() => setExportOpen(true)}
        onHelp={() => setHelpOpen(true)}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((v) => !v)}
      />
      <ContextToolbar />
      <div className="editor-main">
        {panelOpen && <LeftPanel />}
        <CanvasStage />
      </div>
      <PageTabs />
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
      {pendingOcr && <OcrDialog target={pendingOcr} onClose={() => setPendingOcr(null)} />}
    </div>
  );
}
