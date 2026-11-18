// Bottom bar: page thumbnails with add / duplicate / reorder / delete.

import { useEditor } from '../store/editorStore';
import { ElementView, PageBackground } from './ElementView';
import { elementsOfPage, backgroundToCss } from '../domain/document';
import { useImageVersion } from '../render/imageCache';

export function PageTabs() {
  const doc = useEditor((s) => s.doc);
  const currentPageId = useEditor((s) => s.currentPageId);
  const setCurrentPage = useEditor((s) => s.setCurrentPage);
  const addPage = useEditor((s) => s.addPage);
  const duplicateCurrentPage = useEditor((s) => s.duplicateCurrentPage);
  const deletePage = useEditor((s) => s.deletePage);
  const moveCurrentPage = useEditor((s) => s.moveCurrentPage);
  const askConfirm = useEditor((s) => s.askConfirm);
  useImageVersion();

  if (!doc) return null;
  const pages = [...doc.pages].sort((a, b) => a.order - b.order);
  const currentIndex = pages.findIndex((p) => p.id === currentPageId);

  const onDelete = async () => {
    if (!currentPageId) return;
    if (pages.length <= 1) return;
    const ok = await askConfirm(
      'Delete this page?',
      'All objects on the page will be removed. You can undo with Ctrl+Z.',
      'Delete page',
    );
    if (ok) deletePage(currentPageId);
  };

  return (
    <nav className="pagetabs" aria-label="Pages">
      <div className="pagetabs-list">
        {pages.map((page, i) => {
          const els = elementsOfPage(doc, page.id);
          const tw = 76;
          const scale = tw / doc.design.width;
          return (
            <div key={page.id} className={`pagetab${page.id === currentPageId ? ' is-active' : ''}`}>
              <button
                type="button"
                className="pagetab-thumb"
                aria-current={page.id === currentPageId ? 'page' : undefined}
                aria-label={`Page ${i + 1}, ${els.length} object${els.length === 1 ? '' : 's'}`}
                onClick={() => setCurrentPage(page.id)}
              >
                <span
                  className="thumb-inner"
                  style={{
                    width: doc.design.width,
                    height: doc.design.height,
                    transform: `scale(${scale})`,
                    background: backgroundToCss(page.background),
                  }}
                  aria-hidden="true"
                >
                  <PageBackground background={page.background} width={doc.design.width} height={doc.design.height} />
                  {els.map((el) => (
                    <ElementView key={el.id} el={el} staticView />
                  ))}
                </span>
              </button>
              <span className="pagetab-num" aria-hidden="true">
                {i + 1}
              </span>
            </div>
          );
        })}
      </div>

      <div className="pagetabs-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={addPage} title="Add a page">
          + Page
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={duplicateCurrentPage}
          title="Duplicate current page"
          disabled={!currentPageId}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => moveCurrentPage(-1)}
          aria-label="Move page left"
          title="Move page left"
          disabled={currentIndex <= 0}
        >
          ←
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => moveCurrentPage(1)}
          aria-label="Move page right"
          title="Move page right"
          disabled={currentIndex < 0 || currentIndex >= pages.length - 1}
        >
          →
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-danger"
          onClick={() => void onDelete()}
          disabled={pages.length <= 1}
          title="Delete current page"
        >
          Delete
        </button>
      </div>
    </nav>
  );
}
