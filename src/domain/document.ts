// Pure helpers for working with a DesignDoc: creation, queries, mutations.
// All functions are immutable — they return new objects.

import type { DesignDoc, DesignElement, Page, Background } from './types';
import { makeMeasure, wrapText } from './textLayout';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export const MIN_SIZE = 16;
export const MAX_SIZE = 10000;

export function clampSize(v: number): number {
  if (!Number.isFinite(v)) return MIN_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(v)));
}

export function createPage(designId: string, order: number, background: Background = '#ffffff'): Page {
  return { id: uid('page'), designId, background, order };
}

export function pagesOf(doc: DesignDoc): Page[] {
  return [...doc.pages].sort((a, b) => a.order - b.order);
}

export function elementsOfPage(doc: DesignDoc, pageId: string): DesignElement[] {
  return doc.elements
    .filter((e) => e.pageId === pageId)
    .sort((a, b) => a.order - b.order);
}

export function selectedElement(doc: DesignDoc, id: string | null): DesignElement | null {
  if (!id) return null;
  return doc.elements.find((e) => e.id === id) ?? null;
}

/** Replace an element immutably. */
export function withElement(doc: DesignDoc, id: string, patch: Partial<DesignElement>): DesignDoc {
  return {
    ...doc,
    elements: doc.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)),
  };
}

export function removeElement(doc: DesignDoc, id: string): DesignDoc {
  return { ...doc, elements: doc.elements.filter((e) => e.id !== id) };
}

/** Insert an element on a page at the top of the layer stack. */
export function addElement(doc: DesignDoc, el: DesignElement): DesignDoc {
  const pageEls = doc.elements.filter((e) => e.pageId === el.pageId);
  const maxOrder = pageEls.reduce((m, e) => Math.max(m, e.order), -1);
  return { ...doc, elements: [...doc.elements, { ...el, order: maxOrder + 1 }] };
}

/** Layer ops operate within the element's page only. */
export function reorderElement(
  doc: DesignDoc,
  el: DesignElement,
  op: 'front' | 'back' | 'forward' | 'backward',
): DesignDoc {
  const pageEls = elementsOfPage(doc, el.pageId);
  const idx = pageEls.findIndex((e) => e.id === el.id);
  if (idx < 0) return doc;
  const next = [...pageEls];
  const swapWith =
    op === 'front' ? next.length - 1 : op === 'back' ? 0 : op === 'forward' ? Math.min(next.length - 1, idx + 1) : Math.max(0, idx - 1);
  if (swapWith === idx) return doc;
  const tmp = next[idx];
  next[idx] = next[swapWith];
  next[swapWith] = tmp;
  const orderById = new Map(next.map((e, i) => [e.id, i]));
  return {
    ...doc,
    elements: doc.elements.map((e) =>
      e.pageId === el.pageId && orderById.has(e.id) ? { ...e, order: orderById.get(e.id)! } : e,
    ),
  };
}

export function duplicateElement(doc: DesignDoc, el: DesignElement): { doc: DesignDoc; newId: string } {
  const copy: DesignElement = {
    ...structuredClone(el),
    id: uid('el'),
    x: el.x + 24,
    y: el.y + 24,
  };
  return { doc: addElement(doc, copy), newId: copy.id };
}

/** Align the element to its page (documented alternative to drag-only positioning). */
export function alignToPage(
  doc: DesignDoc,
  el: DesignElement,
  page: Page,
  align: 'left' | 'centerH' | 'right' | 'top' | 'middleV' | 'bottom',
  designWidth: number,
  designHeight: number,
): DesignDoc {
  let { x, y } = el;
  switch (align) {
    case 'left':
      x = 0;
      break;
    case 'centerH':
      x = (designWidth - el.width) / 2;
      break;
    case 'right':
      x = designWidth - el.width;
      break;
    case 'top':
      y = 0;
      break;
    case 'middleV':
      y = (designHeight - el.height) / 2;
      break;
    case 'bottom':
      y = designHeight - el.height;
      break;
  }
  return withElement(doc, el.id, { x: Math.round(x), y: Math.round(y) });
}

export function addPage(doc: DesignDoc, background: Background = '#ffffff'): { doc: DesignDoc; page: Page } {
  const order = doc.pages.reduce((m, p) => Math.max(m, p.order), -1) + 1;
  const page = createPage(doc.design.id, order, background);
  return { doc: { ...doc, pages: [...doc.pages, page] }, page };
}

export function removePage(doc: DesignDoc, pageId: string): DesignDoc {
  if (doc.pages.length <= 1) return doc; // never remove the last page
  const pages = doc.pages.filter((p) => p.id !== pageId);
  const remapped = pages.map((p, i) => ({ ...p, order: i }));
  return {
    ...doc,
    pages: remapped,
    elements: doc.elements.filter((e) => e.pageId !== pageId),
  };
}

export function duplicatePage(doc: DesignDoc, pageId: string): { doc: DesignDoc; page: Page } {
  const src = doc.pages.find((p) => p.id === pageId);
  if (!src) return { doc, page: doc.pages[0] };
  const pages = [...doc.pages].sort((a, b) => a.order - b.order);
  const idx = pages.findIndex((p) => p.id === pageId);
  const copy: Page = { ...src, id: uid('page'), order: idx + 1 };
  const newPages = pages
    .flatMap((p, i) => (i === idx ? [p, copy] : [p]))
    .map((p, i) => ({ ...p, order: i }));
  const copies = doc.elements
    .filter((e) => e.pageId === pageId)
    .map((e) => ({ ...structuredClone(e), id: uid('el'), pageId: copy.id }));
  return { doc: { ...doc, pages: newPages, elements: [...doc.elements, ...copies] }, page: copy };
}

/** Move a page left/right in the order array (keyboard/ button alternative to drag-reorder). */
export function movePage(doc: DesignDoc, pageId: string, dir: -1 | 1): DesignDoc {
  const pages = [...doc.pages].sort((a, b) => a.order - b.order);
  const idx = pages.findIndex((p) => p.id === pageId);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= pages.length) return doc;
  const tmp = pages[idx];
  pages[idx] = pages[target];
  pages[target] = tmp;
  return { ...doc, pages: pages.map((p, i) => ({ ...p, order: i })) };
}

export function setBackground(doc: DesignDoc, pageId: string, background: Background): DesignDoc {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === pageId ? { ...p, background } : p)),
  };
}

/**
 * Recompute derived heights for text elements so the selection box matches
 * the wrapped content (text boxes are top-aligned; width controls wrapping).
 */
export function withTextFit(doc: DesignDoc): DesignDoc {
  let changed = false;
  const elements = doc.elements.map((e) => {
    if (e.type !== 'text') return e;
    const content = e.content as { text: string };
    const s = e.style as {
      fontFamily: string;
      fontSize: number;
      fontWeight: number;
      lineHeight: number;
      italic: boolean;
    };
    const spec = {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      italic: s.italic,
    };
    const lines = wrapText(content.text, e.width, makeMeasure(spec));
    const h = Math.max(s.fontSize, Math.round(lines.length * s.fontSize * s.lineHeight * 100) / 100);
    if (Math.abs(h - e.height) > 0.5) {
      changed = true;
      return { ...e, height: h };
    }
    return e;
  });
  return changed ? { ...doc, elements } : doc;
}

/** Background helpers used by both DOM and canvas renderers. */
export function isGradient(bg: Background): bg is { angle: number; from: string; to: string } {
  return typeof bg !== 'string';
}

export function backgroundToCss(bg: Background): string {
  if (typeof bg === 'string') return bg;
  return `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`;
}
