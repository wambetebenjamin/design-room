// Smart alignment guides: snap a moving element to the page centre/edges and
// to sibling elements, returning the adjusted position plus the guide lines
// to draw. Pure maths so it is unit-testable.

export interface SnapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapGuide {
  /** 'v' = vertical line at `pos` (x), 'h' = horizontal line at `pos` (y). */
  axis: 'v' | 'h';
  pos: number;
  /** Line extent along the other axis (doc coordinates). */
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

interface Candidate {
  pos: number;
  /** [start, end] along the perpendicular axis; null = span the whole page. */
  extent: [number, number] | null;
}

function bestSnap(
  edges: number[],
  candidates: Candidate[],
  threshold: number,
): { delta: number; cand: Candidate } | null {
  let best: { delta: number; cand: Candidate } | null = null;
  for (const edge of edges) {
    for (const cand of candidates) {
      const delta = cand.pos - edge;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, cand };
      }
    }
  }
  return best;
}

/**
 * Snap a moved box toward page and sibling alignment targets.
 * Page centre/edges produce full-length guides; sibling targets produce a
 * guide spanning both boxes. `threshold` is in document pixels.
 */
export function snapMove(
  moved: SnapBox,
  page: { width: number; height: number },
  others: SnapBox[],
  threshold = 8,
): SnapResult {
  let x = moved.x;
  let y = moved.y;
  const guides: SnapGuide[] = [];

  const xEdges = [moved.x, moved.x + moved.width / 2, moved.x + moved.width];
  const vCandidates: Candidate[] = [
    { pos: 0, extent: null },
    { pos: page.width / 2, extent: null },
    { pos: page.width, extent: null },
  ];
  for (const o of others) {
    const extent: [number, number] = [
      Math.min(moved.y, o.y),
      Math.max(moved.y + moved.height, o.y + o.height),
    ];
    vCandidates.push({ pos: o.x, extent });
    vCandidates.push({ pos: o.x + o.width / 2, extent });
    vCandidates.push({ pos: o.x + o.width, extent });
  }
  const vx = bestSnap(xEdges, vCandidates, threshold);
  if (vx) {
    x = moved.x + vx.delta;
    guides.push({
      axis: 'v',
      pos: vx.cand.pos,
      from: vx.cand.extent ? vx.cand.extent[0] : 0,
      to: vx.cand.extent ? vx.cand.extent[1] : page.height,
    });
  }

  const yEdges = [moved.y, moved.y + moved.height / 2, moved.y + moved.height];
  const hCandidates: Candidate[] = [
    { pos: 0, extent: null },
    { pos: page.height / 2, extent: null },
    { pos: page.height, extent: null },
  ];
  for (const o of others) {
    const extent: [number, number] = [
      Math.min(moved.x, o.x),
      Math.max(moved.x + moved.width, o.x + o.width),
    ];
    hCandidates.push({ pos: o.y, extent });
    hCandidates.push({ pos: o.y + o.height / 2, extent });
    hCandidates.push({ pos: o.y + o.height, extent });
  }
  const vy = bestSnap(yEdges, hCandidates, threshold);
  if (vy) {
    y = moved.y + vy.delta;
    guides.push({
      axis: 'h',
      pos: vy.cand.pos,
      from: vy.cand.extent ? vy.cand.extent[0] : 0,
      to: vy.cand.extent ? vy.cand.extent[1] : page.width,
    });
  }

  return { x, y, guides };
}
