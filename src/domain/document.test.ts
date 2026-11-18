import { describe, expect, it } from 'vitest';
import {
  addElement,
  addPage,
  alignToPage,
  duplicatePage,
  elementsOfPage,
  movePage,
  removeElement,
  removePage,
  reorderElement,
  withTextFit,
} from './document';
import type { DesignDoc, DesignElement } from './types';

function makeDoc(): DesignDoc {
  const design = { id: 'd1', title: 'T', width: 1000, height: 1000, createdAt: 0, updatedAt: 0 };
  const p1 = { id: 'p1', designId: 'd1', background: '#ffffff' as const, order: 0 };
  const p2 = { id: 'p2', designId: 'd1', background: '#000000' as const, order: 1 };
  const el = (id: string, pageId: string, order: number): DesignElement => ({
    id,
    pageId,
    type: 'shape',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    order,
    content: {},
    style: { shape: 'rect', fill: '#12B5A9', radius: 0 },
  });
  return {
    design,
    pages: [p1, p2],
    elements: [el('a', 'p1', 0), el('b', 'p1', 1), el('c', 'p2', 0)],
  };
}

describe('multi-page independence', () => {
  it('reordering on one page does not touch the other page', () => {
    const doc = makeDoc();
    const a = doc.elements.find((e) => e.id === 'a')!;
    const next = reorderElement(doc, a, 'forward');
    const p1 = elementsOfPage(next, 'p1').map((e) => e.id);
    const p2 = elementsOfPage(next, 'p2').map((e) => e.id);
    expect(p1).toEqual(['b', 'a']);
    expect(p2).toEqual(['c']);
    // untouched page keeps identical objects
    expect(next.elements.find((e) => e.id === 'c')).toBe(doc.elements.find((e) => e.id === 'c'));
  });

  it('removing a page removes only its elements', () => {
    const doc = makeDoc();
    const next = removePage(doc, 'p2');
    expect(next.pages).toHaveLength(1);
    expect(next.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('never removes the last page', () => {
    const doc = makeDoc();
    const onePage = removePage(doc, 'p2');
    const none = removePage(onePage, 'p1');
    expect(none.pages).toHaveLength(1);
    expect(none.elements).toHaveLength(2);
  });
});

describe('layering', () => {
  it('front/back/forward/backward swap orders within the page', () => {
    const doc = makeDoc();
    const a = doc.elements.find((e) => e.id === 'a')!;
    const b = doc.elements.find((e) => e.id === 'b')!;
    expect(elementsOfPage(reorderElement(doc, a, 'front'), 'p1').map((e) => e.id)).toEqual(['b', 'a']);
    expect(elementsOfPage(reorderElement(doc, b, 'back'), 'p1').map((e) => e.id)).toEqual(['b', 'a']);
    // a is already at the back, b already at the front: no-ops
    expect(reorderElement(doc, a, 'backward')).toBe(doc);
    expect(reorderElement(doc, b, 'forward')).toBe(doc);
    // but from the reversed state the ops work
    const reversed = reorderElement(doc, a, 'front');
    const a2 = reversed.elements.find((e) => e.id === 'a')!;
    expect(elementsOfPage(reorderElement(reversed, a2, 'backward'), 'p1').map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('no-op at the edges', () => {
    const doc = makeDoc();
    const a = doc.elements.find((e) => e.id === 'a')!;
    expect(reorderElement(doc, a, 'back')).toBe(doc);
    const b = doc.elements.find((e) => e.id === 'b')!;
    expect(reorderElement(doc, b, 'front')).toBe(doc);
  });
});

describe('pages', () => {
  it('duplicatePage copies elements with new ids on the new page', () => {
    const doc = makeDoc();
    const { doc: next, page } = duplicatePage(doc, 'p1');
    expect(next.pages).toHaveLength(3);
    const copies = elementsOfPage(next, page.id);
    expect(copies).toHaveLength(2);
    expect(copies[0].id).not.toBe('a');
    expect(copies.map((e) => e.order)).toEqual([0, 1]);
  });

  it('movePage swaps orders and is a no-op at the ends', () => {
    const doc = makeDoc();
    const moved = movePage(doc, 'p2', -1);
    expect(moved.pages.find((p) => p.id === 'p2')!.order).toBe(0);
    expect(moved.pages.find((p) => p.id === 'p1')!.order).toBe(1);
    expect(movePage(doc, 'p1', -1)).toBe(doc); // already first
    expect(movePage(doc, 'p2', 1)).toBe(doc); // already last
  });

  it('addPage appends in order', () => {
    const doc = makeDoc();
    const { doc: next, page } = addPage(doc, '#ff0000');
    expect(page.order).toBe(2);
    expect(next.pages).toHaveLength(3);
  });
});

describe('align', () => {
  it('aligns to page bounds', () => {
    const doc = makeDoc();
    const a = doc.elements.find((e) => e.id === 'a')!;
    const page = doc.pages[0];
    expect(alignToPage(doc, a, page, 'left', 1000, 1000).elements[0].x).toBe(0);
    expect(alignToPage(doc, a, page, 'centerH', 1000, 1000).elements[0].x).toBe(450);
    expect(alignToPage(doc, a, page, 'right', 1000, 1000).elements[0].x).toBe(900);
    expect(alignToPage(doc, a, page, 'bottom', 1000, 1000).elements[0].y).toBe(900);
  });
});

describe('addElement / removeElement', () => {
  it('new elements land on top of their page', () => {
    const doc = makeDoc();
    const el: DesignElement = {
      id: 'z',
      pageId: 'p1',
      type: 'text',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 1,
      order: 99,
      content: { text: 'x' },
      style: {
        fontFamily: 'Inter',
        fontSize: 12,
        fontWeight: 400,
        color: '#000000',
        align: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        italic: false,
      },
    };
    const next = addElement(doc, el);
    expect(elementsOfPage(next, 'p1').map((e) => e.id)).toEqual(['a', 'b', 'z']);
    expect(elementsOfPage(next, 'p1')[2].order).toBe(2);
  });

  it('removeElement only drops the target', () => {
    const doc = makeDoc();
    const next = removeElement(doc, 'a');
    expect(next.elements.map((e) => e.id)).toEqual(['b', 'c']);
  });
});

describe('withTextFit', () => {
  it('derives text height from wrapped line count', () => {
    const doc = makeDoc();
    const textEl: DesignElement = {
      id: 't1',
      pageId: 'p1',
      type: 'text',
      x: 0,
      y: 0,
      width: 200,
      height: 10,
      rotation: 0,
      opacity: 1,
      order: 5,
      content: { text: 'one two three four five six seven eight nine ten' },
      style: {
        fontFamily: 'Inter',
        fontSize: 20,
        fontWeight: 400,
        color: '#000000',
        align: 'left',
        lineHeight: 1.5,
        letterSpacing: 0,
        italic: false,
      },
    };
    const next = withTextFit({ ...doc, elements: [...doc.elements, textEl] });
    const out = next.elements.find((e) => e.id === 't1')!;
    expect(out.height).toBeGreaterThan(20); // wrapped to multiple lines
    expect(out.height).toBeGreaterThanOrEqual(30); // at least 1 line * 20 * 1.5
  });
});
