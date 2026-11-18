import { describe, expect, it } from 'vitest';
import { validateDocument, toDesignDoc, isSafeColor } from './validate';
import { docToJson } from '../export/exportImage';
import type { DesignDoc } from './types';

function validPayload() {
  return {
    schema: 'chrisco-design-room/v1',
    design: { id: 'd1', title: 'Test', width: 1080, height: 1080, createdAt: 1, updatedAt: 2 },
    pages: [{ id: 'p1', designId: 'd1', background: '#ffffff', order: 0 }],
    elements: [
      {
        id: 'e1',
        pageId: 'p1',
        type: 'text',
        x: 10,
        y: 10,
        width: 400,
        height: 80,
        rotation: 0,
        opacity: 1,
        order: 0,
        content: { text: 'Hello' },
        style: {
          fontFamily: 'Inter',
          fontSize: 32,
          fontWeight: 700,
          color: '#111111',
          align: 'left',
          lineHeight: 1.2,
          letterSpacing: 0,
          italic: false,
        },
      },
    ],
  };
}

describe('validateDocument', () => {
  it('accepts a valid document', () => {
    const r = validateDocument(validPayload());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a non-object root', () => {
    expect(validateDocument(null).ok).toBe(false);
    expect(validateDocument([]).ok).toBe(false);
  });

  it('rejects a wrong schema', () => {
    const p = { ...validPayload(), schema: 'evil/v9' };
    expect(validateDocument(p).ok).toBe(false);
  });

  it('rejects unsafe colors (untrusted content)', () => {
    const p = validPayload();
    (p.pages[0] as { background: unknown }).background = 'url(javascript:alert(1))';
    const r = validateDocument(p);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('background');
  });

  it('rejects elements pointing at unknown pages', () => {
    const p = validPayload();
    (p.elements[0] as { pageId: string }).pageId = 'ghost';
    const r = validateDocument(p);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('pageId');
  });

  it('rejects duplicate element ids', () => {
    const p = validPayload();
    p.elements.push({ ...p.elements[0] });
    const r = validateDocument(p);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('Duplicate element id');
  });

  it('rejects out-of-range design size', () => {
    const p = validPayload();
    (p.design as { width: number }).width = 999999;
    expect(validateDocument(p).ok).toBe(false);
  });

  it('rejects an invalid font family string', () => {
    const p = validPayload();
    (p.elements[0].style as { fontFamily: string }).fontFamily = '<script>';
    expect(validateDocument(p).ok).toBe(false);
  });
});

describe('round-trip: export then import', () => {
  it('docToJson produces a payload that validates and converts', () => {
    const doc: DesignDoc = toDesignDoc(validPayload());
    const json = docToJson(doc);
    const parsed = JSON.parse(json);
    expect(validateDocument(parsed).ok).toBe(true);
    const again = toDesignDoc(parsed);
    expect(again.design.title).toBe('Test');
    expect(again.elements).toHaveLength(1);
  });
});

describe('isSafeColor', () => {
  it('allows hex, rgb and named basics', () => {
    expect(isSafeColor('#abc')).toBe(true);
    expect(isSafeColor('#aabbcc')).toBe(true);
    expect(isSafeColor('rgb(1, 2, 3)')).toBe(true);
    expect(isSafeColor('white')).toBe(true);
  });
  it('rejects injection-ish strings', () => {
    expect(isSafeColor('red; background: url(x)')).toBe(false);
    expect(isSafeColor('expression(alert(1))')).toBe(false);
    expect(isSafeColor('url(#x)')).toBe(false);
  });
});
