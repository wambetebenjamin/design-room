import { describe, expect, it } from 'vitest';
import { approximateWidth, cssFont, wrapText } from './textLayout';

const measure = (s: string) => approximateWidth(s, { fontFamily: 'Inter', fontSize: 10, fontWeight: 400 });

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('hello world', 100000, measure)).toEqual(['hello world']);
  });

  it('honors hard line breaks', () => {
    expect(wrapText('a\nb', 100000, measure)).toEqual(['a', 'b']);
  });

  it('wraps on whitespace', () => {
    const lines = wrapText('aaa bbb ccc ddd eee fff', 3 * measure('aaa '), measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('aaa bbb ccc ddd eee fff');
  });

  it('hard-breaks a single word that is too long', () => {
    const lines = wrapText('supercalifragilistic', measure('super'), measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('supercalifragilistic');
  });

  it('always returns at least one line', () => {
    expect(wrapText('', 100, measure)).toEqual(['']);
  });
});

describe('cssFont', () => {
  it('builds a canvas-compatible font string', () => {
    expect(cssFont({ fontFamily: 'Inter', fontSize: 24, fontWeight: 700 })).toBe('700 24px "Inter", sans-serif');
    expect(cssFont({ fontFamily: 'Inter', fontSize: 24, fontWeight: 400, italic: true })).toBe(
      'italic 400 24px "Inter", sans-serif',
    );
  });
});
