// Central editor state: document, selection, history (grouped undo/redo),
// persistence status, toasts and confirm dialogs.

import { create } from 'zustand';
import type { Design, DesignDoc, DesignElement, ElementType, Page } from '../domain/types';
import {
  addElement,
  addPage,
  alignToPage,
  clampSize,
  createPage,
  duplicateElement,
  duplicatePage,
  elementsOfPage,
  movePage,
  removeElement,
  removePage,
  reorderElement,
  setBackground,
  uid,
  withElement,
  withTextFit,
} from '../domain/document';
import { defaultCrop, fitCropToFrame } from '../domain/crop';
import type { ImageCrop } from '../domain/types';
export { LOGO_LIBRARY_ID, listLogos, repoDeleteLogo as deleteLogo };
import {
  deleteDesign as repoDelete,
  deleteLogo as repoDeleteLogo,
  duplicateDesign as repoDuplicate,
  ensureTemplatesSeeded,
  listDesigns,
  listAssets,
  listLogos,
  loadDoc,
  renameDesign,
  saveAsset,
  saveDoc,
  setMeta,
  getMeta,
  LOGO_LIBRARY_ID,
} from '../data/designRepo';
import { TEMPLATES } from '../domain/templates';
import type { TemplateDef } from '../domain/types';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
export type View = 'loading' | 'home' | 'editor';

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  resolve: (ok: boolean) => void;
}

export interface CreateOptions {
  width: number;
  height: number;
  title: string;
  templateId?: string;
}

export interface TextPreset {
  size?: number;
  sizeFactor?: number;
  weight?: number;
  fontFamily?: string;
  text?: string;
}

const HISTORY_LIMIT = 120;
const SAVE_DEBOUNCE_MS = 500;

function newDesignMeta(title: string, width: number, height: number): Design {
  const now = Date.now();
  return { id: uid('design'), title, width, height, createdAt: now, updatedAt: now, sample: false };
}

function docFromTemplate(tpl: TemplateDef, title?: string): DesignDoc {
  const design = newDesignMeta(title ?? tpl.name, tpl.width, tpl.height);
  const page = createPage(design.id, 0, tpl.background);
  const elements: DesignElement[] = tpl.elements.map((te, i) => ({
    id: uid('el'),
    pageId: page.id,
    type: te.type,
    x: te.x,
    y: te.y,
    width: te.width,
    height: te.height,
    rotation: te.rotation ?? 0,
    opacity: te.opacity ?? 1,
    order: i,
    content: structuredClone(te.content),
    style: structuredClone(te.style),
  }));
  return { design, pages: [page], elements };
}

interface OcrTarget {
  assetId: string;
  /** Image element to swap when the original text is erased (undo restores it). */
  elementId?: string;
}
export type { OcrTarget };

interface EditorState {
  view: View;
  loadError: string | null;
  designs: Design[];

  doc: DesignDoc | null;
  currentPageId: string | null;
  selectionId: string | null;
  editingTextId: string | null;
  cropMode: boolean;
  zoom: number | 'fit';

  /** Set while the OCR review dialog should be open for an image asset. */
  pendingOcr: OcrTarget | null;

  past: DesignDoc[];
  future: DesignDoc[];
  txSnapshot: DesignDoc | null;

  saveStatus: SaveStatus;
  saveError: string | null;

  toasts: Toast[];
  confirm: ConfirmRequest | null;

  init: () => Promise<void>;
  refreshDesigns: () => Promise<void>;
  goHome: () => Promise<void>;

  createDesign: (opts: CreateOptions) => Promise<void>;
  openDesign: (id: string) => Promise<void>;
  deleteDesignById: (id: string) => Promise<void>;
  duplicateDesignById: (id: string) => Promise<void>;
  importDoc: (doc: DesignDoc) => Promise<void>;
  rename: (title: string) => void;

  // history
  commit: (fn: (doc: DesignDoc) => DesignDoc) => void;
  beginTx: () => void;
  updateLive: (fn: (doc: DesignDoc) => DesignDoc) => void;
  endTx: () => void;
  undo: () => void;
  redo: () => void;

  // selection / view
  select: (id: string | null) => void;
  setCropMode: (on: boolean) => void;
  setEditingText: (id: string | null) => void;
  setCurrentPage: (pageId: string) => void;
  setZoom: (z: number | 'fit') => void;
  setPendingOcr: (t: OcrTarget | null) => void;

  // element ops
  addText: (preset?: TextPreset) => void;
  addShape: (shape: 'rect' | 'ellipse' | 'triangle' | 'star' | 'line') => void;
  addImageElement: (assetId: string, naturalW: number, naturalH: number) => void;
  addLogoElement: (assetId: string, naturalW: number, naturalH: number) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  layerSelected: (op: 'front' | 'back' | 'forward' | 'backward') => void;
  alignSelected: (align: 'left' | 'centerH' | 'right' | 'top' | 'middleV' | 'bottom') => void;
  patchSelected: (patch: Partial<DesignElement>) => void;
  patchSelectedLive: (patch: Partial<DesignElement>) => void;
  setImageCrop: (crop: ImageCrop) => void;
  setPageBackground: (bg: Page['background']) => void;

  // pages
  addPage: () => void;
  duplicateCurrentPage: () => void;
  deletePage: (pageId: string) => void;
  moveCurrentPage: (dir: -1 | 1) => void;

  // persistence
  saveNow: () => Promise<void>;
  toast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: string) => void;
  askConfirm: (title: string, message: string, confirmLabel?: string) => Promise<boolean>;
  closeConfirm: (ok: boolean) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditor = create<EditorState>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void get().saveNow();
    }, SAVE_DEBOUNCE_MS);
  };

  const afterDocChange = () => {
    set({ saveStatus: 'dirty', saveError: null });
    scheduleSave();
  };

  const fixSelection = (doc: DesignDoc | null, selectionId: string | null): string | null => {
    if (!selectionId || !doc) return null;
    return doc.elements.some((e) => e.id === selectionId) ? selectionId : null;
  };

  const pushHistory = (snapshot: DesignDoc) => {
    const past = [...get().past, snapshot];
    if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
    set({ past, future: [] });
  };

  /** Close an open inline-text transaction so its undo group is committed. */
  const closeEditingTx = () => {
    const st = get();
    if (!st.editingTextId) return;
    set({ editingTextId: null });
    st.endTx();
  };

  return {
    view: 'loading',
    loadError: null,
    designs: [],
    doc: null,
    currentPageId: null,
    selectionId: null,
    editingTextId: null,
    cropMode: false,
    zoom: 'fit',
    pendingOcr: null,
    past: [],
    future: [],
    txSnapshot: null,
    saveStatus: 'idle',
    saveError: null,
    toasts: [],
    confirm: null,

    init: async () => {
      try {
        await ensureTemplatesSeeded();
        const designs = await listDesigns();
        const lastId = await getMeta<string>('lastOpened');
        const last = lastId ? designs.find((d) => d.id === lastId) : undefined;
        if (last) {
          const doc = await loadDoc(last.id);
          if (doc) {
            set({
              view: 'editor',
              doc,
              currentPageId: doc.pages[0]?.id ?? null,
              designs,
              past: [],
              future: [],
              selectionId: null,
              saveStatus: 'saved',
            });
            return;
          }
        }
        set({ view: 'home', designs });
      } catch (e) {
        set({
          view: 'home',
          loadError: e instanceof Error ? e.message : 'Could not open your local workspace.',
          designs: [],
        });
      }
    },

    refreshDesigns: async () => {
      try {
        const designs = await listDesigns();
        set({ designs, loadError: null });
      } catch (e) {
        set({ loadError: e instanceof Error ? e.message : 'Could not list designs.' });
      }
    },

    goHome: async () => {
      await get().saveNow();
      set({ view: 'home', selectionId: null, editingTextId: null, cropMode: false });
      await get().refreshDesigns();
    },

    createDesign: async (opts) => {
      try {
        const width = clampSize(opts.width);
        const height = clampSize(opts.height);
        let doc: DesignDoc;
        if (opts.templateId) {
          const tpl = TEMPLATES.find((t) => t.id === opts.templateId);
          doc = tpl ? docFromTemplate(tpl, opts.title || tpl.name) : blankDoc(opts.title, width, height);
        } else {
          doc = blankDoc(opts.title, width, height);
        }
        await saveDoc(doc);
        await setMeta('lastOpened', doc.design.id);
        set({
          view: 'editor',
          doc,
          currentPageId: doc.pages[0].id,
          selectionId: null,
          past: [],
          future: [],
          saveStatus: 'saved',
          cropMode: false,
          editingTextId: null,
        });
        await get().refreshDesigns();
      } catch (e) {
        get().toast('error', e instanceof Error ? e.message : 'Could not create the design.');
      }
    },

    openDesign: async (id) => {
      try {
        const doc = await loadDoc(id);
        if (!doc) throw new Error('This design could not be found. It may have been deleted.');
        await setMeta('lastOpened', id);
        set({
          view: 'editor',
          doc,
          currentPageId: doc.pages[0]?.id ?? null,
          selectionId: null,
          past: [],
          future: [],
          saveStatus: 'saved',
          cropMode: false,
          editingTextId: null,
        });
      } catch (e) {
        get().toast('error', e instanceof Error ? e.message : 'Could not open the design.');
      }
    },

    deleteDesignById: async (id) => {
      try {
        await repoDelete(id);
        const current = get().doc;
        if (current?.design.id === id) {
          set({ view: 'home', doc: null, currentPageId: null, selectionId: null, past: [], future: [] });
        }
        await get().refreshDesigns();
        get().toast('success', 'Design deleted.');
      } catch (e) {
        get().toast('error', e instanceof Error ? e.message : 'Could not delete the design.');
      }
    },

    duplicateDesignById: async (id) => {
      try {
        await repoDuplicate(id);
        await get().refreshDesigns();
        get().toast('success', 'Design duplicated.');
      } catch (e) {
        get().toast('error', e instanceof Error ? e.message : 'Could not duplicate the design.');
      }
    },

    importDoc: async (doc) => {
      try {
        // Re-key on import to avoid collisions with existing records.
        const designId = uid('design');
        const pageMap = new Map(doc.pages.map((p) => [p.id, uid('page')]));
        const imported: DesignDoc = {
          design: { ...doc.design, id: designId, updatedAt: Date.now(), sample: false },
          pages: doc.pages.map((p) => ({ ...p, id: pageMap.get(p.id)!, designId })),
          elements: doc.elements.map((e) => ({ ...structuredClone(e), id: uid('el'), pageId: pageMap.get(e.pageId)! })),
        };
        // Keep any referenced images out of scope: image assets are not part of
        // the portable JSON (documented limitation), so drop dangling images.
        imported.elements = imported.elements.filter((e) => e.type !== 'image');
        await saveDoc(imported);
        await setMeta('lastOpened', imported.design.id);
        await get().refreshDesigns();
        get().toast('success', `Imported "${imported.design.title}".`);
        await get().openDesign(imported.design.id);
      } catch (e) {
        get().toast('error', e instanceof Error ? e.message : 'Could not import the document.');
      }
    },

    rename: (title) => {
      const doc = get().doc;
      if (!doc) return;
      const clean = title.trim().slice(0, 200) || 'Untitled design';
      if (clean === doc.design.title) return;
      pushHistory(doc);
      set({
        doc: { ...doc, design: { ...doc.design, title: clean, updatedAt: Date.now() } },
        past: [...get().past].slice(-HISTORY_LIMIT),
      });
      afterDocChange();
      void renameDesign(doc.design.id, clean).catch((e) => {
        set({ saveStatus: 'error', saveError: e instanceof Error ? e.message : 'Rename failed.' });
      });
    },

    commit: (fn) => {
      const doc = get().doc;
      if (!doc) return;
      pushHistory(doc);
      const next = fn(doc);
      if (next === doc) {
        set({ past: get().past.slice(0, -1) });
        return;
      }
      const fitted = withTextFit(next);
      set({ doc: fitted, selectionId: fixSelection(fitted, get().selectionId) });
      afterDocChange();
    },

    beginTx: () => {
      if (get().txSnapshot) return;
      const doc = get().doc;
      if (!doc) return;
      set({ txSnapshot: doc });
    },

    updateLive: (fn) => {
      const doc = get().doc;
      if (!doc) return;
      const next = fn(doc);
      if (next === doc) return;
      set({ doc: next });
      afterDocChange();
    },

    endTx: () => {
      const snap = get().txSnapshot;
      const doc = get().doc;
      set({ txSnapshot: null });
      if (!snap || !doc || snap === doc) return;
      const fitted = withTextFit(doc);
      set({ doc: fitted, selectionId: fixSelection(fitted, get().selectionId) });
      pushHistory(snap);
      afterDocChange();
    },

    undo: () => {
      if (!get().doc || get().past.length === 0) return;
      closeEditingTx();
      const { past, doc, future } = get();
      if (!doc || past.length === 0) return;
      const prev = past[past.length - 1];
      set({
        doc: prev,
        past: past.slice(0, -1),
        future: [...future, doc].slice(-HISTORY_LIMIT),
        selectionId: fixSelection(prev, get().selectionId),
        cropMode: false,
        editingTextId: null,
      });
      afterDocChange();
    },

    redo: () => {
      if (!get().doc || get().future.length === 0) return;
      closeEditingTx();
      const { past, doc, future } = get();
      if (!doc || future.length === 0) return;
      const next = future[future.length - 1];
      set({
        doc: next,
        future: future.slice(0, -1),
        past: [...past, doc].slice(-HISTORY_LIMIT),
        selectionId: fixSelection(next, get().selectionId),
        cropMode: false,
        editingTextId: null,
      });
      afterDocChange();
    },

    select: (id) => {
      closeEditingTx();
      set({ selectionId: id, cropMode: false, editingTextId: null });
    },
    setCropMode: (on) => {
      closeEditingTx();
      set({ cropMode: on, editingTextId: null });
    },
    setEditingText: (id) => set({ editingTextId: id, cropMode: false }),
    setCurrentPage: (pageId) => {
      closeEditingTx();
      set({ currentPageId: pageId, selectionId: null, cropMode: false, editingTextId: null });
    },
    setZoom: (z) => set({ zoom: z }),
    setPendingOcr: (t) => set({ pendingOcr: t }),

    addText: (preset) => {
      const { doc, currentPageId } = get();
      if (!doc || !currentPageId) return;
      const w = doc.design.width;
      const h = doc.design.height;
      const fontSize =
        preset?.size ?? Math.max(24, Math.round(Math.min(w, h) * (preset?.sizeFactor ?? 0.06)));
      const el: DesignElement = {
        id: uid('el'),
        pageId: currentPageId,
        type: 'text',
        x: Math.round(w * 0.1),
        y: Math.round(h * 0.1),
        width: Math.round(w * 0.8),
        height: Math.round(fontSize * 1.4),
        rotation: 0,
        opacity: 1,
        order: 0,
        content: { text: preset?.text ?? 'Your text here' },
        style: {
          fontFamily: preset?.fontFamily ?? 'Inter',
          fontSize,
          fontWeight: preset?.weight ?? 600,
          color: '#111418',
          align: 'left',
          lineHeight: 1.25,
          letterSpacing: 0,
          italic: false,
        },
      };
      get().commit((d) => addElement(d, el));
      set({ selectionId: el.id });
    },

    addShape: (shape) => {
      const { doc, currentPageId } = get();
      if (!doc || !currentPageId) return;
      const w = doc.design.width;
      const h = doc.design.height;
      const size = Math.round(Math.min(w, h) * 0.3);
      const el: DesignElement = {
        id: uid('el'),
        pageId: currentPageId,
        type: 'shape',
        x: Math.round((w - size) / 2),
        y: Math.round((h - size) / 2),
        width: size,
        height: shape === 'line' ? Math.max(4, Math.round(size * 0.04)) : size,
        rotation: 0,
        opacity: 1,
        order: 0,
        content: {},
        style: { shape, fill: '#12B5A9', radius: shape === 'rect' ? 0 : 0 },
      };
      get().commit((d) => addElement(d, el));
      set({ selectionId: el.id });
    },

    addImageElement: (assetId, naturalW, naturalH) => {
      const { doc, currentPageId } = get();
      if (!doc || !currentPageId) return;
      const w = doc.design.width;
      const h = doc.design.height;
      const fw = Math.round(w * 0.6);
      const fh = Math.round(h * 0.45);
      const el: DesignElement = {
        id: uid('el'),
        pageId: currentPageId,
        type: 'image',
        x: Math.round((w - fw) / 2),
        y: Math.round((h - fh) / 2),
        width: fw,
        height: fh,
        rotation: 0,
        opacity: 1,
        order: 0,
        content: { assetId, crop: defaultCrop(naturalW, naturalH, fw, fh) },
        style: { radius: 0 },
      };
      get().commit((d) => addElement(d, el));
      set({ selectionId: el.id });
    },

    addLogoElement: (assetId, naturalW, naturalH) => {
      const { doc, currentPageId } = get();
      if (!doc || !currentPageId) return;
      const pw = doc.design.width;
      const ph = doc.design.height;
      const fw = Math.max(80, Math.round(pw * 0.28));
      const fh = Math.max(32, Math.round(fw * (naturalH / Math.max(1, naturalW))));
      const el: DesignElement = {
        id: uid('el'),
        pageId: currentPageId,
        type: 'image',
        x: Math.round((pw - fw) / 2),
        y: Math.round(ph * 0.07),
        width: fw,
        height: fh,
        rotation: 0,
        opacity: 1,
        order: 0,
        content: { assetId, crop: defaultCrop(naturalW, naturalH, fw, fh) },
        style: { radius: 0 },
      };
      get().commit((d) => addElement(d, el));
      set({ selectionId: el.id });
    },

    deleteSelected: () => {
      const { doc, selectionId } = get();
      if (!doc || !selectionId) return;
      get().commit((d) => removeElement(d, selectionId));
      set({ selectionId: null, cropMode: false });
    },

    duplicateSelected: () => {
      const { doc, selectionId } = get();
      if (!doc || !selectionId) return;
      const el = doc.elements.find((e) => e.id === selectionId);
      if (!el) return;
      let newId = '';
      get().commit((d) => {
        const r = duplicateElement(d, el);
        newId = r.newId;
        return r.doc;
      });
      set({ selectionId: newId });
    },

    layerSelected: (op) => {
      const { doc, selectionId } = get();
      if (!doc || !selectionId) return;
      const el = doc.elements.find((e) => e.id === selectionId);
      if (!el) return;
      get().commit((d) => reorderElement(d, el, op));
    },

    alignSelected: (align) => {
      const { doc, selectionId, currentPageId } = get();
      if (!doc || !selectionId || !currentPageId) return;
      const el = doc.elements.find((e) => e.id === selectionId);
      const page = doc.pages.find((p) => p.id === currentPageId);
      if (!el || !page) return;
      get().commit((d) => alignToPage(d, el, page, align, doc.design.width, doc.design.height));
    },

    patchSelected: (patch) => {
      const { doc, selectionId } = get();
      if (!doc || !selectionId) return;
      get().commit((d) => withElement(d, selectionId, patch));
    },

    patchSelectedLive: (patch) => {
      const { doc, selectionId } = get();
      if (!doc || !selectionId) return;
      get().updateLive((d) => withElement(d, selectionId, patch));
    },

    setImageCrop: (crop) => {
      const { doc, selectionId } = get();
      if (!doc || !selectionId) return;
      const el = doc.elements.find((e) => e.id === selectionId);
      if (!el || el.type !== 'image') return;
      get().updateLive((d) => withElement(d, selectionId, { content: { ...(el.content as object), crop } as DesignElement['content'] }));
    },

    setPageBackground: (bg) => {
      const { currentPageId } = get();
      if (!currentPageId) return;
      get().commit((d) => setBackground(d, currentPageId, bg));
    },

    addPage: () => {
      const doc = get().doc;
      if (!doc) return;
      const src = doc.pages.find((p) => p.id === get().currentPageId) ?? doc.pages[0];
      let newId = '';
      get().commit((d) => {
        const r = addPage(d, src?.background ?? '#ffffff');
        newId = r.page.id;
        return r.doc;
      });
      set({ currentPageId: newId, selectionId: null });
    },

    duplicateCurrentPage: () => {
      const { doc, currentPageId } = get();
      if (!doc || !currentPageId) return;
      let newId = '';
      get().commit((d) => {
        const r = duplicatePage(d, currentPageId);
        newId = r.page.id;
        return r.doc;
      });
      set({ currentPageId: newId, selectionId: null });
    },

    deletePage: (pageId) => {
      const doc = get().doc;
      if (!doc || doc.pages.length <= 1) return;
      get().commit((d) => removePage(d, pageId));
      const next = get().doc;
      if (get().currentPageId === pageId) {
        const pages = [...(next?.pages ?? [])].sort((a, b) => a.order - b.order);
        set({ currentPageId: pages[0]?.id ?? null, selectionId: null });
      }
    },

    moveCurrentPage: (dir) => {
      const { doc, currentPageId } = get();
      if (!doc || !currentPageId) return;
      get().commit((d) => movePage(d, currentPageId, dir));
    },

    saveNow: async () => {
      const doc = get().doc;
      if (!doc || get().view !== 'editor') return;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (get().saveStatus === 'saving') return;
      set({ saveStatus: 'saving' });
      try {
        await saveDoc(doc);
        set({ saveStatus: 'saved', saveError: null });
      } catch (e) {
        set({
          saveStatus: 'error',
          saveError: e instanceof Error ? e.message : 'Saving failed. Your edits remain on screen.',
        });
      }
    },

    toast: (kind, message) => {
      const id = uid('toast');
      set({ toasts: [...get().toasts, { id, kind, message }] });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500);
    },

    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

    askConfirm: (title, message, confirmLabel) =>
      new Promise<boolean>((resolve) => {
        set({ confirm: { title, message, confirmLabel, resolve } });
      }),

    closeConfirm: (ok) => {
      const c = get().confirm;
      set({ confirm: null });
      c?.resolve(ok);
    },
  };
});

function blankDoc(title: string, width: number, height: number): DesignDoc {
  const design = newDesignMeta(title || 'Untitled design', width, height);
  const page = createPage(design.id, 0, '#ffffff');
  return { design, pages: [page], elements: [] };
}

// --- Derived helpers -------------------------------------------------------

export function useCurrentPage(): Page | null {
  return useEditor((s) => {
    if (!s.doc || !s.currentPageId) return null;
    return s.doc.pages.find((p) => p.id === s.currentPageId) ?? null;
  });
}

export function useSelectedElement(): DesignElement | null {
  return useEditor((s) => {
    if (!s.doc || !s.selectionId) return null;
    return s.doc.elements.find((e) => e.id === s.selectionId) ?? null;
  });
}

export function pageElements(doc: DesignDoc | null, pageId: string | null): DesignElement[] {
  if (!doc || !pageId) return [];
  return elementsOfPage(doc, pageId);
}

export interface DecodedImage {
  width: number;
  height: number;
}

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_DIM = 12000;
const MAX_PIXELS = 50_000_000;

/** Validate + decode an uploaded image. Throws user-actionable errors. */
export async function validateImageFile(file: File): Promise<DecodedImage> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Unsupported file. Upload a PNG, JPEG or WebP image.');
  }
  if (file.size > MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`That image is ${mb} MB. The limit is 15 MB — try a smaller file.`);
  }

  let width = 0;
  let height = 0;
  if (typeof createImageBitmap === 'function') {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error('That file could not be read as an image. It may be corrupted.');
    }
    width = bmp.width;
    height = bmp.height;
    bmp.close();
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('That file could not be read as an image.'));
        img.src = url;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  if (width < 1 || height < 1) {
    throw new Error('That image has invalid dimensions.');
  }
  if (width > MAX_DIM || height > MAX_DIM || width * height > MAX_PIXELS) {
    throw new Error(
      `That image is ${width}×${height}px. The limit is ${MAX_DIM}px per side (50 megapixels) — resize it first.`,
    );
  }
  return { width, height };
}

/** Upload an image into the current design's asset store. */
export async function uploadImageFile(
  file: File,
): Promise<{ assetId: string; width: number; height: number }> {
  const { width, height } = await validateImageFile(file);
  const doc = useEditor.getState().doc;
  if (!doc) throw new Error('Open a design before uploading images.');
  const assetId = uid('asset');
  await saveAsset({ id: assetId, designId: doc.design.id, name: file.name, mimeType: file.type, blob: file });
  return { assetId, width, height };
}

/** Global logo library (shared across every design in this browser). */
export async function uploadLogo(file: File): Promise<{ assetId: string; width: number; height: number }> {
  const { width, height } = await validateImageFile(file);
  const assetId = uid('asset');
  await saveAsset({ id: assetId, designId: LOGO_LIBRARY_ID, name: file.name, mimeType: file.type, blob: file });
  return { assetId, width, height };
}

/**
 * Build (pure) the document for an imported design image: full-bleed base
 * layer sized to the image, ready for text / image / logo editing on top.
 */
export function buildDesignFromImage(
  fileName: string,
  width: number,
  height: number,
): { doc: DesignDoc; assetId: string; natural: { width: number; height: number } } {
  // Fit huge images into the canvas limits while keeping their aspect ratio.
  const MAX_CANVAS = 10000;
  const shrink = Math.min(1, MAX_CANVAS / width, MAX_CANVAS / height);
  const w = Math.max(16, Math.round(width * shrink));
  const h = Math.max(16, Math.round(height * shrink));

  const designId = uid('design');
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 80);
  const now = Date.now();
  const design: Design = {
    id: designId,
    title: base || 'Imported design',
    width: w,
    height: h,
    createdAt: now,
    updatedAt: now,
    sample: false,
  };
  const page = createPage(designId, 0, '#ffffff');
  const assetId = uid('asset');
  const element: DesignElement = {
    id: uid('el'),
    pageId: page.id,
    type: 'image',
    x: 0,
    y: 0,
    width: w,
    height: h,
    rotation: 0,
    opacity: 1,
    order: 0,
    content: { assetId, crop: defaultCrop(width, height, w, h) },
    style: { radius: 0 },
  };
  return { doc: { design, pages: [page], elements: [element] }, assetId, natural: { width, height } };
}

/**
 * Start a new design from an uploaded image: the image becomes a full-bleed
 * base layer, ready for text / image / logo editing on top. Returns what the
 * caller needs to open the design and trigger automatic text extraction.
 */
export async function importDesignFromImage(
  file: File,
): Promise<{ designId: string; assetId: string; elementId: string }> {
  const { width, height } = await validateImageFile(file);
  const { doc, assetId } = buildDesignFromImage(file.name, width, height);
  await saveAsset({ id: assetId, designId: doc.design.id, name: file.name, mimeType: file.type, blob: file });
  await saveDoc(doc);
  await setMeta('lastOpened', doc.design.id);
  return { designId: doc.design.id, assetId, elementId: doc.elements[0].id };
}

export async function loadDesignAssets(designId: string): Promise<{ id: string; blob: Blob }[]> {
  const assets = await listAssets(designId);
  return assets.map((a) => ({ id: a.id, blob: a.blob }));
}
