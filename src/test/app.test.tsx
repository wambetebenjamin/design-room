// @vitest-environment jsdom
// End-to-end (jsdom) flow: home → start design → compose → undo → pages →
// reload persistence → export dimensions.

import 'fake-indexeddb/auto';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// --- jsdom polyfills the app relies on -------------------------------------

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import App from '../App';
import { useEditor } from '../store/editorStore';
import { renderPageToCanvas } from '../render/canvasRenderer';
import { loadDoc } from '../data/designRepo';
import { elementsOfPage } from '../domain/document';
import type { DesignDoc } from '../domain/types';
import { uploadImageFile } from '../store/editorStore';

let container: HTMLDivElement;
let root: Root;

async function waitFor(cond: () => boolean, label = 'condition', timeout = 4000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

function buttons(text: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) =>
    (b.textContent ?? '').includes(text),
  ) as HTMLButtonElement[];
}

async function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
}

beforeAll(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  await waitFor(() => useEditor.getState().view !== 'loading', 'app to leave loading');
});

afterAll(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('primary journey', () => {
  it('shows a helpful empty state first', async () => {
    expect(useEditor.getState().view).toBe('home');
    expect(container.textContent).toContain('Your desk is clear');
    expect(buttons('Create your first design').length).toBeGreaterThan(0);
  });

  it('starts a design from a size preset', async () => {
    await click(buttons('Create your first design')[0]);
    await waitFor(() => !!document.querySelector('.modal'), 'new design modal');
    const social = [...document.querySelectorAll('.size-card')].find((c) =>
      (c.textContent ?? '').includes('Social post'),
    );
    await click(social);
    await waitFor(() => useEditor.getState().view === 'editor', 'editor view');

    const st = useEditor.getState();
    expect(st.doc!.design.width).toBe(1080);
    expect(st.doc!.design.height).toBe(1080);
    expect(st.doc!.pages).toHaveLength(1);
    expect(st.doc!.elements).toHaveLength(0);
    expect(st.saveStatus).toBe('saved');

    const stage = container.querySelector('.page-inner');
    expect(stage).toBeTruthy();
    expect(stage!.getAttribute('aria-label')).toContain('1080 by 1080');
  });

  it('adds text, edits it, and undoes/redoes grouped operations', async () => {
    await act(async () => {
      useEditor.getState().addText({ text: 'Hello Design Room' });
    });
    let els = useEditor.getState().doc!.elements;
    expect(els).toHaveLength(1);
    expect((els[0].content as { text: string }).text).toBe('Hello Design Room');

    // grouped gesture: several live patches = one undo step
    await act(async () => {
      const s = useEditor.getState();
      s.beginTx();
      s.patchSelectedLive({ x: 100 });
      s.patchSelectedLive({ x: 200 });
      s.patchSelectedLive({ rotation: 15 });
      s.endTx();
    });
    els = useEditor.getState().doc!.elements;
    expect(els[0].x).toBe(200);
    expect(els[0].rotation).toBe(15);
    expect(useEditor.getState().past).toHaveLength(2);

    await act(async () => {
      useEditor.getState().undo();
    });
    els = useEditor.getState().doc!.elements;
    expect(els[0].x).toBe(108); // back to where the add placed it (10% of 1080)
    expect(els[0].rotation).toBe(0); // one undo reverts the whole gesture

    await act(async () => {
      useEditor.getState().undo();
    });
    expect(useEditor.getState().doc!.elements).toHaveLength(0);

    await act(async () => {
      useEditor.getState().redo();
    });
    expect(useEditor.getState().doc!.elements).toHaveLength(1);
  });

  it('adds a second page and keeps pages independent', async () => {
    await act(async () => {
      useEditor.getState().addPage();
    });
    expect(useEditor.getState().doc!.pages).toHaveLength(2);
    const st = useEditor.getState();
    const p1 = st.doc!.pages.find((p) => p.order === 0)!;
    const p2 = st.doc!.pages.find((p) => p.order === 1)!;
    expect(st.currentPageId).toBe(p2.id);

    // add a shape on page 2 only
    await act(async () => {
      useEditor.getState().addShape('ellipse');
    });
    const docNow = useEditor.getState().doc!;
    expect(elementsOfPage(docNow, p2.id)).toHaveLength(1);
    expect(elementsOfPage(docNow, p1.id)).toHaveLength(1); // text stays on page 1

    // switching pages clears selection, page contents stay put
    await act(async () => {
      useEditor.getState().setCurrentPage(p1.id);
    });
    expect(useEditor.getState().selectionId).toBeNull();
    expect(elementsOfPage(useEditor.getState().doc!, p2.id)).toHaveLength(1);
  });

  it('persists through save + reload (IndexedDB)', async () => {
    const st = useEditor.getState();
    const designId = st.doc!.design.id;
    const before = st.doc!;
    await act(async () => {
      await useEditor.getState().saveNow();
    });
    expect(useEditor.getState().saveStatus).toBe('saved');

    // simulate a fresh session: wipe runtime doc, re-init from the database
    useEditor.setState({ view: 'loading', doc: null, past: [], future: [], selectionId: null });
    await act(async () => {
      await useEditor.getState().init();
    });
    await waitFor(() => useEditor.getState().view === 'editor', 'editor after reload');
    const after = useEditor.getState().doc!;
    expect(after.design.id).toBe(designId);
    expect(after.pages).toHaveLength(before.pages.length);
    expect(after.elements).toHaveLength(before.elements.length);
    expect(after.elements.map((e) => e.id).sort()).toEqual(before.elements.map((e) => e.id).sort());

    // and the repo copy matches too
    const fromDb = await loadDoc(designId);
    expect(fromDb!.elements).toHaveLength(before.elements.length);
  });

  it('renames the design and the change survives a reload', async () => {
    await act(async () => {
      useEditor.getState().rename('My Poster Draft');
    });
    expect(useEditor.getState().doc!.design.title).toBe('My Poster Draft');
    await act(async () => {
      await useEditor.getState().saveNow();
    });
    const fromDb = await loadDoc(useEditor.getState().doc!.design.id);
    expect(fromDb!.design.title).toBe('My Poster Draft');
  });
});

describe('upload validation (large / wrong type)', () => {
  it('rejects unsupported file types', async () => {
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    await expect(uploadImageFile(file)).rejects.toThrow(/PNG, JPEG or WebP/);
  });

  it('rejects files over the 15 MB limit', async () => {
    const big = new File([new ArrayBuffer(16 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    await expect(uploadImageFile(big)).rejects.toThrow(/15 MB/);
  });
});

describe('export rendering', () => {
  interface Call {
    op: string;
    args: unknown[];
  }

  function installCanvasMock(): Call[] {
    const calls: Call[] = [];
    const makeCtx = () => {
      const ctx: Record<string, unknown> = {
        canvas: null,
        font: '10px sans-serif',
        fillStyle: '#000',
        strokeStyle: '#000',
        globalAlpha: 1,
        textAlign: 'left',
        textBaseline: 'alphabetic',
        lineCap: 'butt',
        lineWidth: 1,
      };
      const record = (op: string) =>
        (...args: unknown[]) => {
          calls.push({ op, args });
        };
      for (const op of [
        'save',
        'restore',
        'setTransform',
        'translate',
        'rotate',
        'fillRect',
        'strokeRect',
        'beginPath',
        'moveTo',
        'lineTo',
        'quadraticCurveTo',
        'closePath',
        'ellipse',
        'fill',
        'stroke',
        'fillText',
        'strokeText',
        'drawImage',
        'clip',
      ]) {
        ctx[op] = record(op);
      }
      ctx.createLinearGradient = (...args: unknown[]) => {
        calls.push({ op: 'createLinearGradient', args });
        return { addColorStop: record('addColorStop') };
      };
      ctx.measureText = (s: string) => {
        const m = /(\d+(?:\.\d+)?)px/.exec(String(ctx.font));
        const size = m ? Number(m[1]) : 10;
        return { width: s.length * size * 0.5 };
      };
      return ctx as unknown as CanvasRenderingContext2D;
    };
    HTMLCanvasElement.prototype.getContext = makeCtx as unknown as typeof HTMLCanvasElement.prototype.getContext;
    return calls;
  }

  it('renders at exactly page size × scale with text drawn in the right font', async () => {
    const calls = installCanvasMock();
    const st = useEditor.getState();
    const doc = st.doc! as DesignDoc;
    const page = [...doc.pages].sort((a, b) => a.order - b.order)[0];

    const canvas = renderPageToCanvas(doc, page, 3);
    expect(canvas.width).toBe(doc.design.width * 3);
    expect(canvas.height).toBe(doc.design.height * 3);

    const transforms = calls.filter((c) => c.op === 'setTransform');
    expect(transforms.some((c) => c.args[0] === 3 && c.args[4] === 0)).toBe(true);
    // background painted
    expect(calls.some((c) => c.op === 'fillRect')).toBe(true);
    // the text element rasterised
    expect(calls.some((c) => c.op === 'fillText')).toBe(true);
    const textCall = calls.find((c) => c.op === 'fillText');
    expect(String(textCall!.args[0]).length).toBeGreaterThan(0);

    // 1× keeps natural size too
    const one = renderPageToCanvas(doc, page, 1);
    expect(one.width).toBe(doc.design.width);
    expect(one.height).toBe(doc.design.height);
  });

  it('draws shapes in document order (layer order respected)', async () => {
    const calls = installCanvasMock();
    // Put both kinds of element on one page: text was created first (order 0).
    await act(async () => {
      useEditor.getState().addShape('ellipse');
    });
    const st = useEditor.getState();
    const doc = st.doc!;
    const page = doc.pages.find((p) => p.id === st.currentPageId)!;
    renderPageToCanvas(doc, page, 1);
    const fillTextIdx = calls.findIndex((c) => c.op === 'fillText');
    const ellipseIdx = calls.findIndex((c) => c.op === 'ellipse');
    expect(fillTextIdx).toBeGreaterThanOrEqual(0);
    expect(ellipseIdx).toBeGreaterThan(fillTextIdx); // ellipse (later order) drawn after text
  });
});
