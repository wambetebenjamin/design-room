// Text measurement + greedy line wrapping shared by the DOM layout and the
// canvas export renderer, so what you see is what you export.

export interface FontSpec {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic?: boolean;
}

export function cssFont(spec: FontSpec): string {
  const style = spec.italic ? 'italic ' : '';
  return `${style}${spec.fontWeight} ${spec.fontSize}px "${spec.fontFamily}", sans-serif`;
}

/**
 * Wrap text into lines. Breaks on whitespace, hard-breaks over-long words.
 * `measure` returns the width of a string in the target font.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const out: string[] = [];
  const paragraphs = text.split('\n');
  const limit = Math.max(1, maxWidth);
  for (const para of paragraphs) {
    if (para === '') {
      out.push('');
      continue;
    }
    const words = para.split(/(\s+)/).filter((w) => w.length > 0);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (measure(candidate) <= limit || line === '') {
        // If a single word alone overflows, hard-break it by characters.
        if (line === '' && measure(word) > limit && !/^\s+$/.test(word)) {
          let chunk = '';
          for (const ch of word) {
            if (measure(chunk + ch) > limit && chunk !== '') {
              out.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = candidate;
        }
      } else {
        out.push(line.replace(/\s+$/, ''));
        line = word.replace(/^\s+/, '');
      }
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out.length > 0 ? out : [''];
}

export function lineHeightPx(style: { fontSize: number; lineHeight: number }): number {
  return style.fontSize * style.lineHeight;
}

/** Height a text element needs for its content (used for export + derived layout). */
export function textBlockHeight(
  text: string,
  style: { fontSize: number; lineHeight: number },
  lineCount: number,
): number {
  void text;
  return Math.max(style.fontSize, lineCount * lineHeightPx(style));
}

// --- Canvas-backed measurement (node-safe fallback via approximate widths) ---

let ctx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!ctx) {
    const c = document.createElement('canvas');
    ctx = c.getContext('2d');
  }
  return ctx;
}

/** Approximate width when no canvas is available (unit tests, SSR). */
export function approximateWidth(s: string, spec: FontSpec): number {
  const ratio = spec.fontWeight >= 700 ? 0.56 : 0.52;
  const familyFactor = /Bebas/i.test(spec.fontFamily) ? 0.42 : /Playfair/i.test(spec.fontFamily) ? 0.5 : 0.55;
  return s.length * spec.fontSize * (spec.italic ? ratio + 0.02 : ratio) * (familyFactor / 0.55);
}

export function makeMeasure(spec: FontSpec): (s: string) => number {
  const c = measureCtx();
  if (!c) return (s) => approximateWidth(s, spec);
  return (s) => {
    c.font = cssFont(spec);
    return c.measureText(s).width;
  };
}
