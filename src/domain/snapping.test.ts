// Unit tests for smart snap guides and home-list helpers.

import { describe, it, expect } from 'vitest';
import { snapMove } from './snapping';
import { filterDesigns, formatEditedTime } from './designList';
import type { Design } from './types';

describe('snapMove', () => {
  const page = { width: 1000, height: 1000 };

  it('snaps a near-centre box exactly to the page centre', () => {
    // 200-wide box: centre at 503 → within 8px of 500
    const r = snapMove({ x: 403, y: 100, width: 200, height: 50 }, page, []);
    expect(r.x).toBe(400); // centre lands on 500
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0]).toMatchObject({ axis: 'v', pos: 500, from: 0, to: 1000 });
  });

  it('does not snap beyond the threshold', () => {
    const r = snapMove({ x: 380, y: 100, width: 200, height: 50 }, page, []);
    expect(r.x).toBe(380);
    expect(r.guides).toHaveLength(0);
  });

  it('snaps edges to the page border', () => {
    const r = snapMove({ x: -4, y: 500, width: 120, height: 60 }, page, []);
    expect(r.x).toBe(0);
    expect(r.guides.some((g) => g.axis === 'v' && g.pos === 0)).toBe(true);
  });

  it('snaps to a sibling edge and spans both boxes', () => {
    const sibling = { x: 300, y: 400, width: 200, height: 100 };
    // moving box left edge at 295 → snaps to sibling right edge 500? no: to 300-? use left edge near sibling left
    const r = snapMove({ x: 296, y: 600, width: 100, height: 40 }, page, [sibling]);
    expect(r.x).toBe(300);
    const guide = r.guides.find((g) => g.axis === 'v');
    expect(guide?.pos).toBe(300);
    // extent covers both boxes vertically (400..700)
    expect(guide?.from).toBe(400);
    expect(guide?.to).toBe(640);
  });

  it('snaps centres to sibling centres on both axes', () => {
    const sibling = { x: 100, y: 100, width: 200, height: 200 }; // centre (200, 200)
    // 100×100 box with centre at (203, 196) → snaps to (200, 200)
    const r = snapMove({ x: 153, y: 146, width: 100, height: 100 }, page, [sibling]);
    expect(r.x).toBe(150);
    expect(r.y).toBe(150);
    expect(r.guides).toHaveLength(2);
    expect(r.guides.map((g) => g.axis).sort()).toEqual(['h', 'v']);
  });

  it('prefers the closest candidate', () => {
    // left edge 4 away from 0, centre 6 away from 500? construct: box width 100 at x=-4 → edge dist4 to 0; centre at46 → dist46 to 500... pick nearer page edge
    const r = snapMove({ x: -4, y: 0, width: 100, height: 100 }, page, []);
    expect(r.x).toBe(0);
  });
});

describe('filterDesigns', () => {
  const designs: Design[] = [
    { id: '1', title: 'Summer Poster', width: 100, height: 100, createdAt: 0, updatedAt: 0 },
    { id: '2', title: 'birthday story', width: 100, height: 100, createdAt: 0, updatedAt: 0 },
    { id: '3', title: 'Menu', width: 100, height: 100, createdAt: 0, updatedAt: 0 },
  ];

  it('returns everything for a blank query', () => {
    expect(filterDesigns(designs, '   ')).toHaveLength(3);
  });

  it('matches case-insensitively', () => {
    expect(filterDesigns(designs, 'SUMMER').map((d) => d.id)).toEqual(['1']);
    expect(filterDesigns(designs, 'day').map((d) => d.id)).toEqual(['2']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterDesigns(designs, 'zzz')).toEqual([]);
  });
});

describe('formatEditedTime', () => {
  const now = 1_700_000_000_000;

  it('says just now for under a minute', () => {
    expect(formatEditedTime(now - 30_000, now)).toBe('just now');
  });

  it('uses minutes, hours and days', () => {
    expect(formatEditedTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatEditedTime(now - 3 * 3_600_000, now)).toBe('3 hr ago');
    expect(formatEditedTime(now - 2 * 86_400_000, now)).toBe('2 days ago');
    expect(formatEditedTime(now - 86_400_000, now)).toBe('1 day ago');
  });

  it('falls back to a date beyond a week', () => {
    const out = formatEditedTime(now - 30 * 86_400_000, now);
    expect(out).not.toMatch(/ago/);
    expect(out.length).toBeGreaterThan(3);
  });

  it('clamps future timestamps', () => {
    expect(formatEditedTime(now + 60_000, now)).toBe('just now');
  });
});
