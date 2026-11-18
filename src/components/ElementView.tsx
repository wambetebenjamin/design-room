// DOM rendering of one design element. Used by the interactive canvas,
// page thumbnails, template previews and design-list thumbnails.

import { memo } from 'react';
import type { DesignElement } from '../domain/types';
import { backgroundToCss } from '../domain/document';
import { fitCropToFrame } from '../domain/crop';
import { starClipPath } from '../domain/shapes';
import { getImageSync, useImageVersion } from '../render/imageCache';

interface Props {
  el: DesignElement;
  /** Preview mode: non-interactive, no selection chrome. */
  staticView?: boolean;
  /** Rendered inside a positioned hit wrapper — skip absolute placement. */
  embedded?: boolean;
}

function ElementContent({ el }: { el: DesignElement }) {
  if (el.type === 'text') {
    const content = el.content as { text: string };
    const s = el.style as {
      fontFamily: string;
      fontSize: number;
      fontWeight: number;
      color: string;
      align: string;
      lineHeight: number;
      letterSpacing: number;
      italic: boolean;
    };
    return (
      <div
        className="el-text"
        style={{
          fontFamily: `"${s.fontFamily}", sans-serif`,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          color: s.color,
          textAlign: s.align as 'left' | 'center' | 'right',
          lineHeight: s.lineHeight,
          letterSpacing: s.letterSpacing || undefined,
          fontStyle: s.italic ? 'italic' : undefined,
        }}
      >
        {content.text}
      </div>
    );
  }

  if (el.type === 'shape') {
    const s = el.style as { shape: string; fill: string; radius: number };
    if (s.shape === 'line') {
      return <div className="el-line" style={{ background: s.fill }} />;
    }
    if (s.shape === 'ellipse') {
      return <div className="el-box" style={{ background: s.fill, borderRadius: '50%' }} />;
    }
    if (s.shape === 'triangle') {
      return <div className="el-box" style={{ background: s.fill, clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }} />;
    }
    if (s.shape === 'star') {
      return <div className="el-box" style={{ background: s.fill, clipPath: starClipPath(el.width, el.height) }} />;
    }
    return <div className="el-box" style={{ background: s.fill, borderRadius: s.radius }} />;
  }

  // image
  const content = el.content as { assetId: string; crop: { ox: number; oy: number; s: number } | null };
  const style = el.style as { radius: number };
  const img = getImageSync(content.assetId);
  if (!img) {
    return (
      <div className="el-missing" role="img" aria-label="Image unavailable">
        <span>Image unavailable</span>
      </div>
    );
  }
  const crop = fitCropToFrame(content.crop, img.naturalWidth, img.naturalHeight, el.width, el.height);
  const iw = img.naturalWidth * crop.s;
  const ih = img.naturalHeight * crop.s;
  return (
    <div className="el-image" style={{ borderRadius: style.radius, overflow: 'hidden' }}>
      <img
        src={img.src}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          left: crop?.ox ?? 0,
          top: crop?.oy ?? 0,
          width: iw,
          height: ih,
          maxWidth: 'none',
        }}
      />
    </div>
  );
}

export const ElementView = memo(function ElementView({ el, staticView, embedded }: Props) {
  // Re-render when a cached image finishes decoding.
  useImageVersion();

  return (
    <div
      className={`el el-${el.type}${staticView ? ' el-static' : ''}`}
      data-el-id={el.id}
      style={
        embedded
          ? {
              // The hit wrapper already applies rotation — no double transform.
              width: '100%',
              height: '100%',
              opacity: el.opacity,
            }
          : {
              left: el.x,
              top: el.y,
              width: el.width,
              height: el.height,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              opacity: el.opacity,
            }
      }
    >
      <ElementContent el={el} />
    </div>
  );
});

/** Background layer for a page (solid or gradient). */
export function PageBackground({ background, width, height }: { background: Parameters<typeof backgroundToCss>[0]; width: number; height: number }) {
  return (
    <div
      className="page-bg"
      style={{ background: backgroundToCss(background), width, height }}
      aria-hidden="true"
    />
  );
}
