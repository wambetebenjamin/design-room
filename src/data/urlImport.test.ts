// Unit tests for image-link normalisation (GitHub / Drive / direct URLs).

import { describe, it, expect } from 'vitest';
import { normalizeImageUrl, fileNameFromUrl } from './urlImport';

describe('normalizeImageUrl', () => {
  it('rewrites GitHub blob links to raw.githubusercontent.com', () => {
    expect(normalizeImageUrl('https://github.com/acme/posters/blob/main/flyer.png')).toBe(
      'https://raw.githubusercontent.com/acme/posters/main/flyer.png',
    );
  });

  it('rewrites GitHub raw links to raw.githubusercontent.com', () => {
    expect(normalizeImageUrl('https://github.com/acme/posters/raw/main/flyer.jpg')).toBe(
      'https://raw.githubusercontent.com/acme/posters/main/flyer.jpg',
    );
  });

  it('keeps nested paths when rewriting GitHub links', () => {
    expect(normalizeImageUrl('https://github.com/a/b/blob/dev/assets/img/cover.webp')).toBe(
      'https://raw.githubusercontent.com/a/b/dev/assets/img/cover.webp',
    );
  });

  it('converts Google Drive share links to the download endpoint', () => {
    expect(normalizeImageUrl('https://drive.google.com/file/d/abc123XYZ/view?usp=sharing')).toBe(
      'https://drive.google.com/uc?export=download&id=abc123XYZ',
    );
  });

  it('converts Google Drive open?id links', () => {
    expect(normalizeImageUrl('https://drive.google.com/open?id=FILE42')).toBe(
      'https://drive.google.com/uc?export=download&id=FILE42',
    );
  });

  it('passes direct image URLs through unchanged', () => {
    expect(normalizeImageUrl('https://cdn.example.com/img/poster.jpg?w=2000')).toBe(
      'https://cdn.example.com/img/poster.jpg?w=2000',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeImageUrl('  https://example.com/a.png  ')).toBe('https://example.com/a.png');
  });

  it('rejects links without a scheme', () => {
    expect(() => normalizeImageUrl('example.com/a.png')).toThrow(/https:\/\//);
  });

  it('rejects empty input', () => {
    expect(() => normalizeImageUrl('   ')).toThrow(/link/i);
  });

  it('rejects non-image GitHub links', () => {
    expect(() => normalizeImageUrl('https://github.com/acme/posters')).toThrow(/image/i);
  });

  it('rejects Drive links without a file id', () => {
    expect(() => normalizeImageUrl('https://drive.google.com/drive/my-drive')).toThrow(/file ID/i);
  });
});

describe('fileNameFromUrl', () => {
  it('uses the last path segment when it has an extension', () => {
    expect(fileNameFromUrl('https://raw.githubusercontent.com/a/b/main/x/my%20poster.png', 'image/png')).toBe(
      'my poster.png',
    );
  });

  it('falls back to the content type when there is no usable name', () => {
    expect(fileNameFromUrl('https://cdn.example.com/serve/12345', 'image/jpeg')).toBe('linked-image.jpg');
    expect(fileNameFromUrl('https://cdn.example.com/serve/12345', 'image/webp')).toBe('linked-image.webp');
  });
});
