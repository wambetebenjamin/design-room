// Minimal promise-based IndexedDB wrapper for CHRISCO Design Room.
// Stores: designs, pages, elements, assets, templates, meta.

import type { Asset, Design, DesignElement, Page, TemplateDef } from '../domain/types';

const DB_NAME = 'chrisco-design-room';
const DB_VERSION = 1;

export const STORES = {
  designs: 'designs',
  pages: 'pages',
  elements: 'elements',
  assets: 'assets',
  templates: 'templates',
  meta: 'meta',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.designs)) db.createObjectStore(STORES.designs, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.pages)) {
        const s = db.createObjectStore(STORES.pages, { keyPath: 'id' });
        s.createIndex('designId', 'designId');
      }
      if (!db.objectStoreNames.contains(STORES.elements)) {
        const s = db.createObjectStore(STORES.elements, { keyPath: 'id' });
        s.createIndex('pageId', 'pageId');
      }
      if (!db.objectStoreNames.contains(STORES.assets)) {
        const s = db.createObjectStore(STORES.assets, { keyPath: 'id' });
        s.createIndex('designId', 'designId');
      }
      if (!db.objectStoreNames.contains(STORES.templates)) db.createObjectStore(STORES.templates, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open the local database.'));
    req.onblocked = () => reject(new Error('The local database is blocked by another tab.'));
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Database transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Database transaction aborted.'));
  });
}

export async function putAll<T>(store: string, items: T[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const item of items) os.put(item);
  await txDone(tx);
}

export async function putOne<T>(store: string, item: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(item);
  await txDone(tx);
}

export async function getAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error ?? new Error('Failed to read from the local database.'));
  });
}

export async function getByIndex<T>(store: string, index: string, value: string): Promise<T[]> {
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).index(index).getAll(value);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error ?? new Error('Failed to read from the local database.'));
  });
}

export async function getOne<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error('Failed to read from the local database.'));
  });
}

export async function deleteKeys(store: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const k of keys) os.delete(k);
  await txDone(tx);
}

export async function deleteByIndex(store: string, index: string, value: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const req = tx.objectStore(store).index(index).getAll(value);
  req.onsuccess = () => {
    const os = tx.objectStore(store);
    for (const item of req.result as { id: string }[]) os.delete(item.id);
  };
  await txDone(tx);
}

/** Run several store mutations in one atomic transaction. */
export async function runTx(
  stores: string[],
  fn: (tx: IDBTransaction) => void,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(stores, 'readwrite');
  fn(tx);
  await txDone(tx);
}

export type { Asset, Design, DesignElement, Page, TemplateDef };
