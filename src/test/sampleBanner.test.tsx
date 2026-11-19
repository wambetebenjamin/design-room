// @vitest-environment jsdom
// End-to-end: the home screen's example-banner button downloads the bundled
// files, creates the design, and lands in the canvas with every precomputed
// text layer and photo slot in place.

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
import { BANNER_LINES, BANNER_PHOTOS } from '../samples/keemsyBannerData';
import { loadExampleBanner } from '../samples/keemsyBanner';
import type { TextContent, TextStyle } from '../domain/types';

const textOf = (el: { content: unknown }): string =>
  el.content && typeof el.content === 'object' && 'text' in el.content
    ? String((el.content as TextContent).text)
    : '';

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

/** Sample fetch mock: plain object with the two methods the loader uses. */
function mockSampleFetch(mode: 'fail' | 'ok'): void {
  (globalThis as unknown as { fetch: unknown }).fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/samples/keemsy-banner')) {
      if (mode === 'fail') return { ok: false, status: 404 };
      const bytes = new Uint8Array(4096).fill(7);
      return {
        ok: true,
        blob: async () => new Blob([bytes], { type: 'image/jpeg' }),
      };
    }
    throw new Error(`Unexpected fetch in sample test: ${url}`);
  }) as unknown as typeof fetch;
}

beforeAll(async () => {
  // validateImageFile decodes through createImageBitmap when available.
  (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = async () => ({
    width: 656,
    height: 1568,
    close() {},
  });
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

describe('example banner', () => {
  it('fails with a clear message when the sample files cannot be downloaded', async () => {
    mockSampleFetch('fail');
    await expect(loadExampleBanner()).rejects.toThrow(/downloaded/);
    expect(useEditor.getState().view).toBe('home');
    expect(useEditor.getState().doc).toBeNull();
  });

  it('opens from the home screen button with all layers ready in the canvas', async () => {
    mockSampleFetch('ok');
    const button = [...container.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Keemsy banner'),
    );
    expect(button).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      (button as HTMLButtonElement).click();
    });
    await waitFor(() => useEditor.getState().view === 'editor', 'editor to open');

    const st = useEditor.getState();
    const doc = st.doc!;
    expect(doc.design.title).toBe('Keemsy Consulting banner');
    expect(doc.design.width).toBe(656);
    expect(doc.design.height).toBe(1568);

    // base image + every precomputed text line + the photo slot
    const expected = 1 + BANNER_LINES.length + BANNER_PHOTOS.length;
    expect(doc.elements.length).toBe(expected);
    expect(doc.elements.filter((e) => e.type === 'text').length).toBe(BANNER_LINES.length);
    expect(doc.elements.filter((e) => e.type === 'image').length).toBe(1 + BANNER_PHOTOS.length);

    const headline = doc.elements.find((e) => e.type === 'text' && textOf(e) === 'MAKE GOOD');
    expect(headline).toBeTruthy();
    expect((headline!.style as TextStyle).fontFamily).toBe('Space Grotesk');

    const phone = doc.elements.find((e) => e.type === 'text' && textOf(e).includes('0728 498 299'));
    expect(phone).toBeTruthy();

    // The design is open and saved, not mid-flight.
    await waitFor(() => useEditor.getState().saveStatus === 'saved', 'autosave to settle');
  });
});
