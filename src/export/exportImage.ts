// Export: single-page PNG/JPEG, all-pages ZIP, and portable JSON.

import JSZip from 'jszip';
import type { DesignDoc } from '../domain/types';
import { renderPageToCanvas, ensureFontsLoaded } from '../render/canvasRenderer';
import { validateDocument } from '../domain/validate';

export type ImageFormat = 'png' | 'jpeg';

export interface ExportProgress {
  done: number;
  total: number;
  label: string;
}

function safeFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[^a-z0-9-_ ]/gi, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return base || 'design';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function canvasToBlob(canvas: HTMLCanvasElement, format: ImageFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode the image. Try a smaller scale.'));
      },
      format === 'png' ? 'image/png' : 'image/jpeg',
      quality,
    );
  });
}

function orderedPages(doc: DesignDoc) {
  return [...doc.pages].sort((a, b) => a.order - b.order);
}

/** Export one page at the chosen scale. Returns true when a file was downloaded. */
export async function exportPageImage(
  doc: DesignDoc,
  pageIndex: number,
  format: ImageFormat,
  scale: number,
  onProgress?: (p: ExportProgress) => void,
): Promise<void> {
  onProgress?.({ done: 0, total: 1, label: 'Preparing fonts…' });
  await ensureFontsLoaded(doc);
  const pages = orderedPages(doc);
  const page = pages[pageIndex];
  if (!page) throw new Error('That page no longer exists.');
  onProgress?.({ done: 0, total: 1, label: 'Rendering…' });
  const canvas = renderPageToCanvas(doc, page, scale);
  const blob = await canvasToBlob(canvas, format, 0.92);
  onProgress?.({ done: 1, total: 1, label: 'Downloading…' });
  const ext = format === 'png' ? 'png' : 'jpg';
  triggerDownload(blob, `${safeFilename(doc.design.title)}-p${pageIndex + 1}@${scale}x.${ext}`);
}

/** Export every page as PNG into a single ZIP. */
export async function exportAllPagesZip(
  doc: DesignDoc,
  format: ImageFormat,
  scale: number,
  onProgress?: (p: ExportProgress) => void,
): Promise<void> {
  const pages = orderedPages(doc);
  if (pages.length === 0) throw new Error('This design has no pages.');
  await ensureFontsLoaded(doc);
  const zip = new JSZip();
  const folder = zip.folder(safeFilename(doc.design.title)) ?? zip;
  for (let i = 0; i < pages.length; i++) {
    onProgress?.({ done: i, total: pages.length, label: `Rendering page ${i + 1} of ${pages.length}…` });
    const canvas = renderPageToCanvas(doc, pages[i], scale);
    const blob = await canvasToBlob(canvas, format, 0.92);
    const ext = format === 'png' ? 'png' : 'jpg';
    folder.file(`page-${String(i + 1).padStart(2, '0')}@${scale}x.${ext}`, blob);
  }
  onProgress?.({ done: pages.length, total: pages.length, label: 'Packing ZIP…' });
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${safeFilename(doc.design.title)}-pages.zip`);
}

/** Portable JSON document: validated before it is written. */
export function docToJson(doc: DesignDoc): string {
  const payload = {
    schema: 'chrisco-design-room/v1',
    exportedAt: new Date().toISOString(),
    design: doc.design,
    pages: doc.pages,
    elements: doc.elements,
  };
  const check = validateDocument(payload);
  if (!check.ok) {
    throw new Error(`This document failed validation and was not exported: ${check.errors[0]}`);
  }
  return JSON.stringify(payload, null, 2);
}

export function exportJson(doc: DesignDoc): void {
  const json = docToJson(doc);
  const blob = new Blob([json], { type: 'application/json' });
  triggerDownload(blob, `${safeFilename(doc.design.title)}.json`);
}
