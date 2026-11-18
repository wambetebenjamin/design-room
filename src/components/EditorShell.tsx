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

export function EditorShell() {
  const doc = useEditor((s) => s.doc);
  const [exportOpen, setExportOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

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
      <TopBar onExport={() => setExportOpen(true)} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((v) => !v)} />
      <ContextToolbar />
      <div className="editor-main">
        {panelOpen && <LeftPanel />}
        <CanvasStage />
      </div>
      <PageTabs />
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}
