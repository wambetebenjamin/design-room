// Validation for portable JSON documents (export + import).
// Imported JSON is untrusted: every field is checked before it reaches state.

import type { Background, Design, DesignDoc, DesignElement, ElementType, Page } from './types';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/;
const NAMED_OK = new Set(['white', 'black', 'transparent']);

export function isSafeColor(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s.length > 40) return false;
  return HEX_RE.test(s) || RGB_RE.test(s) || NAMED_OK.has(s.toLowerCase());
}

export function isBackground(v: unknown): v is Background {
  if (typeof v === 'string') return isSafeColor(v);
  if (v && typeof v === 'object') {
    const g = v as Record<string, unknown>;
    return (
      typeof g.angle === 'number' &&
      Number.isFinite(g.angle) &&
      isSafeColor(g.from) &&
      isSafeColor(g.to)
    );
  }
  return false;
}

function isNum(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

const ELEMENT_TYPES: ElementType[] = ['text', 'shape', 'image'];
const SHAPES = ['rect', 'ellipse', 'triangle', 'star', 'line'];
const ALIGNS = ['left', 'center', 'right'];

/**
 * Validate a parsed JSON value as a portable design document.
 * Returns a list of human-readable errors (empty when valid).
 */
export function validateDocument(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['Root value must be a JSON object.'] };
  }
  const root = value as Record<string, unknown>;

  if (root.schema !== 'chrisco-design-room/v1') {
    errors.push('Unsupported or missing "schema" (expected "chrisco-design-room/v1").');
  }

  const design = root.design as Record<string, unknown> | undefined;
  if (!design || typeof design !== 'object') {
    errors.push('Missing "design" object.');
  } else {
    if (typeof design.id !== 'string' || design.id.length === 0) errors.push('design.id must be a non-empty string.');
    if (typeof design.title !== 'string' || design.title.length > 200) errors.push('design.title must be a string of at most 200 characters.');
    if (!isNum(design.width, 16, 10000)) errors.push('design.width must be a number between 16 and 10000.');
    if (!isNum(design.height, 16, 10000)) errors.push('design.height must be a number between 16 and 10000.');
  }

  const pages = root.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    errors.push('pages must be a non-empty array.');
  } else {
    const pageIds = new Set<string>();
    pages.forEach((p, i) => {
      const page = p as Record<string, unknown>;
      if (!page || typeof page !== 'object') {
        errors.push(`pages[${i}] must be an object.`);
        return;
      }
      if (typeof page.id !== 'string' || !page.id) errors.push(`pages[${i}].id must be a non-empty string.`);
      else if (pageIds.has(page.id)) errors.push(`Duplicate page id "${page.id}".`);
      else pageIds.add(page.id);
      if (typeof page.designId !== 'string') errors.push(`pages[${i}].designId must be a string.`);
      if (!isBackground(page.background)) errors.push(`pages[${i}].background is not a safe color or gradient.`);
      if (!isNum(page.order, 0, 10000)) errors.push(`pages[${i}].order must be a number between 0 and 10000.`);
    });

    const elements = root.elements;
    if (!Array.isArray(elements)) {
      errors.push('elements must be an array.');
    } else {
      const elIds = new Set<string>();
      elements.forEach((e, i) => {
        const el = e as Record<string, unknown>;
        if (!el || typeof el !== 'object') {
          errors.push(`elements[${i}] must be an object.`);
          return;
        }
        if (typeof el.id !== 'string' || !el.id) errors.push(`elements[${i}].id must be a non-empty string.`);
        else if (elIds.has(el.id)) errors.push(`Duplicate element id "${el.id}".`);
        else elIds.add(el.id);

        if (typeof el.pageId !== 'string' || !pageIds.has(el.pageId)) {
          errors.push(`elements[${i}].pageId "${String(el.pageId)}" does not match any page.`);
        }
        if (!ELEMENT_TYPES.includes(el.type as ElementType)) {
          errors.push(`elements[${i}].type must be text, shape or image.`);
          return;
        }
        for (const k of ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'order'] as const) {
          if (!isNum(el[k], -20000, 20000)) errors.push(`elements[${i}].${k} must be a finite number.`);
        }
        if (!el.content || typeof el.content !== 'object') errors.push(`elements[${i}].content must be an object.`);
        if (!el.style || typeof el.style !== 'object') {
          errors.push(`elements[${i}].style must be an object.`);
          return;
        }
        const style = el.style as Record<string, unknown>;
        const content = (el.content ?? {}) as Record<string, unknown>;

        if (el.type === 'text') {
          if (typeof content.text !== 'string' || content.text.length > 20000) {
            errors.push(`elements[${i}].content.text must be a string of at most 20000 characters.`);
          }
          if (typeof style.fontFamily !== 'string' || !/^[A-Za-z0-9 _-]{1,60}$/.test(style.fontFamily)) {
            errors.push(`elements[${i}].style.fontFamily is invalid.`);
          }
          if (!isNum(style.fontSize, 1, 2000)) errors.push(`elements[${i}].style.fontSize must be between 1 and 2000.`);
          if (!isNum(style.fontWeight, 100, 900)) errors.push(`elements[${i}].style.fontWeight must be between 100 and 900.`);
          if (!isSafeColor(style.color)) errors.push(`elements[${i}].style.color is not a safe color.`);
          if (!ALIGNS.includes(style.align as string)) errors.push(`elements[${i}].style.align must be left, center or right.`);
          if (!isNum(style.lineHeight, 0.5, 4)) errors.push(`elements[${i}].style.lineHeight must be between 0.5 and 4.`);
        } else if (el.type === 'shape') {
          if (!SHAPES.includes(style.shape as string)) errors.push(`elements[${i}].style.shape is unsupported.`);
          if (!isSafeColor(style.fill)) errors.push(`elements[${i}].style.fill is not a safe color.`);
        } else if (el.type === 'image') {
          if (typeof content.assetId !== 'string' || !content.assetId) {
            errors.push(`elements[${i}].content.assetId must be a non-empty string.`);
          }
          if (content.crop !== null && content.crop !== undefined) {
            const c = content.crop as Record<string, unknown>;
            if (!c || typeof c !== 'object' || !isNum(c.ox, -20000, 20000) || !isNum(c.oy, -20000, 20000) || !isNum(c.s, 0.001, 100)) {
              errors.push(`elements[${i}].content.crop is invalid.`);
            }
          }
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Wrap a validated payload into a DesignDoc (ids are trusted after validation). */
export function toDesignDoc(value: unknown): DesignDoc {
  const root = value as Record<string, unknown>;
  return {
    design: { ...(root.design as Record<string, unknown>), sample: false } as Design,
    pages: (root.pages as Page[]).map((p) => ({ ...p })),
    elements: (root.elements as DesignElement[]).map((e) => structuredClone(e)),
  };
}
