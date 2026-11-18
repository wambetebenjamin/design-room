// Loads uploaded assets into decoded HTMLImageElements, cached per asset id.
// Notifies subscribers when an image finishes decoding so views can repaint.

import { useSyncExternalStore } from 'react';
import { loadDesignAssets } from '../store/editorStore';

interface Entry {
  promise: Promise<HTMLImageElement | null>;
  img: HTMLImageElement | null;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  listeners.forEach((l) => l());
}

function load(blob: Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function preloadDesignAssets(designId: string): Promise<void> {
  let assets: { id: string; blob: Blob }[];
  try {
    assets = await loadDesignAssets(designId);
  } catch {
    return;
  }
  const pending: Promise<void>[] = [];
  for (const a of assets) {
    if (cache.has(a.id)) continue;
    const entry: Entry = { promise: load(a.blob), img: null };
    cache.set(a.id, entry);
    pending.push(
      entry.promise.then((img) => {
        entry.img = img;
        notify();
      }),
    );
  }
  await Promise.all(pending);
}

export async function getImage(assetId: string): Promise<HTMLImageElement | null> {
  const entry = cache.get(assetId);
  if (!entry) return null;
  return entry.promise;
}

export function getImageSync(assetId: string): HTMLImageElement | null {
  return cache.get(assetId)?.img ?? null;
}

export function clearImageCache(): void {
  cache.clear();
  notify();
}

/** React hook: re-render when any cached image finishes loading. */
export function useImageVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
}
