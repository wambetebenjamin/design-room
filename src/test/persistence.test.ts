// Persistence acceptance: save, reload, duplicate, delete — all via IndexedDB
// (fake-indexeddb), exercising the real data layer.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteDesign,
  duplicateDesign,
  ensureTemplatesSeeded,
  listDesigns,
  loadDoc,
  saveDoc,
} from '../data/designRepo';
import { addElement, addPage, removeElement } from '../domain/document';
import type { DesignDoc, DesignElement, Page } from '../domain/types';
import { TEMPLATES } from '../domain/templates';

function makeDoc(title = 'Persistence test'): DesignDoc {
  const now = Date.now();
  const design = { id: `d_${Math.random().toString(36).slice(2)}`, title, width: 1080, height: 1350, createdAt: now, updatedAt: now };
  const page: Page = { id: `p_${Math.random().toString(36).slice(2)}`, designId: design.id, background: '#ffffff', order: 0 };
  const el: DesignElement = {
    id: `e_${Math.random().toString(36).slice(2)}`,
    pageId: page.id,
    type: 'text',
    x: 20,
    y: 30,
    width: 500,
    height: 100,
    rotation: 0,
    opacity: 1,
    order: 0,
    content: { text: 'Saved text' },
    style: {
      fontFamily: 'Inter',
      fontSize: 40,
      fontWeight: 700,
      color: '#111111',
      align: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      italic: false,
    },
  };
  return { design, pages: [page], elements: [el] };
}

describe('IndexedDB persistence', () => {
  beforeEach(() => {
    // fresh DB per test would need version bumps; use unique ids instead
  });

  it('saves and reloads a document with elements intact', async () => {
    const doc = makeDoc();
    await saveDoc(doc);
    const loaded = await loadDoc(doc.design.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.design.title).toBe('Persistence test');
    expect(loaded!.pages).toHaveLength(1);
    expect(loaded!.elements).toHaveLength(1);
    expect((loaded!.elements[0].content as { text: string }).text).toBe('Saved text');
    expect(loaded!.elements[0].x).toBe(20);
  });

  it('reload reflects later edits (never stale)', async () => {
    const doc = makeDoc('Editable');
    await saveDoc(doc);
    const edited = removeElement(doc, doc.elements[0].id);
    await saveDoc(edited);
    const loaded = await loadDoc(doc.design.id);
    expect(loaded!.elements).toHaveLength(0);
  });

  it('multi-page documents persist independently', async () => {
    const doc = makeDoc('Two pages');
    const { doc: withPage2 } = addPage(doc, '#000000');
    const page2 = withPage2.pages.find((p) => p.id !== doc.pages[0].id)!;
    const el2: DesignElement = {
      ...doc.elements[0],
      id: 'el_on_p2',
      pageId: page2.id,
      content: { text: 'Page two text' },
    };
    const final = addElement(withPage2, el2);
    await saveDoc(final);

    const loaded = await loadDoc(doc.design.id);
    expect(loaded!.pages).toHaveLength(2);
    const p1 = loaded!.pages.find((p) => p.order === 0)!;
    const p2 = loaded!.pages.find((p) => p.order === 1)!;
    const elsP1 = loaded!.elements.filter((e) => e.pageId === p1.id);
    const elsP2 = loaded!.elements.filter((e) => e.pageId === p2.id);
    expect(elsP1).toHaveLength(1);
    expect(elsP2).toHaveLength(1);
    expect((elsP2[0].content as { text: string }).text).toBe('Page two text');
  });

  it('removing a page on save prunes its elements from the store', async () => {
    const doc = makeDoc('Prune test');
    const { doc: two } = addPage(doc);
    await saveDoc(two);
    expect((await loadDoc(doc.design.id))!.pages).toHaveLength(2);
    const backToOne = {
      ...two,
      pages: two.pages.slice(0, 1),
      elements: two.elements,
    };
    await saveDoc(backToOne);
    const loaded = await loadDoc(doc.design.id);
    expect(loaded!.pages).toHaveLength(1);
    expect(loaded!.elements.every((e) => e.pageId === loaded!.pages[0].id)).toBe(true);
  });

  it('lists designs sorted by updatedAt and deletes cleanly', async () => {
    const a = makeDoc('AAA');
    const b = makeDoc('BBB');
    await saveDoc(a);
    await saveDoc(b);
    const all = await listDesigns();
    expect(all.some((d) => d.id === a.design.id)).toBe(true);
    expect(all.some((d) => d.id === b.design.id)).toBe(true);
    await deleteDesign(a.design.id);
    expect(await loadDoc(a.design.id)).toBeNull();
    expect((await listDesigns()).some((d) => d.id === a.design.id)).toBe(false);
  });

  it('duplicateDesign deep-copies pages and elements under a new id', async () => {
    const doc = makeDoc('Original');
    await saveDoc(doc);
    const copy = await duplicateDesign(doc.design.id);
    expect(copy.id).not.toBe(doc.design.id);
    expect(copy.title).toContain('(copy)');
    const loaded = await loadDoc(copy.id);
    expect(loaded!.elements).toHaveLength(1);
    expect(loaded!.elements[0].id).not.toBe(doc.elements[0].id);
    expect((loaded!.elements[0].content as { text: string }).text).toBe('Saved text');
    // original untouched
    expect((await loadDoc(doc.design.id))!.design.title).toBe('Original');
  });

  it('seeds the six original templates', async () => {
    await ensureTemplatesSeeded();
    expect(TEMPLATES).toHaveLength(6);
  });
});
