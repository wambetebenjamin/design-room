// Data access for designs, their pages/elements, assets and templates.
// All functions reject with Error objects carrying a user-actionable message.

import type { Asset, Design, DesignDoc, DesignElement, Page, TemplateDef } from '../domain/types';
import { TEMPLATES } from '../domain/templates';
import { uid } from '../domain/document';
import {
  deleteByIndex,
  deleteKeys,
  getAll,
  getByIndex,
  getOne,
  openDb,
  putAll,
  putOne,
  STORES,
} from './db';

function fail(e: unknown, fallback: string): Error {
  if (e instanceof Error && e.name === 'QuotaExceededError') {
    return new Error('Local storage is full. Delete an old design or upload smaller images, then try again.');
  }
  if (e instanceof Error) return e;
  return new Error(fallback);
}

export async function listDesigns(): Promise<Design[]> {
  try {
    const designs = await getAll<Design>(STORES.designs);
    return designs.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    throw fail(e, 'Could not read your designs from local storage.');
  }
}

export async function loadDoc(designId: string): Promise<DesignDoc | null> {
  try {
    const design = await getOne<Design>(STORES.designs, designId);
    if (!design) return null;
    const pages = await getByIndex<Page>(STORES.pages, 'designId', designId);
    const pageIds = new Set(pages.map((p) => p.id));
    const allElements = await getAll<DesignElement>(STORES.elements);
    const elements = allElements.filter((e) => pageIds.has(e.pageId));
    return {
      design,
      pages: pages.sort((a, b) => a.order - b.order),
      elements,
    };
  } catch (e) {
    throw fail(e, 'Could not open this design.');
  }
}

/**
 * Persist the whole document (pages + elements are rewritten).
 * Assets are stored separately and untouched here.
 */
export async function saveDoc(doc: DesignDoc): Promise<void> {
  try {
    const { design, pages, elements } = doc;
    const existingPages = await getByIndex<Page>(STORES.pages, 'designId', design.id);
    const existingIds = new Set(existingPages.map((p) => p.id));
    const stalePageIds = [...existingIds].filter((id) => !pages.some((p) => p.id === id));
    const keepIds = new Set(pages.map((p) => p.id));
    // Prune every stored element of THIS design that is no longer in the doc:
    // elements on removed pages, and elements deleted from surviving pages.
    const designPageIds = new Set([...existingIds, ...keepIds]);
    const newElementIds = new Set(elements.map((e) => e.id));
    const staleElementIds = (await getAll<DesignElement>(STORES.elements))
      .filter((e) => designPageIds.has(e.pageId) && !newElementIds.has(e.id))
      .map((e) => e.id);

    const db = await openDb();
    const tx = db.transaction([STORES.designs, STORES.pages, STORES.elements], 'readwrite');
    const designStore = tx.objectStore(STORES.designs);
    const pageStore = tx.objectStore(STORES.pages);
    const elStore = tx.objectStore(STORES.elements);
    designStore.put({ ...design, updatedAt: Date.now() });
    for (const p of pages) pageStore.put(p);
    for (const el of elements) elStore.put(el);
    for (const id of stalePageIds) pageStore.delete(id);
    for (const id of staleElementIds) elStore.delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (e) {
    throw fail(e, 'Saving failed. Your changes are still on screen — try again.');
  }
}

export async function renameDesign(designId: string, title: string): Promise<void> {
  try {
    const design = await getOne<Design>(STORES.designs, designId);
    if (!design) return;
    await putOne(STORES.designs, { ...design, title, updatedAt: Date.now() });
  } catch (e) {
    throw fail(e, 'Could not rename the design.');
  }
}

export async function deleteDesign(designId: string): Promise<void> {
  try {
    const pages = await getByIndex<Page>(STORES.pages, 'designId', designId);
    const pageIds = new Set(pages.map((p) => p.id));
    const allElements = await getAll<DesignElement>(STORES.elements);
    await deleteKeys(
      STORES.elements,
      allElements.filter((e) => pageIds.has(e.pageId)).map((e) => e.id),
    );
    await deleteByIndex(STORES.pages, 'designId', designId);
    await deleteByIndex(STORES.assets, 'designId', designId);
    await deleteKeys(STORES.designs, [designId]);
  } catch (e) {
    throw fail(e, 'Could not delete the design.');
  }
}

export async function duplicateDesign(designId: string): Promise<Design> {
  try {
    const doc = await loadDoc(designId);
    if (!doc) throw new Error('That design no longer exists.');
    const newDesignId = uid('design');
    const pageIdMap = new Map<string, string>();
    const pages: Page[] = doc.pages.map((p) => {
      const id = uid('page');
      pageIdMap.set(p.id, id);
      return { ...p, id, designId: newDesignId };
    });
    const assets = await getByIndex<Asset>(STORES.assets, 'designId', designId);
    const assetIdMap = new Map<string, string>();
    const newAssets: Asset[] = assets.map((a) => {
      const id = uid('asset');
      assetIdMap.set(a.id, id);
      return { ...a, id, designId: newDesignId };
    });
    const elements: DesignElement[] = doc.elements.map((e) => {
      const copy = structuredClone(e);
      copy.id = uid('el');
      copy.pageId = pageIdMap.get(e.pageId)!;
      if (copy.type === 'image') {
        const c = copy.content as { assetId: string };
        c.assetId = assetIdMap.get(c.assetId) ?? c.assetId;
      }
      return copy;
    });
    const design: Design = {
      ...doc.design,
      id: newDesignId,
      title: `${doc.design.title} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sample: false,
    };
    await putOne(STORES.designs, design);
    await putAll(STORES.pages, pages);
    await putAll(STORES.elements, elements);
    if (newAssets.length) await putAll(STORES.assets, newAssets);
    return design;
  } catch (e) {
    throw fail(e, 'Could not duplicate the design.');
  }
}

export async function listAssets(designId: string): Promise<Asset[]> {
  try {
    return await getByIndex<Asset>(STORES.assets, 'designId', designId);
  } catch (e) {
    throw fail(e, 'Could not load your uploads.');
  }
}

export async function saveAsset(asset: Asset): Promise<void> {
  try {
    await putOne(STORES.assets, asset);
  } catch (e) {
    throw fail(e, 'Could not store the uploaded image.');
  }
}

export async function ensureTemplatesSeeded(): Promise<void> {
  try {
    await openDb();
    const existing = await getAll<TemplateDef>(STORES.templates);
    if (existing.length >= TEMPLATES.length) return;
    await putAll(STORES.templates, TEMPLATES);
  } catch (e) {
    // Templates are bundled in code; seeding failure is non-fatal.
    console.warn('Template seed failed', e);
  }
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await getOne<{ key: string; value: T }>(STORES.meta, key);
  return row?.value;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await putOne(STORES.meta, { key, value });
}
