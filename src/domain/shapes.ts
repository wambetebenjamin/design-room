// Shared shape geometry so DOM (CSS clip-path) and canvas export agree.

export interface Point {
  x: number;
  y: number;
}

/** 5-point star polygon scaled to the box (matches the canvas renderer). */
export function starPoints(w: number, h: number, spikes = 5): Point[] {
  const pts: Point[] = [];
  const outer = Math.min(w, h) / 2;
  const inner = outer * 0.45;
  const cx = w / 2;
  const cy = h / 2;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const ang = (Math.PI / spikes) * i - Math.PI / 2;
    pts.push({
      x: cx + Math.cos(ang) * r * (w / Math.min(w, h)),
      y: cy + Math.sin(ang) * r * (h / Math.min(w, h)),
    });
  }
  return pts;
}

export function starClipPath(w: number, h: number): string {
  if (w <= 0 || h <= 0) return 'none';
  const pts = starPoints(w, h);
  return `polygon(${pts.map((p) => `${((p.x / w) * 100).toFixed(3)}% ${((p.y / h) * 100).toFixed(3)}%`).join(', ')})`;
}
