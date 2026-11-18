// History behaviour: grouped edit operations undo as a single step.

import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from './editorStore';
import type { DesignDoc, DesignElement } from '../domain/types';

function sampleDoc(): DesignDoc {
  const design = { id: 'd1', title: 'T', width: 1000, height: 1000, createdAt: 0, updatedAt: 0 };
  const page = { id: 'p1', designId: 'd1', background: '#ffffff' as const, order: 0 };
  const el = (id: string, x: number): DesignElement => ({
    id,
    pageId: 'p1',
    type: 'shape',
    x,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    order: 0,
    content: {},
    style: { shape: 'rect', fill: '#12B5A9', radius: 0 },
  });
  return { design, pages: [page], elements: [el('a', 0), el('b', 200)] };
}

function reset() {
  useEditor.setState({
    view: 'editor',
    doc: sampleDoc(),
    currentPageId: 'p1',
    selectionId: 'a',
    past: [],
    future: [],
    txSnapshot: null,
    saveStatus: 'idle',
    saveError: null,
    cropMode: false,
    editingTextId: null,
  });
}

describe('grouped undo/redo', () => {
  beforeEach(reset);

  it('a grouped drag (begin → live moves → end) is ONE undo step', () => {
    const s = useEditor.getState();
    s.beginTx();
    s.patchSelectedLive({ x: 10 });
    s.patchSelectedLive({ x: 20 });
    s.patchSelectedLive({ x: 30 });
    s.endTx();

    expect(useEditor.getState().doc!.elements.find((e) => e.id === 'a')!.x).toBe(30);
    expect(useEditor.getState().past).toHaveLength(1);

    useEditor.getState().undo();
    expect(useEditor.getState().doc!.elements.find((e) => e.id === 'a')!.x).toBe(0);
    expect(useEditor.getState().future).toHaveLength(1);

    useEditor.getState().redo();
    expect(useEditor.getState().doc!.elements.find((e) => e.id === 'a')!.x).toBe(30);
  });

  it('multiple object changes each undo separately, in order', () => {
    const s = useEditor.getState();
    s.patchSelected({ x: 50 });
    s.select('b');
    s.patchSelected({ y: 75 });
    s.select('a');
    s.deleteSelected();

    const st = useEditor.getState();
    expect(st.past).toHaveLength(3);
    expect(st.doc!.elements.map((e) => e.id)).toEqual(['b']);

    useEditor.getState().undo(); // undelete a
    expect(useEditor.getState().doc!.elements.map((e) => e.id)).toEqual(['a', 'b']);
    useEditor.getState().undo(); // undo b.y
    expect(useEditor.getState().doc!.elements.find((e) => e.id === 'b')!.y).toBe(0);
    useEditor.getState().undo(); // undo a.x
    expect(useEditor.getState().doc!.elements.find((e) => e.id === 'a')!.x).toBe(0);
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().future).toHaveLength(3);
  });

  it('undo clears selection if the element disappeared', () => {
    const s = useEditor.getState();
    s.deleteSelected();
    expect(useEditor.getState().selectionId).toBeNull();
    useEditor.getState().undo();
    expect(useEditor.getState().doc!.elements).toHaveLength(2);
  });

  it('a no-op transaction does not create history', () => {
    const s = useEditor.getState();
    s.beginTx();
    s.endTx();
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it('new edit clears the redo stack', () => {
    const s = useEditor.getState();
    s.patchSelected({ x: 5 });
    useEditor.getState().undo();
    expect(useEditor.getState().future).toHaveLength(1);
    useEditor.getState().patchSelected({ x: 9 });
    expect(useEditor.getState().future).toHaveLength(0);
  });
});

describe('clipboard and quick text', () => {
  beforeEach(reset);

  it('paste with an empty clipboard is a safe no-op', () => {
    // Runs first so the module-level clipboard is still empty.
    useEditor.getState().pasteClipboard();
    const st = useEditor.getState();
    expect(st.doc!.elements).toHaveLength(2);
    expect(st.past).toHaveLength(0);
    expect(st.toasts.some((t) => /Nothing to paste/.test(t.message))).toBe(true);
  });

  it('copy then paste adds an offset clone, selected and undoable as one step', () => {
    useEditor.getState().copySelected(); // selection is 'a'
    useEditor.getState().pasteClipboard();
    const st = useEditor.getState();
    expect(st.doc!.elements).toHaveLength(3);
    const orig = st.doc!.elements.find((e) => e.id === 'a')!;
    const pasted = st.doc!.elements.find((e) => e.id === st.selectionId)!;
    expect(pasted.id).not.toBe('a');
    expect(pasted.x).toBe(orig.x + 24);
    expect(pasted.y).toBe(orig.y + 24);
    expect(st.past).toHaveLength(1);

    st.undo();
    expect(useEditor.getState().doc!.elements).toHaveLength(2);
  });

  it('cut removes the object but paste brings it back', () => {
    useEditor.getState().cutSelected();
    expect(useEditor.getState().doc!.elements.map((e) => e.id)).toEqual(['b']);
    expect(useEditor.getState().selectionId).toBeNull();

    useEditor.getState().pasteClipboard();
    const st = useEditor.getState();
    expect(st.doc!.elements).toHaveLength(2);
    // Pasted copy gets a fresh id and the +24 offset.
    const pasted = st.doc!.elements.find((e) => e.id === st.selectionId)!;
    expect(pasted).toBeTruthy();
    expect(pasted.x).toBe(24);
    expect(pasted.y).toBe(24);
  });

  it('addText at a double-click point centres the box on that point', () => {
    useEditor.getState().addText(undefined, { x: 500, y: 500 });
    const el = useEditor.getState().doc!.elements.find((e) => e.type === 'text')!;
    expect(el.x).toBeLessThanOrEqual(500);
    expect(el.x + el.width).toBeGreaterThanOrEqual(500);
    expect(el.y).toBeLessThanOrEqual(500);
    expect(el.y + el.height).toBeGreaterThanOrEqual(500);
    expect(el.content).toEqual({ text: 'Your text here' });
  });

  it('addText without a point keeps the classic top-left placement', () => {
    useEditor.getState().addText();
    const el = useEditor.getState().doc!.elements.find((e) => e.type === 'text')!;
    expect(el.x).toBe(100); // 10% of 1000
    expect(el.y).toBe(100);
  });
});
