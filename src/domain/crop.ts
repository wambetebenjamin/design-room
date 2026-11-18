// Crop math for image elements.
// The element frame is (width x height); the image is drawn at offset (ox, oy)
// with uniform scale `s` applied to its natural size (nw x nh).
// Invariant: the image always covers the frame.

import type { ImageCrop } from './types';

export function coverScale(nw: number, nh: number, fw: number, fh: number): number {
  return Math.max(fw / nw, fh / nh);
}

/** Default crop: image scaled to cover the frame, centered. */
export function defaultCrop(nw: number, nh: number, fw: number, fh: number): ImageCrop {
  const s = coverScale(nw, nh, fw, fh);
  const iw = nw * s;
  const ih = nh * s;
  return { ox: (fw - iw) / 2, oy: (fh - ih) / 2, s };
}

/** Clamp an offset so the image keeps covering the frame. */
export function clampOffset(
  ox: number,
  oy: number,
  iw: number,
  ih: number,
  fw: number,
  fh: number,
): { ox: number; oy: number } {
  const minOx = Math.min(0, fw - iw);
  const minOy = Math.min(0, fh - ih);
  return {
    ox: Math.min(0, Math.max(minOx, ox)),
    oy: Math.min(0, Math.max(minOy, oy)),
  };
}

/** Ensure a crop still covers the frame (e.g. after the frame was resized). */
export function fitCropToFrame(
  crop: ImageCrop | null,
  nw: number,
  nh: number,
  fw: number,
  fh: number,
): ImageCrop {
  const base = crop ?? defaultCrop(nw, nh, fw, fh);
  const minS = coverScale(nw, nh, fw, fh);
  const s = Math.max(base.s, minS);
  const iw = nw * s;
  const ih = nh * s;
  const { ox, oy } = clampOffset(base.ox, base.oy, iw, ih, fw, fh);
  return { ox, oy, s };
}

/** Move the image inside the frame (crop mode drag). */
export function moveCrop(
  crop: ImageCrop,
  dx: number,
  dy: number,
  nw: number,
  nh: number,
  fw: number,
  fh: number,
): ImageCrop {
  const iw = nw * crop.s;
  const ih = nh * crop.s;
  const { ox, oy } = clampOffset(crop.ox + dx, crop.oy + dy, iw, ih, fw, fh);
  return { ...crop, ox, oy };
}

/**
 * Scale the image from a crop-mode corner handle.
 * Keeps aspect ratio and coverage; anchor is the corner opposite the handle.
 */
export function scaleCrop(
  crop: ImageCrop,
  scaleRatio: number,
  nw: number,
  nh: number,
  fw: number,
  fh: number,
): ImageCrop {
  const minS = coverScale(nw, nh, fw, fh);
  const s = Math.max(minS, crop.s * scaleRatio);
  const iw = nw * s;
  const ih = nh * s;
  // Keep the image center's relative position inside the frame while scaling.
  const prevCenterX = crop.ox + (nw * crop.s) / 2;
  const prevCenterY = crop.oy + (nh * crop.s) / 2;
  const relX = prevCenterX / fw;
  const relY = prevCenterY / fh;
  const { ox, oy } = clampOffset(relX * fw - iw / 2, relY * fh - ih / 2, iw, ih, fw, fh);
  return { ox, oy, s };
}

/** Natural pixel size of a crop given its scale. */
export function cropPixelSize(crop: ImageCrop, nw: number, nh: number): { iw: number; ih: number } {
  return { iw: nw * crop.s, ih: nh * crop.s };
}
