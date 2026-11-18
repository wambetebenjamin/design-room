// Home-screen list helpers: search filtering and friendly "edited" times.

import type { Design } from './types';

/** Case-insensitive title search; blank query returns everything. */
export function filterDesigns(designs: Design[], query: string): Design[] {
  const q = query.trim().toLowerCase();
  if (!q) return designs;
  return designs.filter((d) => d.title.toLowerCase().includes(q));
}

/** Human-friendly relative time for card metadata. */
export function formatEditedTime(ts: number, now: number = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString();
}
